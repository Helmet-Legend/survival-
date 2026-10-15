/**
 * Estimation des calories d'un aliment d'après son nom, quand l'étiquette
 * n'a pas été saisie. Table hors ligne d'aliments de garde-manger courants,
 * en kcal pour 100 g (valeurs moyennes arrondies, d'après les tables de
 * composition nutritionnelle grand public). Une estimation vaut mieux
 * qu'un stock compté à zéro, mais reste signalée comme telle à l'écran.
 *
 * Ordre de recherche : nom de l'article (le motif le plus précis gagne),
 * puis type de vivres (conserve, épicerie sèche…), sinon pas d'estimation.
 */
import type { ItemUnit } from '../inventory/types';

export interface KcalEstimate {
  /** kcal par unité de l'article (par kg, par g ou par pièce). */
  kcalPerUnit: number;
  /** Aliment reconnu, affiché à l'utilisateur (« riz », « conserve »). */
  basis: string;
}

interface Entry {
  /** Mots à trouver dans le nom (sans accents, minuscules), tous requis. */
  words: readonly string[];
  label: string;
  per100g: number;
  /** Poids moyen d'une pièce en grammes, pour les articles comptés à la pièce. */
  pieceGrams?: number;
}

const e = (
  words: string,
  label: string,
  per100g: number,
  pieceGrams?: number,
): Entry => ({ words: words.split(' '), label, per100g, pieceGrams });

/** Du plus précis au plus général : la première entrée trouvée gagne. */
const FOODS: readonly Entry[] = [
  // Plats et conserves composés
  e('beurre cacahuete', 'beurre de cacahuète', 600),
  e('lait poudre', 'lait en poudre', 495),
  e('lait concentre', 'lait concentré sucré', 330, 397),
  e('thon huile', 'thon à l’huile', 190, 140),
  e('thon', 'thon au naturel', 115, 140),
  e('sardine', 'sardines à l’huile', 220, 115),
  e('maquereau', 'maquereau', 230, 170),
  e('saumon', 'saumon en conserve', 160, 170),
  e('corned', 'corned-beef', 210, 340),
  e('cassoulet', 'cassoulet', 125, 840),
  e('chili', 'chili con carne', 110, 840),
  e('ravioli', 'raviolis', 90, 800),
  e('choucroute', 'choucroute garnie', 110, 800),
  e('soupe', 'soupe', 40, 1000),
  e('lyophilise', 'repas lyophilisé', 450, 120),
  e('ration', 'ration de combat', 380, 900),
  // Féculents secs
  e('riz', 'riz', 355),
  e('pates', 'pâtes', 355),
  e('spaghetti', 'pâtes', 355),
  e('coquillette', 'pâtes', 355),
  e('nouille', 'nouilles', 360),
  // Après « pates » : « pate » est un préfixe de « pates ».
  e('pate', 'pâté', 300, 130),
  e('semoule', 'semoule', 355),
  e('couscous', 'semoule', 355),
  e('quinoa', 'quinoa', 365),
  e('boulgour', 'boulgour', 350),
  e('polenta', 'polenta', 360),
  e('farine', 'farine', 345),
  e('flocon', 'flocons d’avoine', 370),
  e('avoine', 'flocons d’avoine', 370),
  e('muesli', 'muesli', 380),
  e('cereale', 'céréales', 380),
  e('puree', 'purée en flocons', 350),
  e('lentille', 'lentilles sèches', 330),
  e('pois chiche', 'pois chiches secs', 335),
  e('haricot vert', 'haricots verts', 25, 800),
  e('haricot', 'haricots secs', 330),
  e('pois casse', 'pois cassés', 340),
  e('petit pois', 'petits pois', 80, 800),
  e('mais', 'maïs', 100, 300),
  // Boulangerie, biscuits
  e('biscotte', 'biscottes', 410),
  e('pain mie', 'pain de mie', 270),
  e('pain', 'pain', 270),
  e('cracker', 'crackers', 450),
  e('biscuit', 'biscuits', 470),
  e('galette', 'galettes', 400),
  // Matières grasses, sucres
  e('huile', 'huile', 900),
  e('beurre', 'beurre', 740),
  e('margarine', 'margarine', 540),
  e('sucre', 'sucre', 400),
  e('miel', 'miel', 320),
  e('confiture', 'confiture', 250),
  e('chocolat', 'chocolat', 540),
  e('barre', 'barre énergétique', 400, 50),
  // Fruits secs et oléagineux
  e('amande', 'amandes', 610),
  e('noix', 'noix', 680),
  e('noisette', 'noisettes', 650),
  e('cacahuete', 'cacahuètes', 600),
  e('arachide', 'cacahuètes', 600),
  e('raisin sec', 'raisins secs', 300),
  e('abricot sec', 'abricots secs', 270),
  e('datte', 'dattes', 290),
  e('fruit sec', 'fruits secs', 300),
  // Fruits et légumes en conserve
  e('compote', 'compote', 75, 100),
  e('sirop', 'fruits au sirop', 75, 820),
  e('tomate', 'tomates en conserve', 25, 400),
  e('legume', 'légumes en conserve', 45, 800),
  // Produits laitiers et œufs
  e('lait', 'lait UHT', 50, 1030),
  e('fromage', 'fromage', 350),
  e('oeuf', 'œufs', 145, 50),
];

/** Valeurs par type de vivres, faute de reconnaître le nom. */
const BY_SUBTYPE: Record<string, Entry> = {
  dry: e('', 'épicerie sèche', 350),
  canned: e('', 'conserve', 100, 400),
  freeze_dried: e('', 'repas lyophilisé', 450, 120),
};

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
}

/**
 * Mot entier ou pluriel (« riz », « oeufs ») ; préfixe pour les mots d'au
 * moins 5 lettres (« lentille » trouve « lentilles corail »). Les mots
 * courts exigent le mot entier : « mais » ne doit pas trouver « maison ».
 */
function wordMatches(word: string, key: string): boolean {
  return (
    word === key ||
    word === `${key}s` ||
    word === `${key}x` ||
    (key.length >= 5 && word.startsWith(key))
  );
}

function matches(name: string, entry: Entry): boolean {
  const words = name.split(' ');
  return entry.words.every(key => words.some(word => wordMatches(word, key)));
}

function toUnit(entry: Entry, unit: ItemUnit): number | null {
  switch (unit) {
    case 'kg':
      return entry.per100g * 10;
    case 'g':
      return entry.per100g / 100;
    case 'unit':
      return entry.pieceGrams === undefined
        ? null
        : Math.round((entry.per100g * entry.pieceGrams) / 100);
    default:
      return null;
  }
}

export function estimateKcal(
  name: string,
  unit: ItemUnit,
  subtype: string | null = null,
): KcalEstimate | null {
  const folded = fold(name);
  const candidates = [
    ...FOODS.filter(entry => matches(folded, entry)),
    ...(subtype !== null && BY_SUBTYPE[subtype] ? [BY_SUBTYPE[subtype]] : []),
  ];
  for (const entry of candidates) {
    const kcalPerUnit = toUnit(entry, unit);
    if (kcalPerUnit !== null) {
      return { kcalPerUnit, basis: entry.label };
    }
  }
  return null;
}
