/**
 * Boussole du téléphone (module natif Android `ResiliosCompass`) : cap
 * magnétique en continu tant qu'un écran l'écoute, et déclinaison du lieu
 * par le modèle magnétique embarqué. Absente sur iOS, dans les tests et
 * l'aperçu web.
 */
import {
  DeviceEventEmitter,
  NativeEventEmitter,
  NativeModules,
  Platform,
} from 'react-native';

export interface HeadingReading {
  /** Cap magnétique du haut de l'écran, en degrés [0, 360[. */
  heading: number;
  /** Capteur à recalibrer (faire un « 8 » avec le téléphone). */
  unreliable: boolean;
}

export interface CompassSource {
  available: boolean;
  /** Écoute le cap ; la fonction rendue arrête l'écoute. */
  watch(listener: (reading: HeadingReading) => void): () => void;
  /** Déclinaison (degrés, positive à l'est), ou null si inconnue. */
  declination(latitude: number, longitude: number): Promise<number | null>;
}

interface NativeCompassModule {
  getConstants?: () => { available?: boolean };
  available?: boolean;
  start(): void;
  stop(): void;
  declination(latitude: number, longitude: number): Promise<number>;
}

export const NO_COMPASS: CompassSource = {
  available: false,
  watch: () => () => undefined,
  declination: async () => null,
};

export function nativeCompass(): CompassSource {
  const native =
    Platform.OS === 'android' || Platform.OS === 'ios'
      ? (NativeModules.ResiliosCompass as NativeCompassModule | undefined)
      : undefined;
  const available =
    native !== undefined &&
    (native.available ?? native.getConstants?.().available ?? false);
  if (native === undefined || !available) {
    return NO_COMPASS;
  }
  let listeners = 0;
  return {
    available: true,
    watch: listener => {
      const subscription = eventsOf(native).addListener(
        'ResiliosHeading',
        (event: { heading: number; accuracy: number }) =>
          // SENSOR_STATUS_UNRELIABLE (0) ou ACCURACY_LOW (1).
          listener({ heading: event.heading, unreliable: event.accuracy <= 1 }),
      );
      if (listeners++ === 0) {
        native.start();
      }
      return () => {
        subscription.remove();
        if (--listeners === 0) {
          native.stop();
        }
      };
    },
    declination: async (latitude, longitude) => {
      try {
        return await native.declination(latitude, longitude);
      } catch {
        return null;
      }
    },
  };
}

/**
 * Évènements natifs : DeviceEventEmitter sur Android ; sur iOS, le module
 * est un RCTEventEmitter qui n'émet qu'une fois écouté par NativeEventEmitter.
 */
function eventsOf(native: object): {
  addListener<T>(
    event: string,
    listener: (event: T) => void,
  ): {
    remove(): void;
  };
} {
  const asHandler = (listener: unknown) =>
    listener as (...args: unknown[]) => void;
  if (Platform.OS === 'ios') {
    const emitter = new NativeEventEmitter(
      native as ConstructorParameters<typeof NativeEventEmitter>[0],
    );
    return {
      addListener: (event, listener) =>
        emitter.addListener(event, asHandler(listener)),
    };
  }
  return {
    addListener: (event, listener) =>
      DeviceEventEmitter.addListener(event, asHandler(listener)),
  };
}
