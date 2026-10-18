/**
 * Noms des médicaments par code CIP 13, d'après la Base de données publique
 * des médicaments (open data). La table est générée à la compilation de
 * l'APK (scripts/build-medicines.mjs) et embarquée : la reconnaissance se
 * fait sans réseau. Absente ou vide, les médicaments restent ajoutables à la
 * main.
 */

interface MedicineTable {
  generated: string | null;
  cip: Record<string, string>;
}

let table: MedicineTable | null = null;

function load(): MedicineTable {
  if (table === null) {
    try {
      // Chargée à la première lecture seulement : plusieurs mégaoctets.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const raw = require('./medicines.data.json') as Partial<MedicineTable>;
      table = { generated: raw.generated ?? null, cip: raw.cip ?? {} };
    } catch {
      table = { generated: null, cip: {} };
    }
  }
  return table;
}

/** Remplace la table (tests). */
export function setMedicineTable(next: MedicineTable | null): void {
  table = next;
}

export function medicineName(code: string): string | null {
  if (!/^340\d{10}$/.test(code)) {
    return null;
  }
  return load().cip[code] ?? null;
}

/** Date de génération et nombre de présentations connues. */
export function medicineTableInfo(): {
  generated: string | null;
  count: number;
} {
  const t = load();
  return { generated: t.generated, count: Object.keys(t.cip).length };
}
