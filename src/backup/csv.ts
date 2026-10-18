/**
 * Export du stock en tableur (CSV, séparateur « ; » et BOM UTF-8 pour Excel
 * en français) : une ligne par lot. Fichier en clair, à usage personnel
 * (impression, copie papier de secours).
 */
import type { SqlDatabase } from '../db/types';
import type { ItemCategory, ItemUnit } from '../inventory';

const HEADER = [
  'Catégorie',
  'Article',
  'Quantité',
  'Unité',
  'Péremption',
  'Emplacement',
  'Sac',
];

function cell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function stockCsv(
  db: SqlDatabase,
  labels: {
    category: Record<ItemCategory, string>;
    unit: Record<ItemUnit, string>;
  },
): Promise<string> {
  const { rows } = await db.execute(
    `SELECT i.category, i.name, l.quantity, i.unit, l.expiration_date,
            i.location, b.name AS bag
       FROM inventory_items AS i
       JOIN inventory_lots AS l ON l.item_id = i.id
       LEFT JOIN bags AS b ON b.id = i.bag_id
      WHERE l.quantity > 0
      ORDER BY b.name IS NOT NULL, b.name, i.category, i.name COLLATE NOCASE,
               l.expiration_date IS NULL, l.expiration_date`,
  );
  const lines = [HEADER.join(';')];
  for (const r of rows) {
    lines.push(
      [
        labels.category[r.category as ItemCategory] ?? r.category,
        r.name,
        String(r.quantity).replace('.', ','),
        labels.unit[r.unit as ItemUnit] ?? r.unit,
        r.expiration_date,
        r.location,
        r.bag,
      ]
        .map(cell)
        .join(';'),
    );
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
