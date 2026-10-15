/** Données d'exemple de la démo : inventaire du vrai coffre et fiches de survie. */
import type { BundledGuide } from '../../src/db/guides';
import type { SqlDatabase } from '../../src/db/types';
import { InventoryRepository, type ItemInput } from '../../src/inventory';
import { addDays, localToday } from '../../src/lib/dates';
import { saveHousehold } from '../../src/resilience/resilienceCalculator';

export const MASTER_PIN = '482915';
export const DURESS_PIN = '730264';

type Lot = [quantity: number, expiresInDays: number | null];

const REAL_STOCK: Array<[ItemInput, Lot[]]> = [
  [
    {
      name: 'Eau en bidons',
      category: 'water',
      unit: 'L',
      location: 'Garage',
      isCritical: true,
    },
    [
      [40, 300],
      [18, 12],
    ],
  ],
  [
    {
      name: 'Eau en bouteilles',
      category: 'water',
      unit: 'L',
      location: 'Cellier',
    },
    [[9, -4]],
  ],
  [
    {
      name: 'Riz',
      category: 'food',
      unit: 'kg',
      caloriesPerUnit: 3600,
      location: 'Cellier',
    },
    [
      [5, 400],
      [2, 25],
    ],
  ],
  [
    {
      name: 'Lentilles',
      category: 'food',
      unit: 'kg',
      caloriesPerUnit: 3500,
      location: 'Cellier',
    },
    [[3, 200]],
  ],
  [
    {
      name: 'Sardines en conserve',
      category: 'food',
      unit: 'unit',
      caloriesPerUnit: 190,
      location: 'Cellier',
    },
    [[12, 700]],
  ],
  [
    {
      name: 'Rations lyophilisées',
      category: 'food',
      unit: 'unit',
      caloriesPerUnit: 600,
      location: 'Sac d’évacuation',
      isCritical: true,
    },
    [[8, 55]],
  ],
  [
    {
      name: 'Miel',
      category: 'food',
      unit: 'kg',
      caloriesPerUnit: 3040,
      location: 'Cuisine',
    },
    [[1, null]],
  ],
  [
    {
      name: 'Pastilles de purification',
      category: 'medical',
      unit: 'unit',
      location: 'Sac d’évacuation',
      isCritical: true,
    },
    [[50, 45]],
  ],
  [
    {
      name: 'Garrot tourniquet',
      category: 'medical',
      unit: 'unit',
      location: 'Sac d’évacuation',
      isCritical: true,
    },
    [[1, null]],
  ],
  [
    {
      name: 'Compresses stériles',
      category: 'medical',
      unit: 'unit',
      location: 'Salle de bain',
    },
    [[40, 80]],
  ],
  [
    {
      name: 'Piles AA',
      category: 'energy',
      unit: 'unit',
      location: 'Tiroir entrée',
    },
    [[24, 1500]],
  ],
  [
    {
      name: 'Batterie externe 20 000 mAh',
      category: 'energy',
      unit: 'unit',
      location: 'Sac d’évacuation',
    },
    [[2, null]],
  ],
  [
    {
      name: 'Radio à manivelle',
      category: 'tool',
      unit: 'unit',
      location: 'Garage',
      isCritical: true,
    },
    [[1, null]],
  ],
];

export async function seedRealVault(db: SqlDatabase): Promise<void> {
  const today = localToday();
  const repo = new InventoryRepository(db);
  for (const [item, lots] of REAL_STOCK) {
    const created = await repo.createItem(item);
    for (const [quantity, days] of lots) {
      await repo.addLot(created.id, {
        quantity,
        acquiredAt: addDays(today, -60),
        expirationDate: days === null ? null : addDays(today, days),
      });
    }
  }
  await saveHousehold(db, {
    members: 3,
    waterLitersPerPersonDay: 3,
    kcalPerPersonDay: 2000,
  });
}

export const SAMPLE_GUIDES: BundledGuide[] = [
  {
    slug: 'eau-potable',
    title: 'Rendre l’eau potable',
    category: 'Eau',
    body: [
      'Laisser décanter l’eau trouble, puis la filtrer à travers un tissu propre pour retirer les particules.',
      '- Porter à ébullition franche pendant au moins 1 minute (3 minutes au-dessus de 2 000 m d’altitude).',
      '- À défaut, utiliser des pastilles de purification en respectant la dose et le temps de contact indiqués sur la notice.',
      '- Conserver l’eau traitée dans un récipient propre et fermé.',
      'Un filtre seul ne neutralise pas tous les virus : combiner filtration et ébullition ou traitement chimique.',
    ].join('\n'),
  },
  {
    slug: 'garrot',
    title: 'Hémorragie : poser un garrot',
    category: 'Secourisme',
    body: [
      'Commencer par une compression directe et ferme de la plaie.',
      'Si la compression est impossible ou inefficace sur un membre :',
      '- Poser le garrot entre la plaie et la racine du membre, quelques centimètres au-dessus de la plaie.',
      '- Serrer jusqu’à l’arrêt du saignement.',
      '- Noter l’heure de pose et ne jamais desserrer le garrot.',
      'Alerter les secours (112) dès que possible.',
    ].join('\n'),
  },
  {
    slug: 'hypothermie',
    title: 'Hypothermie',
    category: 'Secourisme',
    body: [
      'Signes : frissons, peau froide, gestes maladroits, confusion. Dans les formes sévères, les frissons cessent.',
      '- Mettre la victime à l’abri du vent et l’isoler du sol.',
      '- Retirer les vêtements mouillés et la couvrir, tête comprise.',
      '- Si elle est consciente et avale normalement : boissons chaudes et sucrées, jamais d’alcool.',
      'En cas d’hypothermie sévère, manipuler la victime avec douceur et alerter le 112.',
    ].join('\n'),
  },
  {
    slug: 'signaux-detresse',
    title: 'Signaux de détresse',
    category: 'Signalisation',
    body: [
      'SOS en morse : trois brefs, trois longs, trois brefs (··· ––– ···), à répéter.',
      'Signal de détresse en montagne : six signaux par minute (lumière, sifflet, geste), une minute de pause, puis recommencer. La réponse est de trois signaux par minute.',
      'Numéro d’urgence européen : 112. En mer : VHF canal 16 (156,800 MHz).',
    ].join('\n'),
  },
  {
    slug: 'kit-72h',
    title: 'Kit d’urgence 72 heures',
    category: 'Préparation',
    body: [
      'De quoi tenir trois jours sans aide extérieure :',
      '- Eau : 3 litres par personne et par jour.',
      '- Nourriture ne nécessitant pas de cuisson, ouvre-boîte.',
      '- Lampe, radio à piles ou à manivelle, piles de rechange.',
      '- Trousse de secours et médicaments personnels.',
      '- Copies des papiers d’identité, argent liquide, vêtements chauds.',
    ].join('\n'),
  },
];
