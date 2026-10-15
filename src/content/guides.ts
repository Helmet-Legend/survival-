/**
 * Fiches de survie embarquées dans l'application.
 *
 * À FAIRE VALIDER : ces fiches sont des exemples rédigés d'après les
 * recommandations grand public (PSC1, Croix-Rouge). Elles doivent être
 * relues par un professionnel de santé avant toute diffusion.
 */
import type { BundledGuide } from '../db/guides';

export const BUNDLED_GUIDES: BundledGuide[] = [
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
