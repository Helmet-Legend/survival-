/**
 * Matériel de base : l'équipement courant d'un foyer préparé, rangé par
 * famille. Chaque élément cite les listes officielles qui le recommandent
 * (France, États-Unis, Canada, Belgique, Croix-Rouge) ; ceux qu'aucune ne
 * cite sont marqués « conseil courant ». Chaque élément est reconnu dans le
 * stock (maison et sacs) ou coché à la main. Le volet armes n'apparaît que
 * si une arme est enregistrée, ou sur demande.
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
  /** Armement : munitions ou accessoires. */
  recordType?: 'ammo' | 'accessory';
  /** Mots du nom qui conviennent aussi (sans accents, minuscules). */
  names?: readonly string[];
  /** Vérifié ailleurs que dans le stock. */
  source?: 'documents' | 'bags';
  /** Où l'ajouter : fiche (catégorie, type d'arme) et valeurs préremplies. */
  add?: {
    category: ItemCategory;
    recordType?: 'ammo' | 'accessory';
    prefill?: Record<string, string>;
  };
  /** Listes officielles qui le recommandent ; vide : conseil courant. */
  refs: readonly GearRef[];
}

export type GearRef =
  | 'sgdsn'
  | 'georisques'
  | 'readygov'
  | 'canada'
  | 'belgique'
  | 'croixrouge'
  | 'bbk'
  | 'msb'
  | 'tuntia'
  | 'luxembourg'
  | 'csi';

/**
 * Listes consultées (octobre 2026). Une référence n'est portée que si la
 * liste cite l'élément ; la presse et les sites marchands ne comptent pas.
 */
export const GEAR_REFS: Record<GearRef, { short: string; title: string }> = {
  sgdsn: {
    short: 'SGDSN',
    title:
      'Guide « Tous responsables : face aux risques, agissons » (SGDSN, 2025)',
  },
  georisques: {
    short: 'Géorisques',
    title: 'Mon kit d’urgence 72 h (Géorisques, Sécurité civile)',
  },
  readygov: {
    short: 'Ready.gov',
    title: 'Build a Kit (Ready.gov, FEMA, États-Unis)',
  },
  canada: {
    short: 'Canada',
    title: 'Trousse d’urgence (Préparez-vous, gouvernement du Canada)',
  },
  belgique: {
    short: 'Belgique',
    title: 'Kit d’urgence (Centre de crise national, Belgique)',
  },
  croixrouge: {
    short: 'Croix-Rouge',
    title: 'Catakit, sac d’urgence (Croix-Rouge française, association)',
  },
  bbk: {
    short: 'Allemagne',
    title:
      'Checkliste Notfallvorsorge (Office fédéral de protection civile BBK, Allemagne)',
  },
  msb: {
    short: 'Suède',
    title: 'Om krisen eller kriget kommer (MSB, Suède, novembre 2024)',
  },
  tuntia: {
    short: 'Finlande',
    title:
      'Varautuminen kotona (campagne officielle 72 tuntia, Finlande, 2025)',
  },
  luxembourg: {
    short: 'Luxembourg',
    title:
      'Kit en situation d’urgence (infocrise.lu, gouvernement du Luxembourg)',
  },
  csi: {
    short: 'Code de la sécurité intérieure',
    title:
      'Code de la sécurité intérieure, conservation des armes détenues (articles R314)',
  },
};

export const UNOFFICIAL_LABEL = 'Conseil courant, hors listes officielles';

/** « SGDSN, Géorisques », ou le libellé du conseil courant. */
export function gearRefsLabel(gear: GearDefinition): string {
  return gear.refs.length === 0
    ? UNOFFICIAL_LABEL
    : gear.refs.map(r => GEAR_REFS[r].short).join(', ');
}

export interface GearSection {
  id: string;
  title: string;
  /**
   * Volet armes : affiché si une arme est enregistrée ou sur demande ; les
   * exports n'y citent aucun article (statut seulement).
   */
  weapons?: boolean;
  items: readonly GearDefinition[];
}

export const GEAR_SECTIONS: readonly GearSection[] = [
  {
    id: 'water',
    title: 'Eau',
    items: [
      {
        id: 'water_reserve',
        refs: [
          'sgdsn',
          'georisques',
          'readygov',
          'canada',
          'belgique',
          'croixrouge',
          'bbk',
          'msb',
          'tuntia',
          'luxembourg',
        ],
        label: 'Réserve d’eau potable',
        hint: '6 L par personne pour 72 h (2 L par jour), en bouteilles.',
        category: 'water',
        excludeSubtypes: ['filter'],
        add: { category: 'water' },
      },
      {
        id: 'water_tablets',
        refs: ['canada', 'sgdsn'],
        label: 'Pastilles de purification',
        names: ['pastille', 'purification', 'micropur', 'aquatabs'],
        add: {
          category: 'medical',
          prefill: { name: 'Pastilles de purification', subtype: 'other' },
        },
      },
      {
        id: 'bleach',
        refs: ['canada'],
        label: 'Eau de Javel non parfumée',
        hint: 'Pour désinfecter l’eau : suivre le dosage indiqué par les autorités sanitaires.',
        names: ['javel'],
        add: {
          category: 'medical',
          prefill: { name: 'Eau de Javel', subtype: 'hygiene' },
        },
      },
      {
        id: 'water_container',
        refs: ['croixrouge', 'bbk', 'msb', 'tuntia'],
        label: 'Jerrican ou bidon pliable vide',
        hint: 'Pour aller chercher de l’eau à un point de distribution.',
        names: ['jerrican', 'bidon vide', 'bidon pliable', 'container pliable'],
      },
      {
        id: 'water_filter',
        refs: [],
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
        id: 'water_bottle',
        refs: ['bbk'],
        label: 'Gourde réutilisable',
        names: ['gourde', 'nalgene'],
        add: {
          category: 'energy',
          prefill: { name: 'Gourde', subtype: 'other' },
        },
      },
    ],
  },
  {
    id: 'food',
    title: 'Alimentation',
    items: [
      {
        id: 'food',
        refs: [
          'sgdsn',
          'georisques',
          'readygov',
          'canada',
          'belgique',
          'bbk',
          'msb',
          'tuntia',
          'luxembourg',
        ],
        label: 'Vivres non périssables',
        hint: 'De préférence sans cuisson.',
        category: 'food',
        add: { category: 'food' },
      },
      {
        id: 'can_opener',
        refs: [
          'sgdsn',
          'readygov',
          'canada',
          'georisques',
          'bbk',
          'msb',
          'luxembourg',
        ],
        label: 'Ouvre-boîte manuel',
        names: ['ouvre-boite', 'ouvre boite', 'ouvre-boites'],
        add: {
          category: 'tool',
          prefill: { name: 'Ouvre-boîte manuel', subtype: 'other' },
        },
      },
      {
        id: 'stove',
        refs: ['canada', 'sgdsn', 'bbk', 'msb', 'tuntia', 'luxembourg'],
        label: 'Petit réchaud',
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
        refs: ['canada', 'bbk', 'msb'],
        label: 'Combustible pour le réchaud',
        hint: 'Cartouches de gaz, alcool à brûler, tablettes…',
        category: 'power',
        subtypes: ['gas', 'fuel'],
        names: ['cartouche', 'alcool a bruler', 'esbit'],
        add: { category: 'power', prefill: { subtype: 'gas' } },
      },
      {
        id: 'baby',
        refs: ['georisques', 'canada', 'belgique', 'sgdsn', 'msb'],
        label: 'Lait infantile, petits pots et couches',
        hint: 'Si le foyer compte un bébé.',
        names: [
          'lait infantile',
          'lait en poudre',
          'petit pot',
          'petits pots',
          'couches bebe',
          'couches jetables',
        ],
        add: { category: 'food' },
      },
      {
        id: 'pets',
        refs: [
          'canada',
          'belgique',
          'sgdsn',
          'georisques',
          'bbk',
          'msb',
          'tuntia',
        ],
        label: 'Nourriture et affaires des animaux',
        hint: 'Si vous avez des animaux : nourriture, laisse, cage de transport.',
        names: ['croquette', 'patee', 'litiere', 'animaux'],
        add: { category: 'food' },
      },
      {
        id: 'cookware',
        refs: ['bbk', 'canada'],
        label: 'Gamelle et couverts',
        names: ['gamelle', 'popote', 'couverts'],
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
        refs: [
          'sgdsn',
          'georisques',
          'readygov',
          'canada',
          'belgique',
          'croixrouge',
          'bbk',
          'msb',
          'tuntia',
          'luxembourg',
        ],
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
        refs: [
          'sgdsn',
          'georisques',
          'readygov',
          'canada',
          'belgique',
          'bbk',
          'msb',
          'tuntia',
          'luxembourg',
        ],
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
        refs: [
          'georisques',
          'belgique',
          'sgdsn',
          'canada',
          'bbk',
          'msb',
          'tuntia',
          'luxembourg',
        ],
        label: 'Batterie externe et chargeur de téléphone',
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
        refs: ['sgdsn', 'georisques', 'canada', 'bbk', 'msb', 'luxembourg'],
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
        refs: [
          'sgdsn',
          'georisques',
          'readygov',
          'canada',
          'croixrouge',
          'bbk',
          'msb',
          'tuntia',
          'luxembourg',
        ],
        label: 'Briquet ou allumettes',
        names: ['briquet', 'allumette', 'ferro'],
        add: {
          category: 'power',
          prefill: { name: 'Briquet', subtype: 'other' },
        },
      },
      {
        id: 'glowsticks',
        refs: ['croixrouge'],
        label: 'Bâtons lumineux de secours',
        hint: 'Éclairent sans pile ni flamme.',
        names: ['baton lumineux', 'batons lumineux', 'cyalume', 'lightstick'],
        add: {
          category: 'energy',
          prefill: { name: 'Bâtons lumineux', subtype: 'lighting' },
        },
      },
      {
        id: 'solar',
        refs: [],
        label: 'Station d’énergie ou panneau solaire',
        hint: 'Pour recharger téléphones, radio et lampes sans réseau.',
        category: 'power',
        subtypes: ['solar', 'generator'],
        add: { category: 'power', prefill: { subtype: 'solar' } },
      },
    ],
  },
  {
    id: 'communication',
    title: 'Information et orientation',
    items: [
      {
        id: 'radio',
        refs: [
          'sgdsn',
          'georisques',
          'readygov',
          'canada',
          'belgique',
          'bbk',
          'msb',
          'tuntia',
          'luxembourg',
        ],
        label: 'Radio à piles ou à manivelle',
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
        id: 'car_charger',
        refs: ['msb'],
        label: 'Chargeur de téléphone pour la voiture',
        names: ['allume-cigare', 'chargeur voiture', 'chargeur de voiture'],
        add: {
          category: 'power',
          prefill: { name: 'Chargeur de voiture', subtype: 'other' },
        },
      },
      {
        id: 'whistle',
        refs: ['readygov', 'canada', 'belgique'],
        label: 'Sifflet',
        hint: 'Pour signaler sa présence aux secours.',
        names: ['sifflet'],
        add: {
          category: 'tool',
          prefill: { name: 'Sifflet', subtype: 'other' },
        },
      },
      {
        id: 'contacts',
        refs: ['belgique', 'canada', 'bbk', 'msb', 'luxembourg'],
        label: 'Numéros utiles notés sur papier, stylo',
        hint: 'Famille et urgences : sans téléphone, plus de répertoire.',
      },
      {
        id: 'family_plan',
        refs: ['canada'],
        label: 'Copie papier du plan familial',
        hint: 'Points de regroupement et rôles (Préparer → Plan familial).',
      },
      {
        id: 'paper_map',
        refs: ['readygov', 'canada', 'msb'],
        label: 'Carte routière papier',
        names: ['carte routiere', 'carte ign', 'carte papier', 'atlas'],
        add: {
          category: 'energy',
          prefill: { name: 'Carte routière', subtype: 'navigation' },
        },
      },
      {
        id: 'compass',
        refs: ['msb'],
        label: 'Boussole',
        names: ['boussole'],
        add: {
          category: 'energy',
          prefill: { name: 'Boussole', subtype: 'navigation' },
        },
      },
    ],
  },
  {
    id: 'health',
    title: 'Santé et hygiène',
    items: [
      {
        id: 'firstaid',
        refs: [
          'sgdsn',
          'georisques',
          'readygov',
          'canada',
          'belgique',
          'croixrouge',
          'bbk',
          'msb',
          'tuntia',
          'luxembourg',
        ],
        label: 'Trousse de premiers secours',
        category: 'medical',
        subtypes: ['dressing', 'antiseptic'],
        names: ['trousse', 'pansement', 'compresse'],
        add: { category: 'medical' },
      },
      {
        id: 'medicine',
        refs: [
          'sgdsn',
          'georisques',
          'readygov',
          'canada',
          'belgique',
          'bbk',
          'msb',
          'tuntia',
          'luxembourg',
        ],
        label: 'Médicaments habituels',
        hint: 'Vos traitements, une copie des ordonnances, et les médicaments courants conseillés par votre pharmacien.',
        category: 'medical',
        subtypes: ['medicine'],
        add: { category: 'medical', prefill: { subtype: 'medicine' } },
      },
      {
        id: 'thermometer',
        refs: ['bbk'],
        label: 'Thermomètre médical',
        category: 'medical',
        subtypes: ['diagnostic'],
        names: ['thermometre'],
        add: {
          category: 'medical',
          prefill: { name: 'Thermomètre', subtype: 'diagnostic' },
        },
      },
      {
        id: 'pain_fever',
        refs: ['bbk', 'luxembourg'],
        label: 'Médicament contre la douleur et la fièvre',
        hint: 'Paracétamol par exemple, sur conseil de votre pharmacien.',
        names: [
          'paracetamol',
          'doliprane',
          'dafalgan',
          'efferalgan',
          'ibuprofene',
          'antalgique',
        ],
        add: { category: 'medical', prefill: { subtype: 'medicine' } },
      },
      {
        id: 'digestive',
        refs: ['bbk'],
        label: 'Médicament contre la diarrhée et les nausées',
        hint: 'Sur conseil de votre pharmacien.',
        names: ['diarrhee', 'smecta', 'imodium', 'loperamide', 'nausee'],
        add: { category: 'medical', prefill: { subtype: 'medicine' } },
      },
      {
        id: 'electrolytes',
        refs: ['bbk'],
        label: 'Sels de réhydratation orale',
        names: ['rehydratation', 'electrolyte'],
        add: {
          category: 'medical',
          prefill: { name: 'Sels de réhydratation', subtype: 'medicine' },
        },
      },
      {
        id: 'iodine',
        refs: ['tuntia'],
        label: 'Comprimés d’iode',
        hint: 'À ne prendre que sur consigne des autorités (préfet).',
        names: ['iode', 'iodure'],
        add: {
          category: 'medical',
          prefill: { name: 'Comprimés d’iode', subtype: 'medicine' },
        },
      },
      {
        id: 'tweezers',
        refs: ['bbk', 'canada', 'luxembourg'],
        label: 'Pince à épiler et ciseaux',
        names: ['pince a epiler', 'ciseaux'],
        add: {
          category: 'medical',
          prefill: { name: 'Pince à épiler', subtype: 'other' },
        },
      },
      {
        id: 'sunscreen',
        refs: ['bbk', 'canada'],
        label: 'Crème solaire et anti-moustiques',
        names: ['solaire', 'moustique', 'repulsif'],
        add: { category: 'medical', prefill: { subtype: 'hygiene' } },
      },
      {
        id: 'medical_aids',
        refs: ['bbk', 'msb', 'canada'],
        label: 'Aides et matériel médical de rechange',
        hint: 'Appareil auditif et ses piles, matériel habituel (diabète…).',
        names: ['auditif'],
        add: { category: 'medical', prefill: { subtype: 'other' } },
      },
      {
        id: 'gas_mask',
        refs: [],
        label: 'Masque respiratoire à cartouches',
        hint: 'Demi-masque ou masque intégral, avec des filtres adaptés (norme EN 14387).',
        names: ['masque a gaz', 'cartouche', 'abek'],
        add: {
          category: 'medical',
          prefill: { name: 'Masque à cartouches', subtype: 'protection' },
        },
      },
      {
        id: 'glasses',
        refs: ['sgdsn', 'georisques', 'readygov', 'canada', 'bbk'],
        label: 'Lunettes de rechange',
        hint: 'Si vous en portez ; et le produit pour lentilles.',
        names: ['lunettes de vue', 'lunettes de rechange'],
      },
      {
        id: 'masks',
        refs: ['readygov', 'canada', 'croixrouge', 'sgdsn', 'bbk', 'tuntia'],
        label: 'Masques anti-poussière (FFP2)',
        names: ['masque', 'ffp2'],
        add: {
          category: 'medical',
          prefill: { name: 'Masques FFP2', subtype: 'protection' },
        },
      },
      {
        id: 'disposable_gloves',
        refs: ['croixrouge', 'bbk', 'canada'],
        label: 'Gants jetables',
        names: ['gants jetables', 'gants nitrile', 'gants latex'],
        add: {
          category: 'medical',
          prefill: { name: 'Gants jetables', subtype: 'protection' },
        },
      },
      {
        id: 'hygiene',
        refs: [
          'readygov',
          'canada',
          'sgdsn',
          'bbk',
          'msb',
          'tuntia',
          'luxembourg',
        ],
        label: 'Savon, gel hydroalcoolique et articles de toilette',
        hint: 'Avec les protections hygiéniques si besoin.',
        category: 'medical',
        subtypes: ['hygiene'],
        names: ['savon', 'gel hydro', 'dentifrice', 'brosse a dents'],
        add: { category: 'medical', prefill: { subtype: 'hygiene' } },
      },
      {
        id: 'wipes',
        refs: ['readygov', 'belgique', 'bbk', 'msb'],
        label: 'Lingettes humides',
        hint: 'Pour se laver sans eau courante.',
        names: ['lingette'],
        add: {
          category: 'medical',
          prefill: { name: 'Lingettes', subtype: 'hygiene' },
        },
      },
      {
        id: 'toilet_paper',
        refs: ['canada', 'bbk', 'msb', 'tuntia'],
        label: 'Papier toilette',
        names: ['papier toilette', 'papier hygienique'],
        add: {
          category: 'medical',
          prefill: { name: 'Papier toilette', subtype: 'hygiene' },
        },
      },
      {
        id: 'trash_bags',
        refs: ['readygov', 'canada', 'bbk', 'msb', 'tuntia'],
        label: 'Sacs poubelle et attaches',
        hint: 'Déchets et toilettes de fortune.',
        names: [
          'sac poubelle',
          'sacs poubelle',
          'sac-poubelle',
          'sac a ordures',
        ],
        add: {
          category: 'tool',
          prefill: { name: 'Sacs poubelle', subtype: 'other' },
        },
      },
      {
        id: 'bucket',
        refs: ['msb'],
        label: 'Seau avec couvercle',
        hint: 'Toilettes de fortune, avec des sacs poubelle et de la sciure ou de la litière.',
        names: ['seau'],
        add: {
          category: 'tool',
          prefill: { name: 'Seau avec couvercle', subtype: 'other' },
        },
      },
      {
        id: 'paper_towels',
        refs: ['canada', 'bbk'],
        label: 'Essuie-tout et mouchoirs',
        names: ['essuie', 'mouchoir'],
        add: { category: 'medical', prefill: { subtype: 'hygiene' } },
      },
    ],
  },
  {
    id: 'shelter',
    title: 'Chaleur et abri',
    items: [
      {
        id: 'survival_blanket',
        refs: ['sgdsn', 'georisques', 'croixrouge'],
        label: 'Couverture de survie',
        names: ['couverture de survie', 'couverture survie', 'mylar'],
        add: {
          category: 'energy',
          prefill: { name: 'Couverture de survie', subtype: 'sleeping' },
        },
      },
      {
        id: 'sleeping',
        refs: ['readygov', 'canada', 'belgique', 'bbk', 'msb', 'luxembourg'],
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
        refs: ['sgdsn', 'georisques', 'belgique', 'bbk', 'msb', 'tuntia'],
        label: 'Vêtements chauds',
        hint: 'Bonnet, gants, écharpe, vêtements en laine.',
        category: 'energy',
        subtypes: ['protection'],
        names: ['vetement', 'polaire', 'poncho', 'impermeable', 'veste'],
        add: { category: 'energy', prefill: { subtype: 'protection' } },
      },
      {
        id: 'rain_gear',
        refs: ['bbk', 'msb', 'canada'],
        label: 'Vêtements de pluie',
        hint: 'Poncho ou veste imperméable.',
        names: ['poncho', 'impermeable', 'pluie'],
        add: {
          category: 'energy',
          prefill: { name: 'Poncho', subtype: 'protection' },
        },
      },
      {
        id: 'change_clothes',
        refs: ['readygov', 'canada', 'bbk', 'luxembourg'],
        label: 'Vêtements et chaussures de rechange',
        hint: 'Des chaussures solides, pour marcher.',
        names: ['chaussure', 'bottes', 'vetements de rechange'],
      },
      {
        id: 'tarp',
        refs: ['readygov', 'canada'],
        label: 'Bâche ou film plastique',
        hint: 'Avec le ruban adhésif, pour calfeutrer une pièce.',
        category: 'energy',
        subtypes: ['shelter'],
        names: ['bache', 'film plastique', 'tarp'],
        add: {
          category: 'energy',
          prefill: { name: 'Bâche', subtype: 'shelter' },
        },
      },
      {
        id: 'heater',
        refs: ['bbk', 'msb'],
        label: 'Chauffage d’appoint sans électricité',
        hint: 'Pétrole ou gaz : aérer souvent et l’éteindre avant de dormir.',
        names: ['chauffage', 'poele a petrole', 'radiateur a gaz'],
        add: { category: 'energy', prefill: { subtype: 'other' } },
      },
      {
        id: 'heater_fuel',
        refs: ['bbk', 'msb', 'tuntia'],
        label: 'Combustible du chauffage',
        hint: 'Pétrole, gaz, ou bois sec pour une cheminée ou un poêle.',
        category: 'power',
        subtypes: ['wood'],
        names: ['petrole', 'bois de chauffage', 'buche', 'granule'],
        add: { category: 'power', prefill: { subtype: 'wood' } },
      },
    ],
  },
  {
    id: 'tools',
    title: 'Outils',
    items: [
      {
        id: 'knife',
        refs: [
          'sgdsn',
          'canada',
          'belgique',
          'croixrouge',
          'georisques',
          'bbk',
          'luxembourg',
        ],
        label: 'Couteau multifonction',
        category: 'tool',
        subtypes: ['cutting', 'multitool'],
        names: ['couteau', 'multi-outil', 'multitool', 'leatherman'],
        add: { category: 'tool', prefill: { subtype: 'multitool' } },
      },
      {
        id: 'hand_tools',
        refs: ['readygov', 'canada'],
        label: 'Pince ou clé pour couper gaz et eau',
        hint: 'Repérez les robinets d’arrêt à l’avance.',
        category: 'tool',
        subtypes: ['clamping', 'mechanical'],
        names: ['pince', 'cle a molette', 'cle anglaise', 'tournevis'],
        add: { category: 'tool', prefill: { subtype: 'clamping' } },
      },
      {
        id: 'duct_tape',
        refs: ['readygov', 'canada', 'tuntia'],
        label: 'Ruban adhésif renforcé',
        names: ['adhesif', 'scotch', 'duct', 'chatterton'],
        add: {
          category: 'tool',
          prefill: { name: 'Ruban adhésif renforcé', subtype: 'repair' },
        },
      },
      {
        id: 'work_gloves',
        refs: ['canada', 'bbk'],
        label: 'Gants de travail',
        names: ['gants de travail', 'gants de protection', 'gants cuir'],
        add: {
          category: 'tool',
          prefill: { name: 'Gants de travail', subtype: 'other' },
        },
      },
      {
        id: 'extinguisher',
        refs: ['readygov', 'bbk', 'msb', 'tuntia'],
        label: 'Extincteur',
        names: ['extincteur'],
        add: {
          category: 'tool',
          prefill: { name: 'Extincteur', subtype: 'other' },
        },
      },
      {
        id: 'fire_blanket',
        refs: ['tuntia'],
        label: 'Couverture anti-feu',
        names: ['anti-feu', 'anti feu', 'ignifuge'],
        add: {
          category: 'tool',
          prefill: { name: 'Couverture anti-feu', subtype: 'other' },
        },
      },
      {
        id: 'smoke_detector',
        refs: ['bbk'],
        label: 'Détecteur de fumée',
        hint: 'Obligatoire dans tout logement en France.',
        names: ['detecteur de fumee', 'daaf'],
        add: {
          category: 'tool',
          prefill: { name: 'Détecteur de fumée', subtype: 'other' },
        },
      },
      {
        id: 'co_detector',
        refs: ['bbk'],
        label: 'Détecteur de monoxyde de carbone',
        hint: 'Avec un chauffage d’appoint, un réchaud ou un groupe électrogène.',
        names: ['monoxyde'],
        add: {
          category: 'tool',
          prefill: {
            name: 'Détecteur de monoxyde de carbone',
            subtype: 'other',
          },
        },
      },
      {
        id: 'rope',
        refs: [],
        label: 'Corde ou paracorde',
        names: ['corde', 'paracorde', 'cordelette'],
        add: {
          category: 'tool',
          prefill: { name: 'Paracorde', subtype: 'other' },
        },
      },
    ],
  },
  {
    id: 'vehicle',
    title: 'Véhicule',
    items: [
      {
        id: 'car_fuel',
        refs: ['msb'],
        label: 'Réservoir de la voiture plein',
        hint: 'Ou batterie chargée pour une voiture électrique.',
      },
      {
        id: 'fuel_cans',
        refs: [],
        label: 'Jerricans de carburant',
        hint: 'Homologués pour le carburant.',
        category: 'power',
        subtypes: ['fuel'],
        add: {
          category: 'power',
          prefill: { name: 'Jerrican de carburant', subtype: 'fuel' },
        },
      },
      {
        id: 'jumper_cables',
        refs: [],
        label: 'Câbles de démarrage ou booster',
        names: ['demarrage', 'booster'],
        add: {
          category: 'tool',
          prefill: { name: 'Câbles de démarrage', subtype: 'other' },
        },
      },
      {
        id: 'tyre_kit',
        refs: [],
        label: 'Kit anti-crevaison',
        names: ['crevaison'],
        add: {
          category: 'tool',
          prefill: { name: 'Kit anti-crevaison', subtype: 'repair' },
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
        refs: [
          'sgdsn',
          'georisques',
          'canada',
          'belgique',
          'bbk',
          'msb',
          'luxembourg',
        ],
        label: 'Copies des documents essentiels',
        hint: 'Pièces d’identité, carte Vitale, assurances, dans une pochette étanche.',
        source: 'documents',
      },
      {
        id: 'cash',
        refs: [
          'sgdsn',
          'georisques',
          'canada',
          'belgique',
          'bbk',
          'msb',
          'tuntia',
          'luxembourg',
        ],
        label: 'Argent liquide',
        hint: 'Les paiements par carte peuvent être coupés.',
      },
      {
        id: 'keys',
        refs: ['sgdsn', 'georisques', 'canada', 'luxembourg'],
        label: 'Double des clés (maison, voiture)',
      },
      {
        id: 'bag',
        refs: ['belgique', 'croixrouge'],
        label: 'Sac d’évacuation prêt',
        hint: 'Un sac à dos facile à emporter, rangé près de la sortie.',
        source: 'bags',
      },
      {
        id: 'kids',
        refs: ['belgique', 'sgdsn', 'georisques', 'canada', 'luxembourg'],
        label: 'Jeux ou livres pour les enfants',
        hint: 'Si le foyer compte des enfants.',
      },
    ],
  },
  {
    id: 'weapons',
    title: 'Armes (si vous en détenez)',
    weapons: true,
    items: [
      {
        id: 'weapon_safe',
        refs: ['csi'],
        label: 'Coffre-fort ou armoire forte',
        hint: 'Catégories B et C : la loi impose un coffre-fort, une armoire forte ou un moyen équivalent.',
        names: ['coffre-fort', 'coffre fort', 'armoire forte'],
        add: {
          category: 'weapon',
          recordType: 'accessory',
          prefill: { name: 'Coffre-fort', accessoryType: 'case' },
        },
      },
      {
        id: 'weapon_lock',
        refs: [],
        label: 'Verrou de pontet ou câble de sécurité',
        names: ['verrou de pontet', 'cable de securite', 'cadenas'],
        add: {
          category: 'weapon',
          recordType: 'accessory',
          prefill: { name: 'Verrou de pontet', accessoryType: 'other' },
        },
      },
      {
        id: 'ammo',
        refs: [],
        label: 'Munitions adaptées à vos armes',
        hint: 'Rangées à part, au sec.',
        category: 'weapon',
        recordType: 'ammo',
        add: { category: 'weapon', recordType: 'ammo' },
      },
      {
        id: 'magazines',
        refs: [],
        label: 'Chargeurs de rechange',
        hint: 'Selon l’arme.',
        category: 'weapon',
        recordType: 'accessory',
        subtypes: ['magazine'],
        names: ['chargeur de rechange', 'chargeurs'],
        add: {
          category: 'weapon',
          recordType: 'accessory',
          prefill: { accessoryType: 'magazine' },
        },
      },
      {
        id: 'cleaning',
        refs: [],
        label: 'Nécessaire de nettoyage et d’entretien',
        category: 'weapon',
        recordType: 'accessory',
        subtypes: ['cleaning'],
        names: ['nettoyage', 'ecouvillon', 'entretien'],
        add: {
          category: 'weapon',
          recordType: 'accessory',
          prefill: { accessoryType: 'cleaning' },
        },
      },
      {
        id: 'weapon_case',
        refs: [],
        label: 'Étui ou mallette de transport',
        category: 'weapon',
        recordType: 'accessory',
        subtypes: ['case'],
        names: ['etui', 'mallette', 'housse', 'fourreau'],
        add: {
          category: 'weapon',
          recordType: 'accessory',
          prefill: { accessoryType: 'case' },
        },
      },
      {
        id: 'shooting_protection',
        refs: [],
        label: 'Protections auditives et lunettes de tir',
        names: [
          'protection auditive',
          'casque anti-bruit',
          'casque antibruit',
          'bouchons',
          'lunettes de tir',
        ],
        add: {
          category: 'weapon',
          recordType: 'accessory',
          prefill: {
            name: 'Protections auditives',
            accessoryType: 'other',
          },
        },
      },
      {
        id: 'weapon_papers',
        refs: [],
        label: 'Copies des titres de détention',
        hint: 'Permis de chasser validé ou licence de tir, autorisations, récépissés : rangés à part des armes.',
      },
      {
        id: 'tourniquet',
        refs: [],
        label: 'Garrot tourniquet',
        hint: 'Utile seulement avec une formation aux gestes de secours.',
        names: ['garrot', 'tourniquet'],
        add: {
          category: 'medical',
          prefill: { name: 'Garrot tourniquet', subtype: 'dressing' },
        },
      },
    ],
  },
];

/** Coche qui affiche le volet armes sans arme enregistrée. */
export const SHOW_WEAPONS_MARK = 'show_weapons';

export type GearStatus = 'stock' | 'checked' | 'missing';

export interface GearResult {
  definition: GearDefinition;
  section: GearSection;
  status: GearStatus;
  /** Ce qui a été trouvé (« Lampe frontale, Torche »), ou « 6 j sur 3 ». */
  detail: string | null;
  /** Eau et vivres comptés en jours : ni coche ni « dans le stock ». */
  counted?: boolean;
}

export interface GearReport {
  results: GearResult[];
  have: number;
  total: number;
  /** Éléments du kit 72 h officiel (SGDSN) présents, sur leur total. */
  essentialHave: number;
  essentialTotal: number;
  /** Volet armes inclus. */
  weapons: boolean;
  /** Aucune arme enregistrée : le volet armes s'affiche à la demande. */
  weaponsOptional: boolean;
}

/**
 * Ce qu'un export peut citer du stock : rien pour le volet armes (une
 * feuille imprimée ou un tableur sort du coffre chiffré).
 */
function exportDetail(r: GearResult): string | null {
  return (r.status === 'stock' || r.counted === true) && !r.section.weapons
    ? r.detail
    : null;
}

function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Un article utilisable (lots non périmés) correspond-il à l'élément ? Un
 * article d'armement ne compte que pour un élément d'armement, reconnu par
 * son genre (munition ou accessoire), son type ou son nom.
 */
export function gearMatches(gear: GearDefinition, item: ItemSummary): boolean {
  if (item.usableQuantity <= 0) {
    return false;
  }
  if ((item.category === 'weapon') !== (gear.category === 'weapon')) {
    // Un coffre-fort ou un garrot peut être rangé dans une autre catégorie.
    return (
      item.category !== 'weapon' &&
      gear.category === undefined &&
      matchesName(gear, item)
    );
  }
  if (gear.category === 'weapon') {
    if (item.attributes.recordType !== gear.recordType) {
      return false;
    }
    return (
      (gear.subtypes === undefined && gear.names === undefined) ||
      (item.subtype !== null && (gear.subtypes ?? []).includes(item.subtype)) ||
      matchesName(gear, item)
    );
  }
  if (gear.category === item.category) {
    if (gear.subtypes === undefined) {
      return !(gear.excludeSubtypes ?? []).includes(item.subtype ?? '');
    }
    if (item.subtype !== null && gear.subtypes.includes(item.subtype)) {
      return true;
    }
  }
  return matchesName(gear, item);
}

function matchesName(gear: GearDefinition, item: ItemSummary): boolean {
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
    /** Nombre d'armes enregistrées : le volet armes s'affiche s'il y en a. */
    weaponCount: number;
    /**
     * Jours d'eau et de vivres du foyer, et jours demandés (palier) : l'eau
     * et les vivres se comptent alors en jours, comme pour l'indice.
     */
    autonomy?: { days: number; water: number; food: number };
  },
): Promise<GearReport> {
  const [own, home] = await Promise.all([
    loadMarks(db, GEAR_SCOPE),
    loadMarks(db, 'home'),
  ]);
  const marks = new Set([
    ...own,
    ...[...home].filter(id => SHARED_MARKS.has(id)),
  ]);
  const { autonomy } = input;
  const weapons = input.weaponCount > 0 || marks.has(SHOW_WEAPONS_MARK);
  const results: GearResult[] = [];
  for (const section of GEAR_SECTIONS) {
    if (section.weapons && !weapons) {
      continue;
    }
    for (const definition of section.items) {
      const days =
        autonomy === undefined
          ? undefined
          : definition.id === 'water_reserve'
          ? autonomy.water
          : definition.id === 'food'
          ? autonomy.food
          : undefined;
      if (autonomy !== undefined && days !== undefined) {
        results.push({
          definition,
          section,
          status: days >= autonomy.days ? 'stock' : 'missing',
          detail: `${days} j sur ${autonomy.days}`,
          counted: true,
        });
        continue;
      }
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
  const essentials = results.filter(r => isEssential(r.definition));
  return {
    results,
    have: results.filter(r => r.status !== 'missing').length,
    total: results.length,
    essentialHave: essentials.filter(r => r.status !== 'missing').length,
    essentialTotal: essentials.length,
    weapons,
    weaponsOptional: input.weaponCount === 0,
  };
}

/**
 * Coches communes avec le kit 72 h de la maison (`preparation_marks`,
 * périmètre `home`) : l'indice de préparation les lit là.
 */
const SHARED_MARKS: ReadonlySet<string> = new Set(['cash', 'keys']);

export async function setGearMark(
  db: SqlDatabase,
  id: string,
  checked: boolean,
): Promise<void> {
  if (SHARED_MARKS.has(id)) {
    await setMark(db, GEAR_SCOPE, id, false);
    await setMark(db, 'home', id, checked);
    return;
  }
  await setMark(db, GEAR_SCOPE, id, checked);
}

/** Élément du kit 72 h officiel (guide « Tous responsables »). */
export function isEssential(gear: GearDefinition): boolean {
  return gear.refs.includes('sgdsn');
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
    [
      'Famille',
      'Matériel',
      'Statut',
      'Dans le stock',
      'Conseil',
      'Source',
    ].join(';'),
  ];
  for (const r of report.results) {
    lines.push(
      [
        r.section.title,
        r.definition.label,
        GEAR_STATUS_LABELS[r.status],
        exportDetail(r),
        r.definition.hint ?? null,
        gearRefsLabel(r.definition),
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
    const results = report.results.filter(r => r.section.id === section.id);
    if (results.length === 0) {
      return '';
    }
    const rows = results
      .map(r => {
        const box = r.status === 'missing' ? '☐' : '☑';
        const detail = exportDetail(r);
        const sub = detail
          ? `Dans le stock : ${detail}`
          : r.definition.hint ?? '';
        return `<tr><td class="box">${box}</td><td><b>${escapeHtml(
          r.definition.label,
        )}</b>${
          sub ? `<br><small>${escapeHtml(sub)}</small>` : ''
        }</td><td class="src">${escapeHtml(
          r.definition.refs.length === 0
            ? 'Conseil courant'
            : gearRefsLabel(r.definition),
        )}</td><td class="note"></td></tr>`;
      })
      .join('');
    return `<h2>${escapeHtml(
      section.title,
    )}</h2><table><tr><th></th><th>Matériel</th><th>Source</th><th>Notes</th></tr>${rows}</table>`;
  }).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Kit et matériel</title><style>
body{font-family:sans-serif;color:#111;margin:24px;font-size:12pt}
h1{font-size:18pt;margin:0}p{margin:4px 0 12px;color:#444}
h2{font-size:13pt;margin:16px 0 4px;border-bottom:1px solid #999}
table{width:100%;border-collapse:collapse;page-break-inside:auto}
tr{page-break-inside:avoid}
th{text-align:left;font-size:10pt;color:#555}
td{border-bottom:1px solid #ddd;padding:5px 4px;vertical-align:top}
td.box{width:22px;font-size:15pt}td.note{width:30%}
td.src{width:18%;font-size:9pt;color:#555}
footer{margin-top:16px;font-size:9pt;color:#555}
small{color:#555}
</style></head><body><h1>Kit et matériel</h1><p>${escapeHtml(date)} · ${
    report.have
  } sur ${
    report.total
  } · liste indicative, à adapter au foyer.</p>${sections}<footer>Sources : ${[
    ...new Set(report.results.flatMap(r => r.definition.refs)),
  ]
    .map(ref => escapeHtml(GEAR_REFS[ref].title))
    .join(
      ' ; ',
    )}. « Conseil courant » : élément cité par aucune de ces listes.</footer></body></html>`;
}
