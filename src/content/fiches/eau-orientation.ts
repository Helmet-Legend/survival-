/** Eau et orientation. */
import { fiche } from './fiche';

const E = 'Eau';
const O = 'Orientation';

export const EAU = [
  fiche('eau-potable', E, 'Rendre l’eau potable', [
    'Laisser décanter l’eau trouble, puis la filtrer à travers un tissu propre pour retirer les particules.',
    '- Porter à ébullition franche pendant au moins 1 minute (3 minutes au-dessus de 2 000 m d’altitude).',
    '- À défaut, utiliser des pastilles de purification en respectant la dose et le temps de contact indiqués sur la notice.',
    '- Conserver l’eau traitée dans un récipient propre et fermé.',
    'Un filtre seul ne neutralise pas tous les virus : combiner filtration et ébullition ou traitement chimique.',
  ]),
  fiche('eau-javel', E, 'Désinfecter l’eau à l’eau de Javel', [
    'Uniquement avec de l’eau de Javel sans parfum ni additif, à 2,6 % de chlore actif (concentration courante en flacon en France).',
    '= Eau claire     2 gouttes par litre',
    '= Eau trouble    4 gouttes par litre (après filtration)',
    '1. Mélanger et attendre 30 minutes à l’abri du soleil.',
    '2. L’eau doit garder une légère odeur de chlore. Sinon, refaire une dose et attendre encore 15 minutes.',
    '! Ne jamais utiliser de Javel parfumée, « gel » ou d’un produit dont vous ignorez la concentration. Les berlingots concentrés (9,6 %) se diluent d’abord selon l’étiquette.',
  ]),
  fiche('eau-trouver', E, 'Trouver de l’eau', [
    '- Recueillir la pluie avec une bâche ou des récipients propres : c’est souvent l’eau la plus sûre.',
    '- Ramasser la rosée du matin avec un tissu passé dans l’herbe, puis l’essorer.',
    '- Sac plastique sur une branche feuillue au soleil : la condensation s’accumule dans un coin (quelques décilitres par jour).',
    '- Suivre la pente, la végétation dense et les traces d’animaux vers les points bas.',
    '- En ville : réservoir du chauffe-eau, chasses d’eau (réservoir, pas la cuvette), piscines (à traiter).',
    '! Toute eau trouvée se traite avant d’être bue. Ne jamais boire l’eau de mer ni l’urine.',
  ]),
  fiche('eau-besoins-stockage', E, 'Besoins et stockage de l’eau', [
    '= Boisson       2 à 3 litres par personne et par jour',
    '= Cuisine, hygiène minimale  +2 litres',
    '= Chaleur, effort, maladie   jusqu’au double',
    '- Stocker dans des bidons alimentaires opaques, à l’abri de la lumière et de la chaleur.',
    '- Eau du robinet stockée : la renouveler tous les 6 mois. Eau en bouteille : respecter la date indiquée.',
    '- Garder une réserve d’au moins 3 jours, idéalement 2 semaines.',
    'Les fiches Eau de Stocks calculent votre autonomie en jours selon la taille du foyer.',
  ]),
];

export const ORIENTATION = [
  fiche('boussole-carte', O, 'Boussole et carte', [
    '## Orienter la carte',
    '1. Poser la boussole sur la carte, bord parallèle au quadrillage nord-sud.',
    '2. Tourner carte et boussole ensemble jusqu’à ce que l’aiguille pointe le nord de la carte (en tenant compte de la déclinaison).',
    '## Prendre un azimut sur la carte',
    '1. Poser le bord de la boussole entre votre position et la destination, flèche de direction vers la destination.',
    '2. Tourner le cadran jusqu’à aligner ses lignes avec le nord de la carte.',
    '3. Corriger de la déclinaison magnétique (indiquée en marge de la carte).',
    '4. Tenir la boussole à plat, tourner sur vous-même jusqu’à ce que l’aiguille se place dans la flèche du cadran : marcher dans la direction de la flèche.',
    'L’onglet Carte calcule distance, azimut vrai, gisement et cap boussole entre deux positions MGRS.',
  ]),
  fiche('orientation-soleil-etoiles', O, 'S’orienter sans boussole', [
    '## Le soleil',
    'Il se lève à l’est, culmine au sud à midi solaire (vers 13 h en hiver et 14 h en été, à l’heure légale française), et se couche à l’ouest.',
    '## La montre à aiguilles',
    'Pointer la petite aiguille vers le soleil. Le sud se trouve à mi-chemin entre la petite aiguille et le 1 en hiver (le 2 en été), dans l’hémisphère Nord.',
    '## Le bâton et l’ombre',
    '1. Planter un bâton droit, marquer le bout de son ombre.',
    '2. Attendre 15 minutes, marquer le nouveau bout.',
    '3. La ligne entre la première et la seconde marque va d’ouest en est.',
    '## L’étoile polaire',
    'Prolonger cinq fois la distance entre les deux étoiles du bord de la « casserole » opposé au manche, dans la Grande Ourse : on arrive à l’étoile polaire, qui indique le nord à moins d’un degré près.',
    '! La mousse sur les arbres n’est pas un indicateur fiable du nord.',
  ]),
  fiche('mgrs', O, 'Lire une position MGRS', [
    'Exemple : 31U DQ 48251 11932',
    '- 31U : zone (bande de 6° de longitude) et bande de latitude.',
    '- DQ : carré de 100 km.',
    '- 48251 : position vers l’est dans ce carré (« à droite »).',
    '- 11932 : position vers le nord (« en haut »).',
    'Toujours lire d’abord vers la droite, puis vers le haut. Avec 5 chiffres par axe, la précision est de 1 mètre ; avec 4, de 10 mètres ; avec 3, de 100 mètres.',
    'C’est le format utilisé par les secours et les armées : l’annoncer lettre par lettre avec l’alphabet radio.',
  ]),
  fiche('perdu', O, 'Je suis perdu', [
    '1. S’arrêter. S’asseoir, boire, manger un peu : réfléchir avant de bouger.',
    '2. Se souvenir du dernier endroit connu et du temps écoulé depuis.',
    '3. Observer : relief, cours d’eau, routes, bruits, lignes électriques.',
    '4. Si la nuit, le froid ou la fatigue approchent : rester sur place, s’abriter et signaler sa présence.',
    '5. Sinon, revenir sur ses pas jusqu’au dernier point connu, ou suivre une ligne d’arrêt sûre (route, rivière vers l’aval avec prudence).',
    'Quelqu’un qui sait où vous êtes partis vous retrouvera plus vite si vous restez visible au même endroit.',
  ]),
];
