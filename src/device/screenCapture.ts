/**
 * Réglage « Autoriser les captures d'écran » (module natif Android
 * `ResiliosScreen`). Absent sur iOS, dans les tests et l'aperçu web.
 */
import { NativeModules, Platform } from 'react-native';

export interface ScreenCaptureSetting {
  available: boolean;
  isAllowed(): Promise<boolean>;
  setAllowed(allowed: boolean): Promise<void>;
}

interface NativeScreenModule {
  isCaptureAllowed(): Promise<boolean>;
  setCaptureAllowed(allowed: boolean): Promise<boolean>;
}

export function nativeScreenCapture(): ScreenCaptureSetting {
  const native =
    Platform.OS === 'android'
      ? (NativeModules.ResiliosScreen as NativeScreenModule | undefined)
      : undefined;
  if (native === undefined) {
    return {
      available: false,
      isAllowed: async () => false,
      setAllowed: async () => undefined,
    };
  }
  return {
    available: true,
    isAllowed: () => native.isCaptureAllowed(),
    setAllowed: async allowed => {
      await native.setCaptureAllowed(allowed);
    },
  };
}
