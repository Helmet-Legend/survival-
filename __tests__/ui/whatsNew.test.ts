import { prepareDatabase } from '../../src/db/connection';
import {
  loadWhatsNewSeen,
  saveWhatsNewSeen,
  unseenNews,
  WHATS_NEW,
  WHATS_NEW_SHOWN_MAX,
} from '../../src/ui/whatsNew';
import { NodeSqliteDb } from '../db/sqlite';

const entry = (id: number) => ({ id, title: `n${id}`, items: ['x'] });

describe('Nouveautés', () => {
  it('a des numéros uniques, du plus récent au plus ancien', () => {
    const ids = WHATS_NEW.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort((a, b) => b - a)).toEqual(ids);
  });

  it('ne montre que les entrées pas encore vues, les plus récentes', () => {
    const all = [1, 2, 3, 4, 5].map(entry);
    expect(unseenNews(3, all).map(e => e.id)).toEqual([5, 4]);
    expect(unseenNews(5, all)).toEqual([]);
    expect(unseenNews(0, all).map(e => e.id)).toHaveLength(WHATS_NEW_SHOWN_MAX);
    expect(unseenNews(0, all)[0].id).toBe(5);
  });

  it('garde le dernier numéro vu dans le coffre', async () => {
    const db = new NodeSqliteDb();
    await prepareDatabase(db);
    expect(await loadWhatsNewSeen(db)).toBe(0);
    await saveWhatsNewSeen(db, 2);
    await saveWhatsNewSeen(db, 3);
    expect(await loadWhatsNewSeen(db)).toBe(3);
  });
});
