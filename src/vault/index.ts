/**
 * Orchestration coffre + schéma : création des deux bases, déverrouillage
 * et mise à niveau du schéma.
 *
 * Les deux bases reçoivent le même traitement (migrations et fiches
 * embarquées) afin que rien, ni le schéma ni la taille des fichiers, ne
 * distingue la vraie base du leurre.
 */
import type { EncryptedDatabase } from '../crypto/types';
import type { VaultKeyManager } from '../crypto/VaultKeyManager';
import {
  prepareDatabase,
  syncGuides,
  type BundledGuide,
  type SqlDatabase,
} from '../db';

export type VaultDatabase = EncryptedDatabase & SqlDatabase;

export interface VaultContent {
  /** Fiches Markdown embarquées, identiques dans les deux bases. */
  guides: readonly BundledGuide[];
  /**
   * Remplit la base factice de données anodines et crédibles. Appelé
   * uniquement si un code de contrainte est défini.
   */
  seedDecoy?: (db: SqlDatabase) => Promise<void>;
}

async function prepareWithContent(
  db: SqlDatabase,
  content: VaultContent,
): Promise<void> {
  await prepareDatabase(db);
  await syncGuides(db, content.guides);
}

/** Crée le coffre et renvoie la vraie base, prête à l'emploi. */
export async function createVault<TDb extends VaultDatabase>(
  manager: VaultKeyManager<TDb>,
  content: VaultContent,
  pins: { masterPin: string; duressPin?: string },
): Promise<TDb> {
  const { primary, decoy } = await manager.initialize(pins);
  try {
    await prepareWithContent(primary, content);
    await prepareWithContent(decoy, content);
    if (pins.duressPin !== undefined && content.seedDecoy) {
      await content.seedDecoy(decoy);
    }
  } catch (error) {
    primary.close();
    throw error;
  } finally {
    decoy.close();
  }
  return primary;
}

/**
 * Déverrouille la base correspondant au code et met son schéma à niveau.
 * Les erreurs de crypto (`CryptoError`) et de migration (`MigrationError`)
 * sont propagées telles quelles.
 */
export async function openVault<TDb extends VaultDatabase>(
  manager: VaultKeyManager<TDb>,
  content: VaultContent,
  pin: string,
): Promise<TDb> {
  const { db } = await manager.unlock(pin);
  try {
    await prepareWithContent(db, content);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}
