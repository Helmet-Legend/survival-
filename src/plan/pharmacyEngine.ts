/**
 * Moteur de dotation médicale du foyer : modèle de mutualisation
 * (« Division 217 ») fourni par le cahier des charges Fenrir.
 *
 * 1. Profilage pondéral : A = adultes et enfants de 40 kg ou plus (formes
 *    adultes), E = enfants de 15 à 40 kg, B = moins de 15 kg ; N = foyer.
 * 2. Besoin mutualisé sur 30 jours : un socle pour le foyer, plus une part
 *    par personne concernée (le stock d'un foyer se partage).
 * 3. Durée amortie : 15 j × 0,80 ; 30 j × 1 ; 45 j × 1,15 ; 90 j × 1,50 ;
 *    le matériel invariant (garrots, ciseaux, thermomètre…) ne varie pas.
 * 4. Boîtes = ⌈besoin × coefficient ÷ unités par boîte⌉ (l'arrondi sert de
 *    marge), au moins 1 dès qu'une personne est concernée.
 *
 * Fonctions pures, sans interface. Le poids d'un enfant ne sert qu'à estimer
 * la quantité à stocker : aucune dose n'est affichée.
 */

export type MedCategory =
  | 'douleur'
  | 'digestion'
  | 'allergie'
  | 'hemorragie'
  | 'plaies'
  | 'orl'
  | 'protection'
  | 'hygiene'
  | 'nourrisson'
  | 'materiel';

export const CATEGORY_LABELS: Record<MedCategory, string> = {
  douleur: 'Douleur, fièvre, inflammation',
  digestion: 'Digestion',
  allergie: 'Allergie',
  hemorragie: 'Hémorragie',
  plaies: 'Plaies et brûlures',
  orl: 'Nez et gorge',
  protection: 'Protection',
  hygiene: 'Hygiène',
  nourrisson: 'Kit nourrisson',
  materiel: 'Surveillance et organisation',
};

/** Coefficient de durée amorti (logique d'expédition), par nombre de jours. */
export const TIME_COEFF: Record<number, number> = {
  15: 0.8,
  30: 1,
  45: 1.15,
  90: 1.5,
};
export const DURATIONS = [15, 30, 45, 90] as const;

/** Profil du foyer après reclassement par le poids. */
export interface Profil {
  /** Formes adultes : adultes et enfants de 40 kg ou plus. */
  A: number;
  /** Enfants de 15 à 40 kg (ou de poids non indiqué). */
  E: number;
  /** Bas âge : moins de 15 kg. */
  B: number;
  /** Tout le foyer. */
  N: number;
  /** Enfants de moins de 25 kg (suspension). */
  enfantsSirop: number;
  /** Enfants de 25 à 40 kg : formes solides ou sachets de 500 mg. */
  enfants500: number;
}

export interface CatalogueMed {
  nom: string;
  categorie: MedCategory;
  /** Unité comptée, au singulier et au pluriel : comprimé(s), mg, sachet(s)… */
  format: [string, string];
  /** Unités par boîte (ou par flacon) du commerce. */
  tailleBoite: number;
  /** Nom du conditionnement : boîte, flacon, rouleau… */
  conditionnement?: [string, string];
  /** Origine de la taille de boîte. */
  boiteSource: string;
  /** Produit du catalogue de la pharmacie (précautions, délivrance). */
  catalogId?: string;
  /** À quoi il sert. */
  usage: string;
}

export interface Dotation extends CatalogueMed {
  ref: string;
  /** Matériel fixe : ne dépend pas de la durée. */
  invariant: boolean;
  /** Personnes concernées ; 0 : l'article ne s'applique pas au foyer. */
  concerne: (p: Profil) => number;
  /** Besoin mutualisé pour 30 jours, en unités. */
  besoin30: (p: Profil) => number;
  /** Formule lisible du besoin. */
  formule: string;
  source: string;
  /** Vrai seulement si la quantité repose sur une source publiée. */
  sourcee: boolean;
  /** Mention à afficher : sur ordonnance, à valider… */
  note?: string;
}

/** Repère fourni sans source : à faire valider avant de s'y fier. */
export const UNSOURCED = 'Repère non sourcé, à valider';
const CDC =
  'Catalogue Fenrir (modèle de mutualisation) : repère non sourcé, à valider';
export const MATERIEL_SOURCE =
  'Estimation d’organisation (prototype Fenrir), pas une norme médicale';
const PRESCRIPTION =
  'Forme enfant sur ordonnance : à demander au médecin ou au pharmacien.';

type Groupe = 'A' | 'E' | 'B' | 'N' | 'enfantsSirop' | 'enfants500';
type Parts = Partial<Record<Groupe, number>>;
const GROUP_LABELS: Record<Groupe, string> = {
  A: 'adulte',
  E: 'enfant',
  B: 'nourrisson',
  N: 'personne',
  enfantsSirop: 'enfant de moins de 25 kg',
  enfants500: 'enfant de 25 à 40 kg',
};

/** Besoin mutualisé : socle + part par personne de chaque groupe concerné. */
function mutualise(socle: number, parts: Parts, unite: string) {
  const groups = Object.keys(parts) as Groupe[];
  return {
    concerne: (p: Profil) => groups.reduce((n, g) => n + p[g], 0),
    besoin30: (p: Profil) =>
      groups.reduce((n, g) => n + (parts[g] ?? 0) * p[g], socle),
    formule: [
      `${fmt(socle)} ${unite} pour le foyer`,
      ...groups
        .filter(g => (parts[g] ?? 0) > 0)
        .map(g => `${fmt(parts[g]!)} par ${GROUP_LABELS[g]}`),
    ].join(' + '),
  };
}

type Base = Omit<Dotation, 'ref' | 'concerne' | 'besoin30' | 'formule'>;
const item = (
  ref: string,
  d: Base,
  m: Pick<Dotation, 'concerne' | 'besoin30' | 'formule'>,
): Dotation => ({ ref, ...d, ...m });

/** Médicament ou soin : socle + parts, durée amortie. */
const soin = (
  ref: string,
  d: Omit<Base, 'invariant'>,
  socle: number,
  parts: Parts,
): Dotation =>
  item(ref, { ...d, invariant: false }, mutualise(socle, parts, d.format[1]));

/** Matériel consommable du prototype : base + part par personne (enfant 0,75). */
const materiel = (
  ref: string,
  nom: string,
  categorie: MedCategory,
  unite: [string, string],
  base: number,
  parPersonne: number,
  usage: string,
  catalogId?: string,
): Dotation =>
  soin(
    ref,
    {
      nom,
      categorie,
      format: unite,
      tailleBoite: 1,
      conditionnement: unite,
      boiteSource: MATERIEL_SOURCE,
      catalogId,
      usage,
      source: MATERIEL_SOURCE,
      sourcee: false,
    },
    base,
    { A: parPersonne, E: parPersonne * 0.75, B: parPersonne * 0.75 },
  );

/** Matériel invariant : socle + parts, sans effet de la durée. */
const fixe = (
  ref: string,
  nom: string,
  categorie: MedCategory,
  unite: [string, string],
  usage: string,
  socle = 1,
  parts: Parts = { N: 0 },
  extra: Partial<Base> = {},
): Dotation =>
  item(
    ref,
    {
      nom,
      categorie,
      format: unite,
      tailleBoite: 1,
      conditionnement: unite,
      boiteSource: 'À l’unité',
      usage,
      invariant: true,
      source: MATERIEL_SOURCE,
      sourcee: false,
      ...extra,
    },
    mutualise(socle, parts, unite[1]),
  );

export const catalogueDotation: readonly Dotation[] = [
  // --- Douleur et fièvre ----------------------------------------------------
  soin(
    'para_1000',
    {
      nom: 'Paracétamol 1000 mg',
      categorie: 'douleur',
      format: ['comprimé', 'comprimés'],
      tailleBoite: 8,
      boiteSource: 'Boîte de 8 comprimés (HAS)',
      catalogId: 'paracetamol',
      usage: 'Fièvre, douleurs : premier choix chez l’adulte.',
      source: CDC,
      sourcee: false,
    },
    8,
    { A: 6 },
  ),
  soin(
    'para_500',
    {
      nom: 'Paracétamol 500 mg (enfant de 25 à 40 kg)',
      categorie: 'douleur',
      format: ['gélule', 'gélules'],
      tailleBoite: 16,
      boiteSource: 'Boîte de 16 gélules (HAS)',
      catalogId: 'paracetamol',
      usage:
        'Fièvre et douleurs des grands enfants : forme solide plutôt que le sirop.',
      source: CDC,
      sourcee: false,
    },
    0,
    { enfants500: 10 },
  ),
  soin(
    'para_ped',
    {
      nom: 'Paracétamol sirop 2,4 % (flacon de 100 ml)',
      categorie: 'douleur',
      format: ['flacon', 'flacons'],
      tailleBoite: 1,
      conditionnement: ['flacon de 100 ml', 'flacons de 100 ml'],
      boiteSource: 'Flacon de 100 ml à 24 mg/ml',
      usage:
        'Fièvre et douleurs des enfants de moins de 25 kg ; pipette graduée en kilos fournie.',
      source: CDC,
      sourcee: false,
    },
    0,
    { enfantsSirop: 0.8 },
  ),
  soin(
    'ibuprofene_400',
    {
      nom: 'Ibuprofène 400 mg',
      categorie: 'douleur',
      format: ['comprimé', 'comprimés'],
      tailleBoite: 12,
      boiteSource: 'Boîte de 12 comprimés',
      catalogId: 'ibuprofene',
      usage: 'Douleurs avec inflammation : entorse, dents, règles.',
      source: CDC,
      sourcee: false,
    },
    6,
    { A: 4 },
  ),
  soin(
    'phloroglucinol',
    {
      nom: 'Phloroglucinol (Spasfon) 80 mg',
      categorie: 'douleur',
      format: ['comprimé', 'comprimés'],
      tailleBoite: 10,
      boiteSource: 'Boîte de 10',
      catalogId: 'phloroglucinol',
      usage: 'Spasmes et crampes du ventre, règles douloureuses.',
      source: CDC,
      sourcee: false,
    },
    4,
    { A: 2, E: 2 },
  ),
  // --- Gastro-entérologie ---------------------------------------------------
  item(
    'sro',
    {
      nom: 'Sels de réhydratation orale (SRO)',
      categorie: 'digestion',
      format: ['sachet', 'sachets'],
      tailleBoite: 10,
      boiteSource: 'Boîte de 10 sachets',
      catalogId: 'sro',
      usage: 'Diarrhée, vomissements, chaleur : évite la déshydratation.',
      invariant: false,
      source: CDC,
      sourcee: false,
    },
    {
      // Stock tampon pédiatrique : les adultes ne sont pas comptés.
      concerne: p => p.B + p.E,
      besoin30: p => 10 * p.B + 3 * p.E,
      formule: '10 sachets par nourrisson + 3 par enfant',
    },
  ),
  soin(
    'racecadotril_adulte',
    {
      nom: 'Racécadotril 100 mg (adulte)',
      categorie: 'digestion',
      format: ['gélule', 'gélules'],
      tailleBoite: 20,
      boiteSource: 'Boîte de 20 (des boîtes de 10 existent en vente libre)',
      catalogId: 'racecadotril',
      usage: 'Diarrhée aiguë de l’adulte, avec la réhydratation.',
      source: CDC,
      sourcee: false,
    },
    6,
    { A: 4 },
  ),
  soin(
    'racecadotril_ped',
    {
      nom: 'Racécadotril pédiatrique (sachets)',
      categorie: 'digestion',
      format: ['sachet', 'sachets'],
      tailleBoite: 16,
      boiteSource: 'Boîte de 16 sachets',
      usage:
        'Diarrhée aiguë de l’enfant et du nourrisson, toujours avec les SRO.',
      source: CDC,
      sourcee: false,
      note: PRESCRIPTION,
    },
    6,
    { E: 3, B: 3 },
  ),
  soin(
    'loperamide',
    {
      nom: 'Lopéramide 2 mg (adulte seulement)',
      categorie: 'digestion',
      format: ['gélule', 'gélules'],
      tailleBoite: 12,
      boiteSource: 'Boîte de 12 gélules',
      catalogId: 'loperamide',
      usage: 'Diarrhée aiguë de l’adulte ; jamais chez l’enfant.',
      source: CDC,
      sourcee: false,
    },
    4,
    { A: 3 },
  ),
  soin(
    'diosmectite',
    {
      nom: 'Diosmectite (Smecta)',
      categorie: 'digestion',
      format: ['sachet', 'sachets'],
      tailleBoite: 18,
      boiteSource: 'Boîte de 18 sachets',
      catalogId: 'diosmectite',
      usage: 'Diarrhée aiguë ; pas avant 2 ans (exclut les moins de 15 kg).',
      source: CDC,
      sourcee: false,
    },
    6,
    { A: 3, E: 3 },
  ),
  soin(
    'antiemetique',
    {
      nom: 'Métopimazine (Vogalib) lyophilisat',
      categorie: 'digestion',
      format: ['lyoc', 'lyocs'],
      tailleBoite: 8,
      boiteSource: 'Boîte de 8 lyocs',
      catalogId: 'metopimazine',
      usage: 'Nausées et vomissements.',
      source: CDC,
      sourcee: false,
      note: 'Vente libre pour l’adulte ; chez l’enfant, sur avis médical.',
    },
    4,
    { A: 1.5, E: 1.5 },
  ),
  soin(
    'omeprazole',
    {
      nom: 'Oméprazole 20 mg',
      categorie: 'digestion',
      format: ['gélule', 'gélules'],
      tailleBoite: 14,
      boiteSource: 'Boîte de 14 gélules',
      usage: 'Brûlures d’estomac et remontées acides de l’adulte.',
      source: CDC,
      sourcee: false,
      note: 'Délivrance sans ordonnance à confirmer avec le pharmacien.',
    },
    4,
    { A: 3 },
  ),
  // --- Allergie, ORL, yeux, peau --------------------------------------------
  soin(
    'cetirizine',
    {
      nom: 'Cétirizine 10 mg',
      categorie: 'allergie',
      format: ['comprimé', 'comprimés'],
      tailleBoite: 15,
      boiteSource: 'Boîte de 15 comprimés',
      catalogId: 'cetirizine',
      usage: 'Rhume des foins, urticaire, piqûres d’insectes.',
      source: CDC,
      sourcee: false,
    },
    5,
    { A: 3 },
  ),
  soin(
    'desloratadine_sirop',
    {
      nom: 'Desloratadine sirop enfant (flacon de 150 ml)',
      categorie: 'allergie',
      format: ['flacon', 'flacons'],
      tailleBoite: 1,
      conditionnement: ['flacon', 'flacons'],
      boiteSource: 'Flacon de 150 ml',
      usage: 'Allergies de l’enfant.',
      source: CDC,
      sourcee: false,
      note: 'Sur ordonnance ; pas avant 1 an.',
    },
    0.4,
    { E: 0.1, B: 0.1 },
  ),
  soin(
    'collyre',
    {
      nom: 'Collyre antiseptique en unidoses',
      categorie: 'orl',
      format: ['unidose', 'unidoses'],
      tailleBoite: 10,
      boiteSource: 'Boîte de 10',
      usage: 'Irritation ou poussière dans l’œil, conjonctivite légère.',
      source: CDC,
      sourcee: false,
      note: 'Délivrance à confirmer avec le pharmacien.',
    },
    4,
    { N: 1.5 },
  ),
  soin(
    'hydrocortisone',
    {
      nom: 'Hydrocortisone 0,5 % crème (tube de 15 g)',
      categorie: 'plaies',
      format: ['tube', 'tubes'],
      tailleBoite: 1,
      conditionnement: ['tube', 'tubes'],
      boiteSource: 'Tube de 15 g',
      usage: 'Piqûres d’insectes, démangeaisons, eczéma léger.',
      source: CDC,
      sourcee: false,
      note: 'Pas sur une plaie ou une peau infectée ; demander conseil pour un enfant.',
    },
    0.5,
    { N: 0.1 },
  ),
  soin(
    'tulle',
    {
      nom: 'Tulle gras ou hydrogel pour brûlures',
      categorie: 'plaies',
      format: ['pansement', 'pansements'],
      tailleBoite: 10,
      boiteSource: 'Boîte de 10',
      catalogId: 'tulle',
      usage: 'Brûlures légères, plaies qui suintent : ne colle pas.',
      source: CDC,
      sourcee: false,
    },
    3,
    { N: 1 },
  ),
  // --- Soins et traumatologie -----------------------------------------------
  soin(
    'chlorhexidine',
    {
      nom: 'Chlorhexidine aqueuse (unidoses)',
      categorie: 'plaies',
      format: ['unidose', 'unidoses'],
      tailleBoite: 20,
      boiteSource: 'Boîte de 20 unidoses',
      catalogId: 'antiseptique',
      usage:
        'Antiseptique sans alcool, adapté aux nourrissons ; après lavage à l’eau et au savon.',
      source: CDC,
      sourcee: false,
    },
    10,
    { N: 4 },
  ),
  item(
    'serum',
    {
      nom: 'Sérum physiologique en unidoses',
      categorie: 'orl',
      format: ['unidose', 'unidoses'],
      tailleBoite: 40,
      boiteSource: 'Boîte de 40 unidoses',
      catalogId: 'serum',
      usage: 'Laver le nez des enfants, rincer un œil, nettoyer une plaie.',
      invariant: false,
      source: CDC,
      sourcee: false,
    },
    {
      concerne: p => p.N,
      besoin30: p => 15 * p.N + 60 * p.B,
      formule: '15 unidoses par personne + 60 par nourrisson',
    },
  ),
  soin(
    'compresses',
    {
      nom: 'Compresses stériles 10 × 10 cm',
      categorie: 'plaies',
      format: ['compresse', 'compresses'],
      tailleBoite: 50,
      boiteSource: 'Boîte de 50',
      catalogId: 'compresses',
      usage: 'Nettoyer et couvrir une plaie.',
      source: CDC,
      sourcee: false,
    },
    20,
    { N: 8 },
  ),
  soin(
    'bandes',
    {
      nom: 'Bandes extensibles 4 m',
      categorie: 'plaies',
      format: ['bande', 'bandes'],
      tailleBoite: 1,
      conditionnement: ['bande', 'bandes'],
      boiteSource: 'À l’unité',
      usage: 'Maintenir un pansement, une entorse.',
      source: CDC,
      sourcee: false,
    },
    2,
    { N: 0.5 },
  ),
  fixe(
    'sutures',
    'Sutures adhésives Steri-Strip (pochette de 6)',
    'plaies',
    ['pochette', 'pochettes'],
    'Rapprocher les bords d’une petite plaie propre.',
    2,
    { N: 0.5 },
    { source: CDC },
  ),
  fixe(
    'garrot',
    'Garrot tactique CAT',
    'hemorragie',
    ['garrot', 'garrots'],
    'Hémorragie d’un membre qu’on ne peut arrêter en comprimant ; suppose une formation (voir la fiche Garrot).',
    1,
    { N: 0.25 },
    { source: CDC },
  ),
  fixe(
    'pansement_compressif',
    'Pansement compressif israélien',
    'hemorragie',
    ['pansement', 'pansements'],
    'Comprimer une plaie qui saigne beaucoup.',
    1,
    { N: 0.25 },
    { source: CDC },
  ),
  materiel(
    'pansements',
    'Pansements adhésifs assortis',
    'plaies',
    ['boîte de 40 à 100', 'boîtes de 40 à 100'],
    0.5,
    0.05,
    'Petites coupures et écorchures.',
    'pansements',
  ),
  materiel(
    'sparadrap',
    'Sparadrap hypoallergénique',
    'plaies',
    ['rouleau', 'rouleaux'],
    0.5,
    0.05,
    'Fixer les pansements.',
  ),
  // --- Protection et hygiène ------------------------------------------------
  materiel(
    'gants',
    'Gants nitrile non stériles',
    'protection',
    ['boîte de 100', 'boîtes de 100'],
    0.5,
    0.05,
    'Soigner sans se contaminer ; choisir les tailles.',
    'gants',
  ),
  materiel(
    'masques',
    'Masques chirurgicaux',
    'protection',
    ['boîte de 50', 'boîtes de 50'],
    0.5,
    0.05,
    'Protection ponctuelle, malade dans le foyer.',
    'masques',
  ),
  materiel(
    'sacs',
    'Sacs à déchets résistants',
    'protection',
    ['rouleau', 'rouleaux'],
    0.5,
    0.1,
    'Jeter les déchets souillés.',
  ),
  materiel(
    'savon',
    'Savon',
    'hygiene',
    ['flacon ou pain', 'flacons ou pains'],
    2,
    1.5,
    'Hygiène des mains et du corps.',
  ),
  materiel(
    'gel',
    'Gel hydroalcoolique',
    'hygiene',
    ['flacon de 100 à 300 ml', 'flacons de 100 à 300 ml'],
    2,
    0.8,
    'En complément du lavage des mains.',
  ),
  materiel(
    'mouchoirs',
    'Mouchoirs en papier',
    'hygiene',
    ['boîte', 'boîtes'],
    4,
    2,
    'Rhumes, hygiène.',
  ),
  materiel(
    'protections',
    'Protections périodiques',
    'hygiene',
    ['paquet', 'paquets'],
    2,
    1.5,
    'À adapter aux besoins réels du foyer.',
  ),
  // --- Kit nourrisson (dès qu'un enfant pèse moins de 15 kg) ----------------
  fixe(
    'thermometre_rectal',
    'Thermomètre électronique rectal souple',
    'nourrisson',
    ['thermomètre', 'thermomètres'],
    'Prendre la température d’un nourrisson.',
    1,
    { B: 0 },
  ),
  fixe(
    'mouche_bebe',
    'Mouche-bébé à aspiration manuelle',
    'nourrisson',
    ['mouche-bébé', 'mouche-bébés'],
    'Désencombrer le nez avec le sérum physiologique.',
    1,
    { B: 0 },
  ),
  fixe(
    'pince_fine',
    'Pince à écharde fine',
    'nourrisson',
    ['pince', 'pinces'],
    'Retirer une écharde sur une peau fine.',
    1,
    { B: 0 },
  ),
  // --- Surveillance et organisation -----------------------------------------
  fixe(
    'thermometre',
    'Thermomètre numérique',
    'materiel',
    ['thermomètre', 'thermomètres'],
    'Mesurer la fièvre avant de traiter ou de consulter.',
  ),
  materiel(
    'piles',
    'Piles de rechange compatibles',
    'materiel',
    ['jeu', 'jeux'],
    0.5,
    0.05,
    'Pour le thermomètre et les appareils conservés.',
  ),
  fixe(
    'trousse',
    'Trousse de premiers secours',
    'materiel',
    ['trousse', 'trousses'],
    'Une trousse accessible et identifiée.',
  ),
  fixe(
    'ciseaux',
    'Ciseaux à bouts ronds',
    'materiel',
    ['paire', 'paires'],
    'Découper bandes et pansements.',
  ),
  fixe(
    'pince_tiques',
    'Pince à tiques',
    'materiel',
    ['pince', 'pinces'],
    'Retirer une tique sans l’écraser.',
  ),
  materiel(
    'froid',
    'Poche de froid instantané',
    'materiel',
    ['poche', 'poches'],
    1,
    0.1,
    'Coups et entorses légères ; selon la notice.',
  ),
  fixe(
    'couverture',
    'Couverture de survie',
    'materiel',
    ['couverture', 'couvertures'],
    'Protection thermique d’appoint, une par personne.',
    0,
    { N: 1 },
  ),
  fixe(
    'fiches',
    'Fiches allergies, traitements, contacts',
    'materiel',
    ['dossier', 'dossiers'],
    'À tenir à jour, avec les numéros utiles.',
  ),
  fixe(
    'rangement',
    'Boîte de rangement propre et fermée',
    'materiel',
    ['boîte', 'boîtes'],
    'Stocker au sec, à l’abri de la chaleur.',
  ),
];

/** Tous les articles, par référence. */
export const catalogueMedicaments: Record<string, Dotation> =
  Object.fromEntries(catalogueDotation.map(d => [d.ref, d]));

/** Repère de consommation nationale (ANSM), pour comparaison seulement. */
export const NATIONAL_USE: Record<string, { perYear: number; source: string }> =
  {
    para_1000: {
      perYear: 500 / 66,
      source:
        'ANSM, ventes 2013 : environ 500 millions de boîtes de paracétamol par an en France, soit près de 7,5 par habitant (84 % sur ordonnance)',
    },
  };

/** Quota ANSM : au plus 2 boîtes de paracétamol par passage sans ordonnance. */
export const PARACETAMOL_PER_VISIT = 2;

export const WEIGHT_RANGE = [2, 120] as const;
/** Poids à partir duquel un enfant passe aux formes adultes. */
export const ADULT_WEIGHT = 40;
/** Poids sous lequel un enfant est de bas âge (verrous nourrisson). */
export const INFANT_WEIGHT = 15;
/** Sous ce poids, paracétamol en suspension ; au-dessus, 500 mg. */
export const SYRUP_WEIGHT = 25;

export interface Household {
  adults: number;
  /** Poids de chaque enfant en kg ; null tant qu'il n'est pas saisi. */
  childWeights: (number | null)[];
  /** Durée d'autonomie visée, en jours (15, 30, 45 ou 90). */
  days: number;
}

/**
 * 1. Profilage pondéral : un enfant de 40 kg ou plus prend les formes
 * adultes ; moins de 15 kg, il est de bas âge. Paracétamol : sirop
 * sous 25 kg, 500 mg de 25 à 40 kg. Un enfant sans poids compte en E, sans paracétamol enfant.
 */
export function profile(h: Household): Profil & { missingWeights: number } {
  let A = h.adults;
  let E = 0;
  let B = 0;
  let enfantsSirop = 0;
  let enfants500 = 0;
  let missingWeights = 0;
  for (const w of h.childWeights) {
    if (w === null) {
      E += 1;
      missingWeights += 1;
      continue;
    }
    if (w >= ADULT_WEIGHT) {
      A += 1;
      continue;
    }
    if (w < INFANT_WEIGHT) {
      B += 1;
    } else {
      E += 1;
    }
    if (w < SYRUP_WEIGHT) {
      enfantsSirop += 1;
    } else {
      enfants500 += 1;
    }
  }
  return {
    A,
    E,
    B,
    N: h.adults + h.childWeights.length,
    enfantsSirop,
    enfants500,
    missingWeights,
  };
}

/**
 * Dotation réaliste : ⌈(socle + part × personnes) × coefficient de durée ÷
 * unités par boîte⌉, au moins 1 ; 0 si personne n'est concerné.
 */
export function calculerDotationRealiste(
  socleFoyer: number,
  besoinParPersonne: number,
  nbPersonnesCibles: number,
  dureeJours: number,
  estInvariant: boolean,
  unitesParBoite: number,
): number {
  if (nbPersonnesCibles <= 0) {
    return 0;
  }
  const besoin30j = socleFoyer + besoinParPersonne * nbPersonnesCibles;
  return toBoxes(besoin30j, dureeJours, estInvariant, unitesParBoite);
}

function timeCoeff(days: number, invariant: boolean): number {
  return invariant ? 1 : TIME_COEFF[days] ?? 1;
}

function toBoxes(
  besoin30j: number,
  days: number,
  invariant: boolean,
  unitesParBoite: number,
): number {
  const total = besoin30j * timeCoeff(days, invariant);
  // Tolérance pour qu'un compte rond (ex. 2,0000000001) ne passe pas à 3.
  return Math.max(1, Math.ceil(total / unitesParBoite - 1e-9));
}

export interface MedResult {
  ref: string;
  med: Dotation;
  /** Besoin mutualisé sur 30 jours. */
  quantity: number;
  /** Besoin pour la durée choisie, avant l'arrondi. */
  withMargin: number;
  /** Boîtes à stocker. */
  boxes: number;
  /** Formule et effet de la durée, pour l'affichage. */
  from: string[];
  sources: string[];
  sourced: boolean;
}

export interface EngineResult {
  meds: MedResult[];
  /** Enfants sans poids : leur paracétamol enfant n'est pas compté. */
  missingWeights: number;
  profil: Profil;
  /** Verrous nourrisson actifs (un enfant de moins de 15 kg). */
  infant: boolean;
  /** Passages en pharmacie pour le paracétamol (quota ANSM). */
  pharmacyVisits: number;
}

/** Calcule la dotation du foyer pour la durée choisie. */
export function computeStock(
  household: Household,
  catalogue: readonly Dotation[] = catalogueDotation,
): EngineResult {
  const { missingWeights, ...profil } = profile(household);
  const meds: MedResult[] = [];
  for (const d of catalogue) {
    if (d.concerne(profil) <= 0) {
      continue;
    }
    const besoin = d.besoin30(profil);
    const coeff = timeCoeff(household.days, d.invariant);
    meds.push({
      ref: d.ref,
      med: d,
      quantity: besoin,
      withMargin: besoin * coeff,
      boxes: toBoxes(besoin, household.days, d.invariant, d.tailleBoite),
      from: [
        `${d.formule} pour 30 jours`,
        d.invariant
          ? 'fixe, quelle que soit la durée'
          : `durée : × ${fmt(coeff)}`,
      ],
      sources: [d.source],
      sourced: d.sourcee,
    });
  }
  const paracetamol = meds
    .filter(m => ['para_1000', 'para_ped', 'para_500'].includes(m.ref))
    .reduce((n, m) => n + m.boxes, 0);
  return {
    meds,
    missingWeights,
    profil,
    infant: profil.B > 0,
    pharmacyVisits: Math.ceil(paracetamol / PARACETAMOL_PER_VISIT),
  };
}

type Scale = { ref: string; med: Dotation; boxes: number[] }[];

function scale(runs: EngineResult[]): Scale {
  const refs = new Map<string, Dotation>();
  for (const r of runs) {
    for (const m of r.meds) {
      refs.set(m.ref, m.med);
    }
  }
  return [...refs].map(([ref, med]) => ({
    ref,
    med,
    boxes: runs.map(r => r.meds.find(x => x.ref === ref)?.boxes ?? 0),
  }));
}

/** Progression selon le nombre d'adultes (sans enfant), même durée. */
export function boxesByAdults(
  household: Pick<Household, 'days'>,
  max = 6,
): Scale {
  return scale(
    Array.from({ length: max }, (_, i) =>
      computeStock({ days: household.days, adults: i + 1, childWeights: [] }),
    ),
  );
}

/** Progression selon le nombre d'enfants d'un même poids (sans adulte). */
export function boxesByChildren(
  household: Pick<Household, 'days'>,
  weight: number,
  max = 6,
): Scale {
  return scale(
    Array.from({ length: max }, (_, i) =>
      computeStock({
        days: household.days,
        adults: 0,
        childWeights: Array<number>(i + 1).fill(weight),
      }),
    ),
  );
}

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toString().replace('.', ',');
}

/** Quantité lisible : « 25,2 comprimés », « 5 400 mg ». */
export function formatQuantity(n: number, format: [string, string]): string {
  const rounded = Math.round(n * 10) / 10;
  return `${rounded.toLocaleString('fr-FR')} ${
    rounded > 1 ? format[1] : format[0]
  }`;
}

/** « 3 boîtes », « 1 flacon de 100 ml ». */
export function formatBoxes(n: number, med: CatalogueMed): string {
  const [one, many] = med.conditionnement ?? ['boîte', 'boîtes'];
  return `${n} ${n > 1 ? many : one}`;
}

export function householdError(h: Household): string | null {
  const isInt = (n: unknown, [min, max]: readonly [number, number]) =>
    typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;
  if (!isInt(h.adults, [0, 10])) {
    return 'Le nombre d’adultes doit être compris entre 0 et 10.';
  }
  if (!Array.isArray(h.childWeights) || h.childWeights.length > 10) {
    return 'Au plus 10 enfants.';
  }
  for (const w of h.childWeights) {
    if (
      w !== null &&
      !(
        typeof w === 'number' &&
        Number.isFinite(w) &&
        w >= WEIGHT_RANGE[0] &&
        w <= WEIGHT_RANGE[1]
      )
    ) {
      return `Le poids d’un enfant doit être compris entre ${WEIGHT_RANGE[0]} et ${WEIGHT_RANGE[1]} kg.`;
    }
  }
  if (h.adults + h.childWeights.length === 0) {
    return 'Ajoutez au moins une personne au foyer.';
  }
  if (!(DURATIONS as readonly number[]).includes(h.days)) {
    return 'Durée inconnue : 15, 30, 45 ou 90 jours.';
  }
  return null;
}
