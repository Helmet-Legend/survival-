/**
 * Fond de l'accueil : paysage au coucher du soleil derrière l'en-tête et la
 * jauge. Le haut est assombri pour le titre, le bas se fond dans le noir de
 * l'application avant les cartes, qui restent sur fond sombre et lisibles.
 */
import React from 'react';
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { colors } from '../theme';

const SOURCE = require('../assets/backgrounds/home-sunset.jpg');
/** Proportions de l'image (720 × 1279). */
const RATIO = 1279 / 720;
/** Hauteur visible : l'en-tête, la jauge et le bloc Foyer. */
const VISIBLE = 0.72;

const SHADE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" preserveAspectRatio="none">
  <defs>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${colors.bg}" stop-opacity=".55"/>
      <stop offset=".18" stop-color="${colors.bg}" stop-opacity=".15"/>
      <stop offset=".5" stop-color="${colors.bg}" stop-opacity=".25"/>
      <stop offset=".78" stop-color="${colors.bg}" stop-opacity=".85"/>
      <stop offset="1" stop-color="${colors.bg}" stop-opacity="1"/>
    </linearGradient>
  </defs>
  <rect width="10" height="10" fill="url(#shade)"/>
</svg>`;

export function HomeBackdrop() {
  const { width, height } = useWindowDimensions();
  const visible = Math.round(height * VISIBLE);
  return (
    <View
      pointerEvents="none"
      style={[styles.wrap, { height: visible }]}
      testID="home-backdrop"
    >
      <Image
        source={SOURCE}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
        style={{ width, height: Math.max(visible, width * RATIO) }}
      />
      <SvgXml
        xml={SHADE}
        width="100%"
        height="100%"
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
});
