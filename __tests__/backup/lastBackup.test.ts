import { prepareDatabase } from '../../src/db/connection';
import {
  backupAge,
  getBackupStatus,
  saveLastBackup,
} from '../../src/backup/lastBackup';
import { InventoryRepository } from '../../src/inventory';
import { NodeSqliteDb } from '../db/sqlite';

async function setup() {
  const db = new NodeSqliteDb();
  await prepareDatabase(db);
  return { db, repo: new InventoryRepository(db) };
}

describe('rappel de sauvegarde', () => {
  it('ne rappelle rien sur un coffre neuf ni pendant 30 jours', async () => {
    const { db, repo } = await setup();
    expect(await getBackupStatus(db, '2026-10-26')).toEqual({
      last: null,
      daysSince: null,
      due: false,
    });
    await repo.createItem({ name: 'Riz', category: 'food', unit: 'kg' });
    await db.execute(
      "UPDATE inventory_items SET created_at = '2026-10-01T08:00:00.000Z'",
    );
    expect((await getBackupStatus(db, '2026-10-30')).due).toBe(false);
    // 30 jours après le premier article, sans sauvegarde : rappel.
    expect((await getBackupStatus(db, '2026-10-31')).due).toBe(true);
  });

  it('compte depuis la dernière sauvegarde', async () => {
    const { db } = await setup();
    await saveLastBackup(db, '2026-09-09');
    expect(await getBackupStatus(db, '2026-10-26')).toEqual({
      last: '2026-09-09',
      daysSince: 47,
      due: true,
    });
    await saveLastBackup(db, '2026-10-26');
    expect(await getBackupStatus(db, '2026-10-26')).toEqual({
      last: '2026-10-26',
      daysSince: 0,
      due: false,
    });
  });

  it('dit l’ancienneté en clair', () => {
    expect(backupAge(0)).toBe('aujourd’hui');
    expect(backupAge(1)).toBe('hier');
    expect(backupAge(47)).toBe('il y a 47 jours');
  });
});
