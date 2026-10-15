import { createContext, useContext } from 'react';

import type {
  ArmoryRepository,
  DocumentRepository,
  InventoryRepository,
  PhotoRepository,
} from '../inventory';
import type { ScreenCaptureSetting } from '../device/screenCapture';
import type { PhotoSource } from '../photo/photoSource';
import type { VaultDatabase } from '../vault';

/** Coffre déverrouillé, accessible aux écrans de l'application. */
export interface Session {
  db: VaultDatabase;
  repo: InventoryRepository;
  armory: ArmoryRepository;
  documents: DocumentRepository;
  photos: PhotoRepository;
  /** Appareil photo et galerie (indisponibles hors Android). */
  photoSource: PhotoSource;
  /** Autorisation des captures d'écran (indisponible hors Android). */
  screenCapture: ScreenCaptureSetting;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) {
    throw new Error('Aucun coffre ouvert');
  }
  return session;
}
