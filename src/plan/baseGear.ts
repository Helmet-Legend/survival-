/**
 * Matériel de base : l'équipement courant d'un foyer préparé, rangé par
 * famille (d'après le guide « Tous responsables » du SGDSN et le kit 72 h
 * de Géorisques, complétés des outils et consommables usuels). Chaque
 * élément est reconnu dans le stock (maison et sacs) ou coché à la main.
 *
 * Aucune quantité n'est imposée : la liste dit quoi avoir, les check-lists
 * par paliers disent combien de jours tenir.
 */
import type { SqlDatabase } from '../db/types';
import type { ItemCategory, ItemSummary } from '../inventory';
import { loadMarks, setMark } from './preparation';

/** Périmètre des coches de cette liste dans `preparation_marks`. */
export const GEAR_SCOPE = 'gear';

export interface GearDefinition {
  id: string;
  label: string;
  hint?: string;
  /** Catégorie reconnue ; sans types, tout article de la catégorie compte. */
  category?: ItemCategory;
  subtypes?: readonly string[];
  /** Types de la catégorie qui ne comptent pas (sans `subtypes`). */
  excludeSubtypes?: readonly string[];
  /** Mots du nom qui conviennent aussi (sans accents, minuscules). */
  names?: readonly string[];
  /** Vérifié ailleurs que dans le stock. */
  source?: 'documents' | 'bags';
  /** Où l'ajouter : catégorie et valeurs préremplies de la fiche. */
  add?: { category: ItemCategory; prefill?: Record<string, string> };
}

export interface GearSection {
  id: string;
  title: string;
  items: readonly GearDefinition[];
}

export const GEAR_SECTIONS: readonly GearSection[] = [
  {
    id: 'water',
    title: 'Eau',
    items: [
      {
        id: 'water_reserve',
        label: 'Réserve d’eau potable',
        hint: 'Bouteilles ou bidons ; 2 L par personne et par jour.',
        category: 'water',
        excludeSubtypes: ['filter'],
        add: { category: 'water' },
      },
      {
        id: 'water_filter',
        label: 'Filtre à eau',
        category: 'water',
        subtypes: ['filter'],
        names: ['filtre', 'paille filtrante'],
        add: {
          category: 'tool',
          prefill: { name: 'Filtre à eau', subtype: 'other' },
        },
      },
      {
        id: 'water_tablets',
        label: 'Pastilles de purification',
        names: ['pastille', 'purification', 'micropur', 'aquatabs'],
        add: {
          category: 'medical',
          prefill: { name: 'Pastilles de purification', subtype: 'other' },
        },
      },
      {
        id: 'water_container',
        label: 'Jerrican ou bidon vide',
        hint: 'Pour aller chercher de l’eau à un point de distribution.',
        names: ['jerrican', 'bidon vide'],
      },
    ],
  },
  {
    id: 'food',
    title: 'Alimentation',
    items: [
      {
        id: 'food',
        label: 'Vivres non périssables',
        hint: 'De préférence sans cuisson.',
        category: 'food',
        add: { category: 'food' },
      },
      {
        id: 'can_opener',
        label: 'Ouvre-boîte manuel',
        names: ['ouvre-boite', 'ouvre boite', 'ouvre-boites'],
        add: {
          category: 'tool',
          prefill: { name: 'Ouvre-boîte manuel', subtype: 'other' },
        },
      },
      {
        id: 'stove',
        label: 'Réchaud',
        category: 'energy',
        subtypes: ['cooking'],
        names: ['rechaud'],
        add: {
          category: 'energy',
          prefill: { name: 'Réchaud', subtype: 'cooking' },
        },
      },
      {
        id: 'stove_fuel',
        label: 'Combustible pour le réchaud',
        hint: 'Cartouches de gaz, alcool à brûler, tablettes…',
        category: 'power',
        subtypes: ['gas', 'fuel'],
        names: ['cartouche', 'alcool a bruler', 'esbit'],
        add: { category: 'power', prefill: { subtype: 'gas' } },
      },
      {
        id: 'cookware',
        label: 'Gamelle et couverts',
        names: ['gamelle', 'popote', 'couvert', 'quart'],
        add: {
          category: 'energy',
          prefill: { name: 'Gamelle', subtype: 'cooking' },
        },
      },
    ],
  },
  {
    id: 'light',
    title: 'Éclairage et énergie',
    items: [
      {
        id: 'light',
        label: 'Lampe de poche ou frontale',
        category: 'energy',
        subtypes: ['lighting'],
        names: ['lampe', 'torche', 'frontale'],
        add: {
          category: 'energy',
          prefill: { name: 'Lampe frontale', subtype: 'lighting' },
        },
      },
      {
        id: 'batteries',
        label: 'Piles de rechange',
        category: 'power',
        subtypes: ['battery'],
        names: ['pile', 'accu'],
        add: {
          category: 'power',
          prefill: { name: 'Piles', subtype: 'battery' },
        },
      },
      {
        id: 'powerbank',
        label: 'Batterie externe et câble de charge',
        category: 'power',
        subtypes: ['powerbank', 'solar'],
        names: ['batterie externe', 'powerbank', 'chargeur'],
        add: {
          category: 'power',
          prefill: { name: 'Batterie externe', subtype: 'powerbank' },
        },
      },
      {
        id: 'candles',
        label: 'Bougies',
        category: 'power',
        subtypes: ['candle'],
        names: ['bougie'],
        add: {
          category: 'power',
          prefill: { name: 'Bougies', subtype: 'candle' },
        },
      },
      {
        id: 'lighter',
        label: 'Briquet ou allumettes',
        names: ['briquet', 'allumette', 'ferro'],
        add: {
          category: 'power',
          prefill: { name: 'Briquet', subtype: 'other' },
        },
      },
    ],
  },
  {
    id: 'communication',
    title: 'Information et orientation',
    items: [
      {
        id: 'radio',
        label: 'Radio à piles ou à dynamo',
        hint: 'Pour suivre les consignes des autorités.',
        category: 'energy',
        subtypes: ['communication'],
        names: ['radio'],
        add: {
          category: 'energy',
          prefill: { name: 'Radio à piles', subtype: 'communication' },
        },
      },
      {
        id: 'whistle',
        label: 'Sifflet',
        hint: 'Pour signaler sa présence.',
        names: ['sifflet'],
        add: {
          category: 'tool',
          prefill: { name: 'Sifflet', subtype: 'other' },
        },
      },
      {
        id: 'paper_map',
        label: 'Carte routière papier',
        names: ['carte routiere', 'carte ign', 'carte papier', 'atlas'],
        add: {
          category: 'energy',
          prefill: { name: 'Carte routière', subtype: 'navigation' },
        },
      },
      {
        id: 'compass',
        label: 'Boussole',
        names: ['boussole'],
        add: {
          category: 'energy',
          prefill: { name: 'Boussole', subtype: 'navigation' },
        },
      },
      {
        id: 'contacts',
        label: 'Numéros utiles notés sur papier',
        hint: 'Famille, voisins, mairie : sans téléphone, plus de répertoire.',
      },
    ],
  },
  {
    id: 'health',
    title: 'Santé et hygiène',
    items: [
      {
        id: 'firstaid',
        label: 'Trousse de premiers secours',
        category: 'medical',
        subtypes: ['dressing', 'antiseptic'],
        names: ['trousse', 'pansement', 'compresse'],
        add: { category: 'medical' },
      },
      {
        id: 'medicine',
        label: 'Médicaments habituels',
        hint: 'Vos traitements, et une copie des ordonnances.',
        category: 'medical',
        subtypes: ['medicine'],
        add: { category: 'medical', prefill: { subtype: 'medicine' } },
      },
      {
        id: 'masks',
        label: 'Masques',
        names: ['masque', 'ffp2'],
        add: {
          category: 'medical',
          prefill: { name: 'Masques', subtype: 'protection' },
        },
      },
      {
        id: 'disposable_gloves',
        label: 'Gants jetables',
        names: ['gants jetables', 'gants nitrile', 'gants latex'],
        add: {
          category: 'medical',
          prefill: { name: 'Gants jetables', subtype: 'protection' },
        },
      },
      {
        id: 'hygiene',
        label: 'Savon et gel hydroalcoolique',
        category: 'medical',
        subtypes: ['hygiene'],
        names: ['savon', 'gel hydro'],
        add: { category: 'medical', prefill: { subtype: 'hygiene' } },
      },
      {
        id: 'toilet_paper',
        label: 'Papier toilette',
        names: ['papier toilette', 'papier hygienique'],
        add: {
          category: 'medical',
          prefill: { name: 'Papier toilette', subtype: 'hygiene' },
        },
      },
      {
        id: 'trash_bags',
        label: 'Sacs poubelle',
        hint: 'Déchets, toilettes de fortune, protection contre la pluie.',
        names: ['sac poubelle', 'sacs poubelle', 'sac-poubelle'],
        add: {
          category: 'tool',
          prefill: { name: 'Sacs poubelle', subtype: 'other' },
        },
      },
    ],
  },
  {
    id: 'shelter',
    title: 'Chaleur et abri',
    items: [
      {
        id: 'survival_blanket',
        label: 'Couverture de survie',
        names: ['couverture de survie', 'couverture survie'],
        add: {
          category: 'energy',
          prefill: { name: 'Couverture de survie', subtype: 'sleeping' },
        },
      },
      {
        id: 'sleeping',
        label: 'Sac de couchage ou couverture',
        category: 'energy',
        subtypes: ['sleeping'],
        names: ['duvet', 'sac de couchage', 'couverture'],
        add: {
          category: 'energy',
          prefill: { name: 'Sac de couchage', subtype: 'sleeping' },
        },
      },
      {
        id: 'warm_clothes',
        label: 'Vêtements chauds et de pluie',
        category: 'energy',
        subtypes: ['protection'],
        names: ['vetement', 'polaire', 'poncho', 'impermeable', 'veste'],
        add: { category: 'energy', prefill: { subtype: 'protection' } },
      },
      {
        id: 'tarp',
        label: 'Bâche',
        category: 'energy',
        subtypes: ['shelter'],
        names: ['bache', 'tente', 'tarp'],
        add: {
          category: 'energy',
          prefill: { name: 'Bâche', subtype: 'shelter' },
        },
      },
    ],
  },
  {
    id: 'tools',
    title: 'Outils',
    items: [
      {
        id: 'knife',
        label: 'Couteau ou multi-outil',
        category: 'tool',
        subtypes: ['cutting', 'multitool'],
        names: ['couteau', 'multi-outil', 'multitool', 'leatherman'],
        add: { category: 'tool', prefill: { subtype: 'multitool' } },
      },
      {
        id: 'hand_tools',
        label: 'Tournevis et pince',
        category: 'tool',
        subtypes: ['clamping', 'mechanical'],
        names: ['tournevis', 'pince'],
        add: { category: 'tool', prefill: { subtype: 'clamping' } },
      },
      {
        id: 'duct_tape',
        label: 'Ruban adhésif renforcé',
        names: ['adhesif', 'scotch', 'duct', 'chatterton'],
        add: {
          category: 'tool',
          prefill: { name: 'Ruban adhésif renforcé', subtype: 'repair' },
        },
      },
      {
        id: 'rope',
        label: 'Corde ou paracorde',
        names: ['corde', 'paracorde', 'cordelette'],
        add: {
          category: 'tool',
          prefill: { name: 'Paracorde', subtype: 'other' },
        },
      },
      {
        id: 'work_gloves',
        label: 'Gants de travail',
        names: ['gants de travail', 'gants de protection', 'gants cuir'],
        add: {
          category: 'tool',
          prefill: { name: 'Gants de travail', subtype: 'other' },
        },
      },
      {
        id: 'extinguisher',
        label: 'Extincteur',
        names: ['extincteur'],
        add: {
          category: 'tool',
          prefill: { name: 'Extincteur', subtype: 'other' },
        },
      },
    ],
  },
  {
    id: 'papers',
    title: 'Documents, argent, évacuation',
    items: [
      {
        id: 'documents',
        label: 'Copies des documents essentiels',
        hint: 'Pièces d’identité, carte Vitale, assurance.',
        source: 'documents',
      },
      {
        id: 'cash',
        label: 'Argent liquide',
        hint: 'Les paiements par carte peuvent être coupés.',
      },
      { id: 'keys', label: 'Double des clés' },
      {
        id: 'bag',
        label: 'Sac d’évacuation prêt',
        hint: 'Un sac à dos par personne, rangé près de la sortie.',
        source: 'bags',
      },
    ],
  },
];

export type GearStatus = 'stock' | 'checked' | 'missing';

export interface GearResult {
  definition: GearDefinition;
  section: GearSection;
  status: GearStatus;
  /** Ce qui a été trouvé (« Lampe frontale, Torche »). */
  detail: string | null;
}

export interface GearReport {
  results: GearResult[];
  have: number;
  total: number;
}

function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Un article utilisable (lots non périmés) correspond-il à l'élément ? */
export function gearMatches(gear: GearDefinition, item: ItemSummary): boolean {
  if (item.usableQuantity <= 0 || item.category === 'weapon') {
    return false;
  }
  if (gear.category === item.category) {
    if (gear.subtypes === undefined) {
      return !(gear.excludeSubtypes ?? []).includes(item.subtype ?? '');
    }
    if (item.subtype !== null && gear.subtypes.includes(item.subtype)) {
      return true;
    }
  }
  const name = plain(item.name);
  return (gear.names ?? []).some(word => name.includes(word));
}

function names(found: readonly string[]): string | null {
  return found.length === 0
    ? null
    : found.slice(0, 2).join(', ') + (found.length > 2 ? '…' : '');
}

/** Évalue la liste d'après tout le stock (maison et sacs). */
export async function getBaseGear(
  db: SqlDatabase,
  input: {
    items: readonly ItemSummary[];
    documentCount: number;
    bagNames: readonly string[];
  },
): Promise<GearReport> {
  const marks = await loadMarks(db, GEAR_SCOPE);
  const results: GearResult[] = [];
  for (const section of GEAR_SECTIONS) {
    for (const definition of section.items) {
      let detail: string | null;
      if (definition.source === 'documents') {
        detail =
          input.documentCount > 0
            ? `${input.documentCount} dans le dossier Documents`
            : null;
      } else if (definition.source === 'bags') {
        detail = names(input.bagNames);
      } else {
        detail = names(
          input.items.filter(i => gearMatches(definition, i)).map(i => i.name),
        );
      }
      results.push({
        definition,
        section,
        status:
          detail !== null
            ? 'stock'
            : marks.has(definition.id)
            ? 'checked'
            : 'missing',
        detail,
      });
    }
  }
  return {
    results,
    have: results.filter(r => r.status !== 'missing').length,
    total: results.length,
  };
}

export function setGearMark(
  db: SqlDatabase,
  id: string,
  checked: boolean,
): Promise<void> {
  return setMark(db, GEAR_SCOPE, id, checked);
}

export const GEAR_STATUS_LABELS: Record<GearStatus, string> = {
  stock: 'Dans le stock',
  checked: 'Je l’ai',
  missing: 'À prévoir',
};

function csvCell(value: string | null): string {
  const text = value ?? '';
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Tableur (CSV « ; » avec BOM UTF-8, lisible par Excel en français) : une
 * ligne par élément.
 */
export function gearCsv(report: GearReport): string {
  const lines = [
    ['Famille', 'Matériel', 'Statut', 'Dans le stock', 'Conseil'].join(';'),
  ];
  for (const r of report.results) {
    lines.push(
      [
        r.section.title,
        r.definition.label,
        GEAR_STATUS_LABELS[r.status],
        r.status === 'stock' ? r.detail : null,
        r.definition.hint ?? null,
      ]
        .map(csvCell)
        .join(';'),
    );
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Page imprimable : cases à cocher et colonne de notes à la main. */
export function gearHtml(report: GearReport, date: string): string {
  const sections = GEAR_SECTIONS.map(section => {
    const rows = report.results
      .filter(r => r.section.id === section.id)
      .map(r => {
        const box = r.status === 'missing' ? '☐' : '☑';
        const sub =
          r.status === 'stock' && r.detail
            ? `Dans le stock : ${r.detail}`
            : r.definition.hint ?? '';
        return `<tr><td class="box">${box}</td><td><b>${escapeHtml(
          r.definition.label,
        )}</b>${
          sub ? `<br><small>${escapeHtml(sub)}</small>` : ''
        }</td><td class="note"></td></tr>`;
      })
      .join('');
    return `<h2>${escapeHtml(
      section.title,
    )}</h2><table><tr><th></th><th>Matériel</th><th>Notes</th></tr>${rows}</table>`;
  }).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Matériel de base</title><style>
body{font-family:sans-serif;color:#111;margin:24px;font-size:12pt}
h1{font-size:18pt;margin:0}p{margin:4px 0 12px;color:#444}
h2{font-size:13pt;margin:16px 0 4px;border-bottom:1px solid #999}
table{width:100%;border-collapse:collapse;page-break-inside:auto}
tr{page-break-inside:avoid}
th{text-align:left;font-size:10pt;color:#555}
td{border-bottom:1px solid #ddd;padding:5px 4px;vertical-align:top}
td.box{width:22px;font-size:15pt}td.note{width:35%}
small{color:#555}
</style></head><body><h1>Matériel de base</h1><p>${escapeHtml(date)} · ${
    report.have
  } sur ${
    report.total
  } · liste indicative, à adapter au foyer.</p>${sections}</body></html>`;
}
