import { BATTERY_STATE, batteryTone } from '../../src/device/battery';

describe('batterie du téléphone', () => {
  it('classe le niveau : faible sous 20 %, à recharger sous 50 %', () => {
    expect(batteryTone({ level: 85, charging: false })).toBe('ok');
    expect(batteryTone({ level: 50, charging: false })).toBe('ok');
    expect(batteryTone({ level: 49, charging: false })).toBe('medium');
    expect(batteryTone({ level: 20, charging: false })).toBe('medium');
    expect(batteryTone({ level: 19, charging: false })).toBe('low');
    expect(batteryTone({ level: 5, charging: true })).toBe('charging');
    expect(BATTERY_STATE.low).toBe('Faible : économisez la batterie');
  });
});
