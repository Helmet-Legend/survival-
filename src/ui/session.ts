import { createContext, useContext } from 'react';

import type {
  ArmoryRepository,
  BagRepository,
  DocumentRepository,
  InventoryRepository,
  PhotoRepository,
} from '../inventory';
import type { FileAccess } from '../device/files';
import type { ScreenCaptureSetting } from '../device/screenCapture';
import type { Argon2Params } from '../crypto/params';
import type { Argon2Engine, RandomSource } from '../crypto/types';
import type { ReminderScheduler } from '../resilience/reminders';
import type { PhotoSource } from '../photo/photoSource';
import type { VaultDatabase } from '../vault';

/** Coffre déverrouillé, accessible aux écrans de l'application. */
export interface Session {
  db: VaultDatabase;
  repo: InventoryRepository;
  armory: ArmoryRepository;
  documents: DocumentRepository;
  photos: PhotoRepository;
  /** Sacs d'évacuation. */
  bags: BagRepository;
  /** Appareil photo et galerie (indisponibles hors Android). */
  photoSource: PhotoSource;
  /** Autorisation des captures d'écran (indisponible hors Android). */
  screenCapture: ScreenCaptureSetting;
  /** Rappels de péremption du téléphone (indisponibles hors Android). */
  reminders: ReminderScheduler;
  /** Fichiers choisis par l'utilisateur (sauvegarde, export). */
  files: FileAccess;
  /** Chiffrement des sauvegardes (null : sauvegarde indisponible). */
  backupCrypto: BackupCrypto | null;
}

export interface BackupCrypto {
  engine: Argon2Engine;
  random: RandomSource;
  params?: Argon2Params;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) {
    throw new Error('Aucun coffre ouvert');
  }
  return session;
}
