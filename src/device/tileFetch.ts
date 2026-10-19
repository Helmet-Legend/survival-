/**
 * Téléchargement des tuiles de carte par le module natif Android
 * `ResiliosTiles` (connexion HTTPS directe, image rendue en base64), avec
 * repli sur `fetch` ailleurs.
 */
import { NativeModules, Platform } from 'react-native';

import { defaultTileFetch, type TileFetch } from '../geo/tiles';

interface NativeTilesModule {
  fetchTile(url: string): Promise<string>;
}

export function nativeTileFetch(): TileFetch {
  const native =
    Platform.OS === 'android'
      ? (NativeModules.ResiliosTiles as NativeTilesModule | undefined)
      : undefined;
  if (native === undefined) {
    return defaultTileFetch;
  }
  return url => native.fetchTile(url);
}
