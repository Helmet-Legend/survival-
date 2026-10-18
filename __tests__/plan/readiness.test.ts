import type { BagSummary, ItemSummary } from '../../src/inventory';
import { emptyPlan } from '../../src/plan/familyPlan';
import { CHECKS, type CheckResult } from '../../src/plan/preparation';
import {
  computeReadiness,
  readinessLevel,
  type ReadinessInput,
} from '../../src/plan/readiness';

function checks(done: string[]): Map<string, CheckResult> {
  return new Map(
    CHECKS.map(definition => [
      definition.id,
      { definition, done: done.includes(definition.id), detail: null },
    ]),
  );
}

const lamp = {
  name: 'Lampe frontale',
  category: 'energy',
  subtype: 'lighting',
  usableQuantity: 2,
  bagId: null,
  attributes: {},
} as unknown as ItemSummary;

function input(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    items: [],
    members: 2,
    waterDays: 0,
    foodDays: 0,
    checks: checks([]),
    documentCount: 0,
    plan: emptyPlan(),
    bags: [],
    ...overrides,
  };
}

describe('indice de préparation', () => {
  it('vaut 0 sans rien et propose d’abord l’eau', () => {
    const r = computeReadiness(input());
    expect(r.score).toBe(0);
    expect(r.level).toBe('À construire');
    expect(r.next[0].id).toBe('water');
    expect(r.next[0].action).toEqual({ kind: 'add', category: 'water' });
    expect(r.criteria.reduce((s, c) => s + c.max, 0)).toBe(100);
  });

  it('donne des points proportionnels et explique chaque critère', () => {
    const plan = emptyPlan();
    plan.contacts = [
      { name: 'Paul', phone: '0600000000', relation: 'frère', outOfArea: true },
    ];
    plan.meetingNear = { place: 'École', position: '' };
    const r = computeReadiness(
      input({
        items: [lamp],
        waterDays: 1,
        foodDays: 10,
        checks: checks(['radio', 'batteries', 'firstaid']),
        documentCount: 3,
        plan,
        bags: [{ itemCount: 0 } as BagSummary],
      }),
    );
    const by = new Map(r.criteria.map(c => [c.id, c]));
    expect(by.get('water')?.points).toBe(7); // 20 × 1/3
    expect(by.get('food')?.points).toBe(15);
    expect(by.get('light')?.reason).toBe('2 lampes en état pour 2 personnes');
    expect(by.get('light')?.points).toBe(10);
    expect(by.get('energy')?.points).toBe(5);
    expect(by.get('energy')?.todo).toBe('Une batterie externe chargée');
    expect(by.get('energy')?.action).toMatchObject({
      kind: 'add',
      category: 'power',
    });
    expect(by.get('health')?.points).toBe(6);
    expect(by.get('documents')?.reason).toBe(
      '3 documents dans le dossier chiffré',
    );
    expect(by.get('plan')?.points).toBe(7);
    expect(by.get('plan')?.todo).toBe(
      'Définir le moyen de contact principal (PACE)',
    );
    expect(by.get('bag')?.reason).toBe('Sac créé mais vide');
    expect(r.score).toBe(7 + 15 + 10 + 10 + 5 + 6 + 10 + 7 + 2);
    // Le plus de points à gagner d'abord : l'eau (13).
    expect(r.next.map(c => c.id)[0]).toBe('water');
  });

  it('nomme les paliers', () => {
    expect([10, 40, 70, 90].map(readinessLevel)).toEqual([
      'À construire',
      'En progrès',
      'Solide',
      'Très bien préparé',
    ]);
  });
});
