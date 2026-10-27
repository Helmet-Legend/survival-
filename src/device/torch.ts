/**
 * Signal SOS au flash du téléphone (module natif `ResiliosTorch`). Le rythme
 * est calculé ici et joué en natif, sur son propre fil : un minuteur
 * JavaScript se décale dès que l'interface travaille, et un SOS déformé
 * devient illisible. Absent dans les tests et l'aperçu web.
 */
import { NativeModules, Platform } from 'react-native';

/**
 * Durée d'un point, en millisecondes. 250 ms : lent pour un opérateur radio,
 * mais lisible à l'œil, de loin, par quelqu'un qui ne connaît pas le morse.
 */
export const SOS_UNIT_MS = 250;

/**
 * Alternance allumé / éteint en millisecondes, en commençant allumé :
 * · · · – – – · · · d'un seul tenant (point = 1 temps, trait = 3, 1 temps
 * entre deux signes), puis 7 temps d'obscurité avant de recommencer.
 * Voir la fiche « Code morse ».
 */
export function sosPattern(unit: number = SOS_UNIT_MS): number[] {
  const marks = [1, 1, 1, 3, 3, 3, 1, 1, 1];
  return marks.flatMap((mark, i) => [
    mark * unit,
    (i === marks.length - 1 ? 7 : 1) * unit,
  ]);
}

export interface TorchSignal {
  /** Le téléphone a une lampe (flash arrière) que l'application peut piloter. */
  available: boolean;
  /** Répète le motif jusqu'à `stop()`. Rejette si la lampe est occupée. */
  start(pattern: readonly number[]): Promise<void>;
  /** Éteint la lampe ; sans effet si elle l'est déjà. */
  stop(): Promise<void>;
}

interface NativeTorchModule {
  getConstants?: () => { available?: boolean };
  available?: boolean;
  blink(pattern: number[]): Promise<void>;
  stop(): Promise<void>;
}

export const NO_TORCH: TorchSignal = {
  available: false,
  start: async () => undefined,
  stop: async () => undefined,
};

export function nativeTorch(): TorchSignal {
  const native =
    Platform.OS === 'android' || Platform.OS === 'ios'
      ? (NativeModules.ResiliosTorch as NativeTorchModule | undefined)
      : undefined;
  const available =
    native !== undefined &&
    (native.available ?? native.getConstants?.().available ?? false);
  if (native === undefined || !available) {
    return NO_TORCH;
  }
  return {
    available: true,
    start: pattern => native.blink([...pattern]),
    stop: () => native.stop(),
  };
}
