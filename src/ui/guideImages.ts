/**
 * Illustrations des fiches du guide (lignes « ▣ clé  Titre  Texte »),
 * embarquées et compressées. Une clé inconnue s'affiche sans image.
 */
import type { ImageSourcePropType } from 'react-native';

export const GUIDE_IMAGES: Record<string, ImageSourcePropType> = {
  'garrot-etape1': require('./assets/guide/garrot-etape1.jpg'),
  'garrot-etape2': require('./assets/guide/garrot-etape2.jpg'),
  'garrot-etape3': require('./assets/guide/garrot-etape3.jpg'),
  'garrot-etape4': require('./assets/guide/garrot-etape4.jpg'),
  'garrot-etape5': require('./assets/guide/garrot-etape5.jpg'),
  'fermeture-bandelettes': require('./assets/guide/fermeture-bandelettes.jpg'),
  'fermeture-colle': require('./assets/guide/fermeture-colle.jpg'),
  'fermeture-points': require('./assets/guide/fermeture-points.jpg'),
  'medicaments-douleur': require('./assets/guide/medicaments-douleur.jpg'),
  'medicaments-allergies': require('./assets/guide/medicaments-allergies.jpg'),
  'medicaments-rehydratation': require('./assets/guide/medicaments-rehydratation.jpg'),
  'medicaments-plaies': require('./assets/guide/medicaments-plaies.jpg'),
};
