/** Icône Fenrir (loup et nom), pour l'écran de code et la création du coffre. */
import React from 'react';
import { Image, StyleSheet, type ImageSourcePropType } from 'react-native';

import { APP_NAME } from '../brand';
import { radius } from '../theme';

// Sur Android/iOS, `require` renvoie un identifiant d'image ; dans l'aperçu
// web (esbuild), une URL de données.
const ICON: number | string = require('../assets/fenrir-icon.png');
const SOURCE: ImageSourcePropType =
  typeof ICON === 'string' ? { uri: ICON } : ICON;

export function AppIcon({ size = 120 }: { size?: number }) {
  return (
    <Image
      source={SOURCE}
      accessibilityRole="image"
      accessibilityLabel={APP_NAME}
      style={[
        styles.icon,
        { width: size, height: size, borderRadius: size * 0.22 },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  icon: { borderRadius: radius.panel },
});
