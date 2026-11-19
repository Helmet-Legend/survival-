import {
  describeOffset,
  displayedHeading,
  headingOffset,
  normalizeHeading,
} from '../../src/geo/heading';

describe('boussole', () => {
  it('ramène le cap dans [0, 360[', () => {
    expect(normalizeHeading(360)).toBe(0);
    expect(normalizeHeading(-10)).toBe(350);
    expect(normalizeHeading(725)).toBe(5);
  });

  it('donne l’écart le plus court, signé', () => {
    expect(headingOffset(90, 80)).toBe(10);
    expect(headingOffset(80, 90)).toBe(-10);
    // Autour du nord : 350° → 10°, 20° à droite, pas 340° à gauche.
    expect(headingOffset(10, 350)).toBe(20);
    expect(headingOffset(350, 10)).toBe(-20);
    expect(headingOffset(180, 0)).toBe(180);
  });

  it('décrit l’écart', () => {
    expect(describeOffset(3)).toBe('Dans l’axe');
    expect(describeOffset(-5)).toBe('Dans l’axe');
    expect(describeOffset(12.4)).toBe('Tournez de 12° à droite');
    expect(describeOffset(-40)).toBe('Tournez de 40° à gauche');
  });

  it('passe au nord géographique avec la déclinaison', () => {
    expect(displayedHeading(358, 3, 'true')).toBe(1);
    expect(displayedHeading(10, -2.5, 'true')).toBe(7.5);
    expect(displayedHeading(10, 3, 'magnetic')).toBe(10);
    // Déclinaison inconnue : le cap magnétique reste affiché.
    expect(displayedHeading(10, null, 'true')).toBe(10);
  });
});
