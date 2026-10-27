import { sosPattern, SOS_UNIT_MS } from '../../src/device/torch';

describe('signal SOS lumineux', () => {
  it('joue · · · – – – · · · d’un seul tenant, puis 7 temps de pause', () => {
    const u = 100;
    expect(sosPattern(u)).toEqual([
      // allumé, éteint : trois points
      100, 100, 100, 100, 100, 100,
      // trois traits
      300, 100, 300, 100, 300, 100,
      // trois points, puis la pause avant de recommencer
      100, 100, 100, 100, 100, 700,
    ]);
  });

  it('dure 30 temps par répétition, soit 7,5 s au rythme par défaut', () => {
    const total = sosPattern().reduce((a, b) => a + b, 0);
    expect(total).toBe(30 * SOS_UNIT_MS);
    expect(total).toBe(7500);
  });
});
