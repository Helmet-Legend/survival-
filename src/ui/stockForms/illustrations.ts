/**
 * Illustrations de catégorie du pack graphique Fenrir (en-tête des fiches),
 * recadrées au-dessus de leur pastille d'icône et compressées pour l'APK.
 */
import type { ImageSourcePropType } from 'react-native';

import type { ItemCategory } from '../../inventory';
import { colors } from '../theme';

export const CATEGORY_ILLUSTRATIONS: Record<ItemCategory, ImageSourcePropType> =
  {
    water: require('../assets/illustrations/water.jpg'),
    food: require('../assets/illustrations/food.jpg'),
    weapon: require('../assets/illustrations/weapon.jpg'),
    medical: require('../assets/illustrations/medical.jpg'),
    tool: require('../assets/illustrations/tool.jpg'),
    energy: require('../assets/illustrations/energy.jpg'),
  };

/** Fondu vers la surface de la carte, sous l'illustration (lisibilité). */
export const ILLUSTRATION_FADE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" preserveAspectRatio="none">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset=".35" stop-color="${colors.surface}" stop-opacity="0"/>
      <stop offset="1" stop-color="${colors.surface}" stop-opacity="1"/>
    </linearGradient>
  </defs>
  <rect width="10" height="10" fill="url(#fade)"/>
</svg>`;
