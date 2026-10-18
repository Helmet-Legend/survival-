/**
 * Mode lumière rouge : un filtre posé sur tout l'écran ne garde que le rouge
 * (fusion « multiply »), pour préserver la vision de nuit. Réglage gardé
 * dans le coffre ; il reste actif après un verrouillage.
 */
import { createContext, useContext } from 'react';
import { Platform } from 'react-native';

import type { SqlDatabase } from '../db/types';

const KEY = 'red_light';

/**
 * Les modes de fusion ne s'appliquent qu'à partir d'Android 10 : avant, le
 * filtre serait un aplat rouge opaque. Le réglage est alors masqué.
 */
export const RED_LIGHT_SUPPORTED =
  Platform.OS !== 'android' ||
  (typeof Platform.Version === 'number' && Platform.Version >= 29);

export async function loadRedLight(db: SqlDatabase): Promise<boolean> {
  const { rows } = await db.execute(
    'SELECT value FROM settings WHERE key = ?',
    [KEY],
  );
  return rows[0]?.value === '1';
}

export async function saveRedLight(
  db: SqlDatabase,
  on: boolean,
): Promise<void> {
  await db.execute(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [KEY, on ? '1' : '0'],
  );
}

export interface RedLight {
  on: boolean;
  set(on: boolean): Promise<void>;
}

export const RedLightContext = createContext<RedLight>({
  on: false,
  set: async () => undefined,
});

export function useRedLight(): RedLight {
  return useContext(RedLightContext);
}
