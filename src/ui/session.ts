import { createContext, useContext } from 'react';

import type {
  ArmoryRepository,
  BagRepository,
  DocumentRepository,
  InventoryRepository,
  PhotoRepository,
} from '../inventory';
import type { FileAccess } from '../device/files';
import type { LocationSource } from '../device/location';
import type { ScreenCaptureSetting } from '../device/screenCapture';
import type { Argon2Params } from '../crypto/params';
import type { Argon2Engine, RandomSource } from '../crypto/types';
import type { ReminderScheduler } from '../resilience/reminders';
import type { PhotoSource } from '../photo/photoSource';
import type { ProductFetch } from '../scanner/products';
import type { ScanSource } from '../scanner/scanSource';
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
  /** Position GPS à la demande (écran Urgence). */
  location: LocationSource;
  /** Fichiers choisis par l'utilisateur (sauvegarde, export). */
  files: FileAccess;
  /** Chiffrement des sauvegardes (null : sauvegarde indisponible). */
  backupCrypto: BackupCrypto | null;
  /** Lecteur de codes-barres (indisponible hors Android). */
  scanSource: ScanSource;
  /** Requête vers Open Food Facts, faite seulement avec l'accord donné. */
  productFetch: ProductFetch;
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
