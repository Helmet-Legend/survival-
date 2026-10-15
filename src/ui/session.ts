import { createContext, useContext } from 'react';

import type { ArmoryRepository, InventoryRepository } from '../inventory';
import type { VaultDatabase } from '../vault';

/** Coffre déverrouillé, accessible aux écrans de l'application. */
export interface Session {
  db: VaultDatabase;
  repo: InventoryRepository;
  armory: ArmoryRepository;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) {
    throw new Error('Aucun coffre ouvert');
  }
  return session;
}
