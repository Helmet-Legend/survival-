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
];
