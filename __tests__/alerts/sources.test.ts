import { parseDepartments } from '../../src/alerts/departments';
import { parseMedicineDispo } from '../../src/alerts/medicines';
import { parseMeteo } from '../../src/alerts/meteo';
import { parseQuakes } from '../../src/alerts/quakes';
import { canonicalGtin, parseRecalls } from '../../src/alerts/recalls';
import { parseFuel, parseGas, parseWater } from '../../src/alerts/supply';
import { setMedicineTable } from '../../src/scanner/medicines';

const NOW = new Date('2026-10-20T19:30:00Z');

/** Extrait du flux MeteoAlarm France (structure réelle, relevée le 20/10/2026). */
function warning(
  level: string,
  type: string,
  areas: string[],
  expires = '2026-10-21T22:00:00+00:00',
) {
  return {
    alert: {
      identifier: '2.49.0.0.250.0.FR.x',
      info: [
        {
          language: 'en-GB',
          event: 'Moderate flooding warning',
          parameter: [
            { value: level, valueName: 'awareness_level' },
            { value: type, valueName: 'awareness_type' },
          ],
          area: areas.map(areaDesc => ({ areaDesc })),
          expires,
        },
        {
          language: 'fr-FR',
          event: 'Vigilance orange crues',
          description:
            'Une crue génératrice de débordements importants est prévue.',
          instruction: 'Évitez les abords des cours d’eau.',
          onset: '2026-10-20T22:00:00+02:00',
          expires,
          web: 'https://vigilance.meteofrance.fr/',
          parameter: [
            { value: level, valueName: 'awareness_level' },
            { value: type, valueName: 'awareness_type' },
          ],
          area: areas.map(areaDesc => ({ areaDesc })),
        },
      ],
    },
  };
}

describe('sources d’alertes', () => {
  it('lit les départements suivis', () => {
    expect(parseDepartments('13, 84 ; 2a 999 13 6')).toEqual([
      '13',
      '84',
      '2A',
      '06',
    ]);
  });

  it('garde les vigilances jaunes à rouges des départements suivis', () => {
    const feed = {
      warnings: [
        warning('3; orange; Severe', '12; flooding', [
          'Bouches-du-Rhône',
          'Var',
        ]),
        warning('2; yellow; Moderate', '12; flooding', ['Bouches-du-Rhône']),
        warning('1; green; Minor', '3; Thunderstorm', ['Bouches-du-Rhône']),
        warning('4; red; Extreme', '7; coastal event', ['Côtes-d’Armor']),
        // Expirée : ignorée.
        warning(
          '3; orange; Severe',
          '1; Wind',
          ['Bouches-du-Rhône'],
          '2026-10-20T10:00:00+00:00',
        ),
      ],
    };
    const alerts = parseMeteo(feed, ['13', '22'], NOW);
    expect(alerts.map(a => [a.title, a.where])).toEqual([
      ['Vigilance orange crues', 'Bouches-du-Rhône'],
      ['Vigilance rouge vagues-submersion', 'Côtes-d’Armor'],
    ]);
    expect(alerts[0].instruction).toBe('Évitez les abords des cours d’eau.');
    expect(parseMeteo(feed, [], NOW)).toEqual([]);
  });

  it('repère un produit rappelé dans le stock, sans les zéros de tête', () => {
    expect(canonicalGtin('0361240382116')).toBe(canonicalGtin(361240382116));
    const recalls = [
      {
        gtin: 3505870000343,
        numero_fiche: '2026-10-0204',
        libelle: 'boudin viande',
        marque_produit: 'sans marque',
        motif_rappel: 'détection de listeria monocytogènes',
        conduites_a_tenir_par_le_consommateur:
          'ne plus consommer|rapporter le produit au point de vente',
        identification_produits:
          '3505870000343$627814$date limite de consommation$2026-10-27$',
        lien_vers_la_fiche_rappel:
          'https://rappel.conso.gouv.fr/fiche-rappel/23876/interne',
        date_publication: '2026-10-20T18:14:58+00:00',
        date_de_fin_de_la_procedure_de_rappel: null,
      },
      // Procédure terminée : ignorée.
      {
        gtin: 3017620422003,
        numero_fiche: '2026-01-0001',
        date_de_fin_de_la_procedure_de_rappel: '2026-03-01',
      },
    ];
    const alerts = parseRecalls(
      recalls,
      [
        { code: '3505870000343', itemId: 'a', itemName: 'Boudin' },
        { code: '3017620422003', itemId: 'b', itemName: 'Pâte à tartiner' },
      ],
      '2026-10-20',
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      level: 'orange',
      where: 'Boudin',
      itemId: 'a',
      instruction:
        'Ne plus consommer ; rapporter le produit au point de vente.',
    });
    expect(alerts[0].detail).toContain('Lots concernés : 627814');
  });

  it('signale une rupture de médicament de la pharmacie du foyer', () => {
    setMedicineTable({
      generated: '2026-10-01',
      cip: { '3400930000007': 'DOLIPRANE', '3400930000014': 'AUTRE' },
      cis: { '3400930000007': '60234100', '3400930000014': '61111111' },
    });
    const dispo = [
      // CIP 13 vide : toute la spécialité.
      '60234100\t\t1\tRupture de stock\t23/09/2026\t05/10/2026\t\thttps://ansm.sante.fr/x',
      // Remise à disposition annoncée : ignorée.
      '61111111\t3400930000014\t2\tTension\t01/09/2026\t05/10/2026\t10/10/2026\thttps://ansm.sante.fr/y',
    ].join('\r\n');
    const alerts = parseMedicineDispo(dispo, [
      { code: '3400930000007', itemId: 'm', itemName: 'Doliprane' },
      { code: '3400930000014', itemId: 'n', itemName: 'Autre' },
      { code: '3017620422003', itemId: 'f', itemName: 'Pâte' },
    ]);
    expect(alerts.map(a => [a.title, a.where, a.start])).toEqual([
      ['Médicament en rupture de stock', 'Doliprane', '2026-09-23'],
    ]);
    setMedicineTable(null);
  });

  it('garde les séismes à moins de 150 km du domicile', () => {
    const feed = {
      features: [
        {
          properties: {
            lat: 44.4076,
            lon: 6.84,
            mag: 2.2,
            time: 'x',
            unid: 'near',
            flynn_region: 'FRANCE',
          },
        },
        {
          properties: {
            lat: 48.85,
            lon: 2.35,
            mag: 5.1,
            time: 'y',
            unid: 'far',
          },
        },
      ],
    };
    const home = { latitude: 44.0, longitude: 6.5 };
    const alerts = parseQuakes(feed, home);
    expect(alerts.map(a => a.id)).toEqual(['quake:near']);
    expect(alerts[0].title).toBe('Séisme de magnitude 2,2');
    expect(parseQuakes(feed, null)).toEqual([]);
  });

  it('lit restrictions d’eau, signal gaz et ruptures de carburant', () => {
    const water = parseWater(
      [
        { code: '13', niveauGraviteMax: 'crise' },
        { code: '84', niveauGraviteMax: null },
        { code: '05', niveauGraviteMax: 'alerte' },
      ],
      ['13', '84'],
    );
    expect(water.map(a => [a.title, a.level])).toEqual([
      ['Restrictions d’eau : crise', 'red'],
    ]);

    const gas = parseGas(
      {
        results: [
          { date: '2026-10-21', couleur_du_signal_fr: 'orange' },
          { date: '2026-10-20', couleur_du_signal_fr: 'vert' },
          { date: '2026-10-10', couleur_du_signal_fr: 'rouge' },
        ],
      },
      '2026-10-20',
    );
    expect(gas.map(a => [a.id, a.level])).toEqual([
      ['gas:2026-10-21', 'orange'],
    ]);

    const rupture = (type: string, debut: string) =>
      JSON.stringify([{ '@nom': 'Gazole', '@type': type, '@debut': debut }]);
    const stations = [
      { cp: '13001', rupture: rupture('temporaire', '2026-10-19 08:00:00') },
      { cp: '13002', rupture: rupture('temporaire', '2026-10-18 08:00:00') },
      { cp: '13003', rupture: rupture('definitive', '2026-10-19 08:00:00') },
      { cp: '13004', rupture: '' },
      { cp: '13005', rupture: rupture('temporaire', '2026-01-01 08:00:00') },
    ];
    const fuel = parseFuel(stations, '13', NOW);
    expect(fuel[0]).toMatchObject({
      level: 'orange',
      where: 'Bouches-du-Rhône',
    });
    expect(fuel[0].detail).toContain('2 stations sur 5');
    expect(parseFuel(stations.slice(2), '13', NOW)).toEqual([]);
  });
});
