/**
 * Rappels de produits (RappelConso, DGCCRF et DGAL) comparés aux codes-barres
 * du stock. Tous les rappels récents sont téléchargés puis comparés ici : la
 * liste des produits du foyer ne quitte pas le téléphone.
 */
import type { Alert } from './types';

/** Fenêtre des rappels téléchargés : six mois de publications. */
export const RECALL_DAYS = 183;

const FIELDS = [
  'gtin',
  'numero_fiche',
  'libelle',
  'marque_produit',
  'motif_rappel',
  'conduites_a_tenir_par_le_consommateur',
  'identification_produits',
  'lien_vers_la_fiche_rappel',
  'date_publication',
  'date_de_fin_de_la_procedure_de_rappel',
];

export function recallUrl(since: string): string {
  const where = encodeURIComponent(`date_publication>="${since}"`);
  return (
    'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/' +
    `rappelconso-v2-gtin-trie/exports/json?select=${FIELDS.join(
      ',',
    )}&where=${where}`
  );
}

/** Code d'un article du stock et nom affiché. */
export interface StockCode {
  code: string;
  itemId: string;
  itemName: string;
}

interface Recall {
  gtin?: number | string | null;
  numero_fiche?: string | null;
  libelle?: string | null;
  marque_produit?: string | null;
  motif_rappel?: string | null;
  conduites_a_tenir_par_le_consommateur?: string | null;
  identification_produits?: string | null;
  lien_vers_la_fiche_rappel?: string | null;
  date_publication?: string | null;
  date_de_fin_de_la_procedure_de_rappel?: string | null;
}

/** GTIN sans zéros de tête : EAN-13, UPC-A et GTIN-14 se comparent. */
export function canonicalGtin(code: string | number): string {
  return String(code).replace(/\D/g, '').replace(/^0+/, '');
}

function clean(value: string | null | undefined): string | null {
  const t = (value ?? '').replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
}

function upperFirst(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Lots concernés pour ce GTIN (« tous les lots », « 627814 »…). */
function lotsFor(identification: string | null, gtin: string): string | null {
  const lots: string[] = [];
  for (const part of (identification ?? '').split('|')) {
    const [code, lot] = part.split('$');
    if (canonicalGtin(code ?? '') === gtin && clean(lot)) {
      lots.push(clean(lot) as string);
    }
  }
  return lots.length === 0 ? null : [...new Set(lots)].join(', ');
}

export function parseRecalls(
  json: unknown,
  stock: readonly StockCode[],
  today: string,
): Alert[] {
  const byGtin = new Map<string, StockCode[]>();
  for (const s of stock) {
    const key = canonicalGtin(s.code);
    if (key.length >= 7) {
      byGtin.set(key, [...(byGtin.get(key) ?? []), s]);
    }
  }
  const alerts = new Map<string, Alert>();
  for (const r of Array.isArray(json) ? (json as Recall[]) : []) {
    if (r.gtin === null || r.gtin === undefined) {
      continue;
    }
    const end = clean(r.date_de_fin_de_la_procedure_de_rappel);
    if (end !== null && end.slice(0, 10) < today) {
      continue;
    }
    const gtin = canonicalGtin(r.gtin);
    for (const s of byGtin.get(gtin) ?? []) {
      const id = `recall:${r.numero_fiche ?? gtin}:${s.itemId}`;
      const lots = lotsFor(clean(r.identification_produits), gtin);
      const what = [clean(r.libelle), clean(r.marque_produit)]
        .filter(Boolean)
        .join(' · ');
      const motif = clean(r.motif_rappel);
      const conduct = clean(r.conduites_a_tenir_par_le_consommateur);
      alerts.set(id, {
        id,
        source: 'recall',
        level: 'orange',
        title: 'Produit rappelé dans votre stock',
        where: s.itemName,
        detail:
          [
            what ? upperFirst(what) : null,
            motif ? `Motif : ${motif}` : null,
            lots ? `Lots concernés : ${lots}` : null,
          ]
            .filter(Boolean)
            .join('\n') || null,
        instruction: conduct
          ? upperFirst(conduct.split('|').join(' ; ')) + '.'
          : null,
        start: clean(r.date_publication),
        end,
        url: clean(r.lien_vers_la_fiche_rappel),
        itemId: s.itemId,
      });
    }
  }
  return [...alerts.values()];
}
