// Le script de génération est un module ES lancé par Node à la compilation.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function loadBuildTable(): (
  cis: string,
  cip: string,
) => Record<string, string> {
  const source = readFileSync(
    join(__dirname, '../../scripts/build-medicines.mjs'),
    'utf8',
  );
  const start = source.indexOf('export function buildTable');
  const end = source.indexOf('\nasync function main');
  const body = source
    .slice(start, end)
    .replace('export function buildTable', 'function buildTable');
  const clean = source.slice(
    source.indexOf('function clean'),
    source.indexOf('/**', source.indexOf('function clean')),
  );
  // eslint-disable-next-line no-new-func
  return new Function(`${clean}\n${body}\nreturn buildTable;`)();
}

describe('génération de la base des médicaments', () => {
  it('associe chaque CIP 13 à sa dénomination et sa présentation', () => {
    const cis = [
      '60234100\tDOLIPRANE 1000 mg, comprimé\tcomprimé\torale\tAutorisation active',
      '61111111\tSANS PRÉSENTATION\tgélule\torale\tAutorisation active',
    ].join('\r\n');
    const cip = [
      '60234100\t3400930000\tplaquette(s) PVC de 8 comprimé(s)\tPrésentation active\tDéclaration de commercialisation\t01/01/2000\t3400930000007\toui\t65%',
      '99999999\t1\tinconnu\tx\tx\tx\t3400999999999',
      '60234100\t1\tmauvais code\tx\tx\tx\t123',
    ].join('\n');
    const build = loadBuildTable();
    expect(build(cis, cip)).toEqual({
      '3400930000007':
        'DOLIPRANE 1000 mg, comprimé — plaquette(s) PVC de 8 comprimé(s)',
    });
  });
});
