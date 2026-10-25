/**
 * Prise ou choix d'une photo (module natif Android `ResiliosPhoto`). Les
 * fonctions renvoient l'image en JPEG base64, ou null si l'utilisateur a
 * annulé. Absent sur iOS, dans les tests et l'aperçu web.
 */
import { NativeModules, Platform } from 'react-native';

export interface PhotoSource {
  available: boolean;
  take(): Promise<string | null>;
  pick(): Promise<string | null>;
}

interface NativePhotoModule {
  takePhoto(): Promise<string | null>;
  pickPhoto(): Promise<string | null>;
}

let away = 0;

/**
 * L'appareil photo et la galerie passent l'application en arrière-plan,
 * ce qui verrouille normalement le coffre et ferait perdre la photo. Le
 * verrouillage automatique est suspendu pendant ces seules opérations.
 */
export async function whileAway<T>(task: () => Promise<T>): Promise<T> {
  away++;
  try {
    return await task();
  } finally {
    away--;
  }
}

export function isAwayForPhoto(): boolean {
  return away > 0;
}

export function nativePhotoSource(): PhotoSource {
  const native =
    Platform.OS === 'android' || Platform.OS === 'ios'
      ? (NativeModules.ResiliosPhoto as NativePhotoModule | undefined)
      : undefined;
  if (native === undefined) {
    return {
      available: false,
      take: async () => null,
      pick: async () => null,
    };
  }
  return {
    available: true,
    take: () => whileAway(() => native.takePhoto()),
    pick: () => whileAway(() => native.pickPhoto()),
  };
}
