/**
 * Ruptures et tensions d'approvisionnement des médicaments (Base de données
 * publique des médicaments, ANSM) comparées à la pharmacie du foyer. Le
 * fichier national est téléchargé en entier ; la comparaison se fait ici.
 */
import { medicineCis } from '../scanner/medicines';
import type { Alert, AlertLevel } from './types';
import type { StockCode } from './recalls';

export const MEDICINE_DISPO_URL =
  'https://base-donnees-publique.medicaments.gouv.fr/download/file/CIS_CIP_Dispo_Spec.txt';

/** Statut ANSM : 1 rupture, 2 tension, 3 arrêt de commercialisation. */
const STATUS: Record<string, { level: AlertLevel; title: string }> = {
  '1': { level: 'orange', title: 'Médicament en rupture de stock' },
  '2': { level: 'yellow', title: 'Médicament en tension d’approvisionnement' },
  '3': { level: 'yellow', title: 'Arrêt de commercialisation' },
};

/** `JJ/MM/AAAA` en `AAAA-MM-JJ`. */
function isoDate(text: string | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((text ?? '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function parseMedicineDispo(
  text: string,
  stock: readonly StockCode[],
): Alert[] {
  // Codes CIP 13 de la pharmacie, et leur spécialité (CIS).
  const meds = stock
    .filter(s => /^340\d{10}$/.test(s.code))
    .map(s => ({ ...s, cis: medicineCis(s.code) }));
  if (meds.length === 0) {
    return [];
  }
  const alerts = new Map<string, Alert>();
  for (const line of text.split(/\r?\n/)) {
    const [cis, cip13, status, , begin, , back, url] = line.split('\t');
    const kind = STATUS[(status ?? '').trim()];
    // Remise à disposition annoncée : plus d'alerte.
    if (kind === undefined || isoDate(back) !== null) {
      continue;
    }
    for (const m of meds) {
      // CIP 13 vide : toutes les présentations de la spécialité.
      const match =
        (cip13 ?? '').trim() === ''
          ? m.cis !== null && m.cis === (cis ?? '').trim()
          : m.code === (cip13 ?? '').trim();
      if (!match) {
        continue;
      }
      const id = `medicine:${m.code}`;
      const previous = alerts.get(id);
      if (previous && previous.level === 'orange') {
        continue;
      }
      alerts.set(id, {
        id,
        source: 'medicine',
        level: kind.level,
        title: kind.title,
        where: m.itemName,
        detail: 'Signalé par l’ANSM.',
        instruction:
          'Parlez-en à votre pharmacien ou à votre médecin avant d’épuiser votre réserve.',
        start: isoDate(begin),
        end: null,
        url: (url ?? '').trim() || null,
        itemId: m.itemId,
      });
    }
  }
  return [...alerts.values()];
}
