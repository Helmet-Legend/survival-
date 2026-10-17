/** Préparation du foyer et conduite à tenir face aux risques majeurs. */
import { fiche } from './fiche';

const P = 'Préparation';
const R = 'Risques & alertes';

export const PREPARATION = [
  fiche('kit-72h', P, 'Kit d’urgence 72 heures', [
    'De quoi tenir trois jours sans aide extérieure :',
    '- Eau : 3 litres par personne et par jour.',
    '- Nourriture ne nécessitant pas de cuisson, ouvre-boîte.',
    '- Lampe, radio à piles ou à manivelle, piles de rechange.',
    '- Trousse de secours et médicaments personnels.',
    '- Copies des papiers d’identité, argent liquide, vêtements chauds.',
  ]),
  fiche('sac-evacuation', P, 'Sac d’évacuation', [
    'Un sac par personne, prêt près de la sortie, à prendre en moins de 5 minutes.',
    '- Eau (2 litres) et gourde filtrante, barres et rations pour 72 heures.',
    '- Vêtements chauds, poncho, couverture de survie, chaussures solides.',
    '- Lampe frontale, piles, batterie externe et câble, radio.',
    '- Trousse de secours, traitements personnels, lunettes de rechange.',
    '- Couteau, briquet et pierre à feu, cordelette, ruban adhésif, sacs poubelle.',
    '- Copies des papiers (ou clé USB chiffrée), argent liquide en petites coupures, liste de contacts sur papier.',
    '- Carte papier de la région et boussole.',
    'Vérifier le contenu et les dates tous les 6 mois.',
  ]),
  fiche('plan-familial', P, 'Plan familial d’urgence', [
    '1. Choisir deux points de ralliement : un près du domicile, un hors du quartier.',
    '2. Désigner un contact éloigné que chacun appellera pour donner des nouvelles.',
    '3. Répartir les rôles : qui récupère les enfants, les personnes âgées, les animaux.',
    '4. Savoir couper l’eau, le gaz et l’électricité du logement.',
    '5. Connaître l’école des enfants et son plan de mise en sûreté.',
    '6. S’entraîner une fois par an : sortir avec le sac en moins de 5 minutes.',
    'Enregistrez les points de ralliement dans l’onglet Carte et les contacts sur papier dans le sac.',
  ]),
  fiche('coupure-courant', P, 'Coupure d’électricité prolongée', [
    '- Débrancher les appareils sensibles pour éviter la surtension au retour du courant ; laisser une lampe branchée pour savoir quand il revient.',
    '- Garder réfrigérateur et congélateur fermés.',
    '- S’éclairer à la lampe frontale plutôt qu’aux bougies (risque d’incendie).',
    '- Se regrouper dans une seule pièce l’hiver, calfeutrer sans boucher les aérations.',
    '! Groupe électrogène : uniquement dehors, loin des fenêtres. Jamais de chauffage d’appoint à combustion dans une pièce fermée.',
  ]),
  fiche('confinement', P, 'Se mettre à l’abri (confinement)', [
    'Sur ordre des autorités (sirène, FR-Alert sur le téléphone, radio) :',
    '1. Rentrer dans le bâtiment le plus proche. Ne pas aller chercher les enfants à l’école : ils y sont protégés.',
    '2. Fermer portes et fenêtres, arrêter ventilation et climatisation.',
    '3. Calfeutrer les ouvertures avec du ruban adhésif et des linges humides.',
    '4. Écouter la radio (France Info, réseau ICI) et ne téléphoner qu’en cas d’urgence.',
    '5. Ne sortir qu’à l’annonce officielle de fin d’alerte.',
  ]),
  fiche('papiers-importants', P, 'Papiers et argent', [
    '- Copies de la carte d’identité, du passeport, du livret de famille, de la carte Vitale, des ordonnances et de l’assurance habitation.',
    '- Les photographier dans le dossier Documents de Fenrir : chiffrés et disponibles hors ligne.',
    '- Garder de l’argent liquide en petites coupures : les terminaux de paiement s’arrêtent avec le courant.',
    '- Noter les numéros de contrat d’assurance et de téléphone des assureurs.',
  ]),
];

export const RISQUES = [
  fiche('alerte-sirene', R, 'Reconnaître l’alerte', [
    '## Sirène (signal national d’alerte)',
    '- Début d’alerte : son montant et descendant, trois cycles de 1 minute 41 secondes séparés de 5 secondes.',
    '- Fin d’alerte : son continu de 30 secondes.',
    '- Essai mensuel : un seul cycle le premier mercredi du mois à midi.',
    '## FR-Alert',
    'Message reçu sur le téléphone avec un son particulier, même en mode silencieux, dans la zone concernée. Il indique le danger et la conduite à tenir.',
    'Dans tous les cas : se mettre à l’abri et écouter la radio.',
  ]),
  fiche('inondation', R, 'Inondation', [
    '- Monter dans les étages avec le sac d’évacuation, de l’eau et une radio.',
    '- Couper l’électricité et le gaz si l’eau approche.',
    '- Mettre en hauteur papiers, médicaments et objets de valeur.',
    '! Ne jamais traverser une route inondée à pied ou en voiture : 30 cm d’eau suffisent à emporter une voiture, 15 cm à faire tomber un adulte.',
    'Après la crue : ne pas consommer l’eau du robinet avant l’avis de la mairie, aérer, photographier les dégâts pour l’assurance.',
  ]),
  fiche('seisme', R, 'Séisme', [
    '## Pendant',
    '- À l’intérieur : se mettre sous une table solide et se tenir à ses pieds, loin des fenêtres. Ne pas sortir pendant la secousse.',
    '- À l’extérieur : s’éloigner des bâtiments, murs et lignes électriques.',
    '- En voiture : s’arrêter loin des ponts et des bâtiments, rester à l’intérieur.',
    '## Après',
    '- Couper eau, gaz et électricité, ne pas allumer de flamme (fuite de gaz possible).',
    '- Sortir avec prudence en prévoyant des répliques, ne pas prendre l’ascenseur.',
    '- Ne pas entrer dans un bâtiment endommagé.',
  ]),
  fiche('feu-de-foret', R, 'Feu de forêt', [
    '- Un bâtiment solide protège mieux qu’une fuite à pied ou en voiture face au front de flammes.',
    '- Fermer portes, fenêtres et volets, arroser les abords si le temps le permet, boucher les aérations avec des linges mouillés.',
    '- Rester à l’intérieur jusqu’au passage du feu, puis éteindre les braises autour.',
    '- Si vous êtes pris dehors : respirer à travers un linge humide, chercher une zone déjà brûlée ou dégagée, s’allonger au sol.',
    'Appeler le 18 ou le 112 pour signaler tout départ de feu, en donnant une position précise.',
  ]),
  fiche('tempete', R, 'Tempête', [
    '- Rentrer les objets qui peuvent s’envoler, fermer volets et fenêtres.',
    '- Éviter les déplacements, surtout en forêt et en bord de mer.',
    '- Ne pas toucher les câbles électriques tombés au sol.',
    '- Préparer lampes et radio en prévision de coupures.',
  ]),
  fiche('canicule', R, 'Canicule', [
    '- Fermer volets et fenêtres le jour, aérer la nuit.',
    '- Boire régulièrement sans attendre la soif, manger normalement.',
    '- Se rafraîchir : douches, linges humides, lieux climatisés.',
    '- Éviter les efforts aux heures chaudes (11 h à 21 h).',
    '- Prendre des nouvelles des personnes âgées et isolées chaque jour.',
    'Signes de coup de chaleur : voir la fiche Médical correspondante.',
  ]),
  fiche('grand-froid', R, 'Grand froid', [
    '- Chauffer une seule pièce, fermer les autres, calfeutrer portes et fenêtres sans boucher les aérations.',
    '- S’habiller en plusieurs couches, couvrir tête et mains, même à l’intérieur.',
    '- Manger chaud et suffisamment, boire des boissons chaudes non alcoolisées.',
    '- Couper l’eau et vider les canalisations d’une maison non chauffée pour éviter le gel.',
  ]),
  fiche('accident-nucleaire', R, 'Accident nucléaire', [
    '1. Se mettre à l’abri dans un bâtiment, au centre ou au sous-sol, portes et fenêtres fermées, ventilation arrêtée.',
    '2. Si vous étiez dehors : retirer les vêtements extérieurs, les mettre dans un sac fermé, se doucher.',
    '3. Écouter la radio et suivre les consignes.',
    '! Ne prendre l’iode stable (comprimés distribués en pharmacie autour des centrales) que sur ordre du préfet, à la dose indiquée selon l’âge. Il ne protège que la thyroïde et seulement s’il est pris au bon moment.',
  ]),
  fiche('accident-chimique', R, 'Accident industriel ou chimique', [
    '- Se mettre à l’abri immédiatement dans le bâtiment le plus proche (voir la fiche Se mettre à l’abri).',
    '- Ne pas aller chercher les enfants, ne pas fumer, ne pas allumer de flamme.',
    '- Si une odeur apparaît à l’intérieur : se protéger le nez et la bouche avec un linge humide.',
    '- Évacuer seulement sur ordre des autorités, dans la direction indiquée.',
  ]),
];
