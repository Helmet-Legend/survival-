/** Alimentation et hygiène en situation dégradée. */
import { fiche } from './fiche';

const A = 'Alimentation';
const H = 'Hygiène';

export const ALIMENTATION = [
  fiche('rationnement', A, 'Rationner la nourriture', [
    '= Adulte au repos     environ 2 000 kcal par jour',
    '= Effort physique     2 500 à 3 500 kcal',
    '= Enfant              1 000 à 2 000 kcal selon l’âge',
    '- Commencer par les produits frais et ce qui se périme, garder les conserves et le sec pour la suite.',
    '- Sans eau suffisante, manger moins de protéines et de sel : leur digestion demande de l’eau.',
    '- Un adulte en bonne santé supporte plusieurs jours de restriction : l’eau reste prioritaire.',
    'L’Accueil calcule l’autonomie du foyer à partir des calories de vos stocks.',
  ]),
  fiche('conservation-sans-frigo', A, 'Conserver sans réfrigérateur', [
    'En cas de coupure, un réfrigérateur fermé garde le froid environ 4 heures, un congélateur plein 48 heures (24 heures à moitié plein). Ne pas ouvrir inutilement.',
    '- Viande, poisson, plats cuisinés, produits laitiers : à consommer en premier ou à jeter s’ils ont passé plus de 2 heures au-dessus de 4 °C.',
    '- Garder au frais : cave, pièce au nord, pot en terre humide (« frigo du désert »).',
    '- Sel, sucre, séchage et fumage conservent longtemps viande, poisson et fruits.',
    '! En cas de doute (odeur, gonflement d’une conserve, aspect), jeter. Une conserve bombée ou qui fuit ne se mange jamais.',
  ]),
  fiche('cuisson-economie', A, 'Cuisiner en économisant le combustible', [
    '- Couvrir les casseroles : la cuisson consomme jusqu’à trois fois moins.',
    '- Faire tremper riz, pâtes et légumineuses avant cuisson.',
    '- Marmite norvégienne : porter à ébullition 5 minutes, puis envelopper la casserole fermée dans des couvertures ou un duvet. La cuisson se poursuit sans flamme pendant 1 à 3 heures.',
    '- Réchaud, barbecue et brasero : uniquement à l’extérieur.',
  ]),
  fiche('plantes-sauvages', A, 'Plantes sauvages : prudence', [
    '! Ne consommer une plante que si vous l’identifiez avec certitude. Certaines espèces mortelles (ciguë, colchique, digitale) ressemblent à des plantes comestibles. Ne jamais cueillir de champignons sans les faire vérifier par un pharmacien ou une association de mycologie.',
    'Quelques plantes communes et faciles à reconnaître, à cuire de préférence :',
    '- Ortie : jeunes feuilles cuites en soupe (la cuisson supprime les piqûres).',
    '- Pissenlit : feuilles et fleurs, crues ou cuites.',
    '- Mûres, framboises sauvages : fruits bien mûrs.',
    'Éviter les bords de route, les champs traités et les terrains pollués.',
  ]),

  fiche(
    'allergies-intolerances-stock',
    A,
    'Adapter les stocks aux allergies et régimes',
    [
      '- Inscrire les allergies, intolérances, régimes médicaux et aliments refusés sur une fiche papier accessible aux adultes responsables.',
      '- Lire la liste des ingrédients à chaque achat : les recettes et risques de contamination croisée peuvent changer.',
      '- Séparer les aliments concernés, utiliser des ustensiles propres et conserver les emballages pour vérifier les ingrédients.',
      '- Prévoir des équivalents longue conservation réellement tolérés, plutôt que de compter sur une substitution improvisée.',
      '## Vérification du stock',
      '= Besoin  Allergie ou régime identifié pour chaque personne',
      '= Quantité  Stock adapté à la durée et au nombre de personnes',
      '= Rotation  Dates vérifiées et produits consommés avant péremption',
      '! Une réaction allergique avec difficulté respiratoire, gonflement de la langue/gorge ou malaise est une urgence : utiliser le traitement prescrit si disponible et appeler le 15 ou le 112.',
    ],
  ),
  fiche('cuisson-sans-electricite', A, 'Préparer les repas sans électricité', [
    '- Prévoir des aliments consommables sans cuisson et vérifier les dates de péremption.',
    '- Utiliser un réchaud uniquement dehors, sur une surface stable, loin des matériaux combustibles et selon la notice.',
    '- Ne jamais utiliser barbecue, brasero, réchaud à gaz ou groupe électrogène à l’intérieur, dans un garage ou près d’une fenêtre : risque de monoxyde de carbone.',
    '- Garder une réserve de combustible compatible avec l’appareil et respecter les règles locales de stockage.',
    '## Ordre de consommation pendant une panne',
    '1. Aliments réfrigérés les plus périssables, seulement si leur température est restée sûre.',
    '2. Produits surgelés encore congelés ou maintenus à température sûre.',
    '3. Conserves intactes et aliments secs à longue conservation.',
    '! En cas de doute sur la durée ou la température de conservation, jeter les aliments périssables. L’odeur ne permet pas toujours de détecter un danger.',
  ]),
];

export const HYGIENE = [
  fiche('toilettes-fortune', H, 'Toilettes de fortune', [
    'Sans eau pour la chasse, ne pas tirer : les canalisations peuvent refouler.',
    '1. Doubler un seau ou la cuvette vidée avec deux sacs poubelle résistants.',
    '2. Après chaque usage, couvrir de sciure, de litière pour chat, de cendres ou de terre sèche.',
    '3. Fermer le sac quand il est au tiers, le stocker dans un bac fermé loin des points d’eau et des aliments.',
    'Dehors : creuser un trou de 15 à 20 cm à au moins 60 mètres de tout point d’eau, et le reboucher.',
  ]),
  fiche('mains-sans-eau', H, 'Se laver les mains avec peu d’eau', [
    '- Les mains sales propagent la plupart des maladies en situation de crise : les laver avant de manger et de cuisiner, et après les toilettes.',
    '- Robinet de fortune : un bidon percé d’un petit trou bouché par un clou, ou une bouteille suspendue à pédale.',
    '- Savon et 20 secondes de frottement, même avec très peu d’eau.',
    '- Le gel hydroalcoolique ne nettoie pas les mains visiblement sales.',
  ]),
  fiche('dechets-eaux-grises', H, 'Déchets et eaux usées', [
    '- Séparer les déchets alimentaires, les fermer hermétiquement et les éloigner du logement : ils attirent rats et insectes.',
    '- Réutiliser l’eau de vaisselle ou de lavage pour les toilettes.',
    '- Ne jamais rejeter d’eau sale près d’un puits, d’une source ou d’un stock d’eau.',
  ]),

  fiche(
    'eau-potable-hygiene',
    H,
    'Éviter les contaminations dans le campement',
    [
      '- Définir une zone propre pour cuisiner et une zone séparée pour les déchets et les toilettes.',
      '- Se laver les mains au savon avant de préparer les repas, avant de manger et après les toilettes ou la manipulation des déchets.',
      '- Utiliser des récipients distincts pour l’eau potable et l’eau non potable ; les identifier clairement.',
      '- Nettoyer les surfaces de préparation et ne pas laisser les aliments à température ambiante plus longtemps que nécessaire.',
      '- Protéger les plaies et ne pas partager serviettes, rasoirs ou matériel de soin.',
      '## Organisation simple',
      '= Zone propre  Eau potable, aliments fermés, ustensiles lavés',
      '= Zone sale  Déchets fermés, nettoyage, matériel souillé',
      '= Toilettes  À distance des eaux, du stockage et de la préparation des repas',
    ],
  ),
];
