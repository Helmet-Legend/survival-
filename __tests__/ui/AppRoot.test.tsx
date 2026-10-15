/**
 * Tests d'intégration de l'interface : l'application complète est rendue
 * sur le vrai moteur SQLite (node:sqlite) ; seuls les modules natifs
 * (SQLCipher, Keychain, Argon2 natif) sont simulés.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { BUNDLED_GUIDES } from '../../src/content/guides';
import { VaultKeyManager } from '../../src/crypto/VaultKeyManager';
import { InventoryRepository, seedDecoyInventory } from '../../src/inventory';
import { addDays, localToday } from '../../src/lib/dates';
import { whileAway, type PhotoSource } from '../../src/photo/photoSource';
import { AppRoot } from '../../src/ui/AppRoot';
import { createVault, type VaultContent } from '../../src/vault';
import {
  JsArgon2,
  MemoryStore,
  SeededRandom,
  TEST_ARGON2_PARAMS,
} from '../crypto/fakes';
import { SqliteFakeDriver, type SqliteVaultDb } from '../db/sqlite';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const MASTER = '482915';
const DURESS = '730264';

const content: VaultContent = {
  guides: BUNDLED_GUIDES,
  seedDecoy: db => seedDecoyInventory(db, { random: new SeededRandom(3) }),
};

function makeManager() {
  const store = new MemoryStore();
  const manager = new VaultKeyManager<SqliteVaultDb>({
    argon2: new JsArgon2(),
    random: new SeededRandom(11),
    store,
    driver: new SqliteFakeDriver(),
    argon2Params: TEST_ARGON2_PARAMS,
  });
  return { manager, store };
}

/** Coffre existant avec un petit inventaire réel. */
async function existingVault() {
  const ctx = makeManager();
  const db = await createVault(ctx.manager, content, {
    masterPin: MASTER,
    duressPin: DURESS,
  });
  const repo = new InventoryRepository(db);
  await repo.createItem(
    { name: 'Eau en bidons', category: 'water', unit: 'L', isCritical: true },
    { quantity: 30 },
  );
  await repo.createItem(
    { name: 'Riz', category: 'food', unit: 'kg', caloriesPerUnit: 3600 },
    { quantity: 10 }, // 36 000 kcal : 18 jours, l'eau reste limitante
  );
  db.close();
  return ctx;
}

async function typePin(pin: string) {
  for (const digit of pin) {
    await fireEvent.press(screen.getByLabelText(`Chiffre ${digit}`));
  }
  await fireEvent.press(screen.getByLabelText('Valider'));
}

async function unlockWith(pin: string) {
  await screen.findByText('Saisissez votre code');
  await typePin(pin);
}

/** Capture le gestionnaire AppState enregistré par l'application. */
function captureAppState() {
  const handlers: Array<(state: AppStateStatus) => void> = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, handler) => {
    handlers.push(handler as (state: AppStateStatus) => void);
    return { remove: jest.fn() } as never;
  });
  const emit = (state: AppStateStatus) =>
    act(() => handlers.forEach(h => h(state)));
  /** Sans act(), pour un appel déjà englobé (ex. pendant un fireEvent). */
  emit.raw = (state: AppStateStatus) => handlers.forEach(h => h(state));
  return emit;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('premier lancement', () => {
  it('crée le coffre avec code maître et code de contrainte', async () => {
    const { manager } = makeManager();
    await render(<AppRoot manager={manager} content={content} />);

    await fireEvent.press(await screen.findByText('Choisir mon code'));
    await typePin(MASTER);
    expect(screen.getByText('Saisissez à nouveau le code maître')).toBeTruthy();
    await typePin(MASTER);
    await fireEvent.press(
      await screen.findByText('Définir un code de contrainte'),
    );
    await typePin(DURESS);
    await typePin(DURESS);

    expect(await screen.findByText('Autonomie du foyer')).toBeTruthy();
    expect((await manager.getStatus()).kind).toBe('ready');
  });

  it('permet de réessayer si la création du coffre échoue', async () => {
    const { manager } = makeManager();
    let failures = 1;
    const flaky: VaultContent = {
      ...content,
      seedDecoy: async db => {
        if (failures-- > 0) {
          throw new Error('Échec simulé');
        }
        await content.seedDecoy?.(db);
      },
    };
    await render(<AppRoot manager={manager} content={flaky} />);
    await fireEvent.press(await screen.findByText('Choisir mon code'));
    await typePin(MASTER);
    await typePin(MASTER);
    await fireEvent.press(
      await screen.findByText('Définir un code de contrainte'),
    );
    await typePin(DURESS);
    await typePin(DURESS);
    expect(await screen.findByText('Échec simulé')).toBeTruthy();
    expect((await manager.getStatus()).kind).toBe('uninitialized');

    await fireEvent.press(screen.getByText('Définir un code de contrainte'));
    await typePin(DURESS);
    await typePin(DURESS);
    expect(await screen.findByText('Autonomie du foyer')).toBeTruthy();
    expect((await manager.getStatus()).kind).toBe('ready');
  });

  it('recommence si la confirmation diffère', async () => {
    const { manager } = makeManager();
    await render(<AppRoot manager={manager} content={content} />);
    await fireEvent.press(await screen.findByText('Choisir mon code'));
    await typePin(MASTER);
    await typePin('999999');
    expect(
      screen.getByText('Les deux saisies ne correspondent pas. Recommencez.'),
    ).toBeTruthy();
    expect(
      screen.getByText('Choisissez votre code maître (6 chiffres ou plus)'),
    ).toBeTruthy();
  });

  it('refuse un code trop court', async () => {
    const { manager } = makeManager();
    await render(<AppRoot manager={manager} content={content} />);
    await fireEvent.press(await screen.findByText('Choisir mon code'));
    await typePin('1234');
    expect(
      screen.getByText('Le code doit contenir au moins 6 caractères'),
    ).toBeTruthy();
  });

  it('permet de remettre le code de contrainte à plus tard', async () => {
    const { manager } = makeManager();
    await render(<AppRoot manager={manager} content={content} />);
    await fireEvent.press(await screen.findByText('Choisir mon code'));
    await typePin(MASTER);
    await typePin(MASTER);
    await fireEvent.press(await screen.findByText('Plus tard'));
    expect(await screen.findByText('Autonomie du foyer')).toBeTruthy();
  });
});

describe('déverrouillage', () => {
  it('ouvre le vrai coffre avec le code maître', async () => {
    const { manager } = await existingVault();
    await render(<AppRoot manager={manager} content={content} />);
    await unlockWith(MASTER);

    expect(await screen.findByText('Autonomie du foyer')).toBeTruthy();
    // 30 L pour 1 personne à 3 L/j.
    expect(screen.getByLabelText('10 jours')).toBeTruthy();
  });

  it('ouvre le leurre avec le code de contrainte, sans différence visible', async () => {
    const { manager } = await existingVault();
    await render(<AppRoot manager={manager} content={content} />);
    await unlockWith(DURESS);
    await screen.findByText('Autonomie du foyer');

    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Eau' }));
    expect(await screen.findByText('Eau minérale')).toBeTruthy();
    expect(screen.queryByText('Eau en bidons')).toBeNull();
    expect(screen.queryByText(/contrainte|leurre/i)).toBeNull();
  });

  it('refuse un faux code puis bloque après cinq essais', async () => {
    const { manager } = await existingVault();
    await render(<AppRoot manager={manager} content={content} />);
    await unlockWith('111112');
    expect(await screen.findByText('Code incorrect')).toBeTruthy();

    for (let i = 0; i < 4; i++) {
      await typePin('111112');
    }
    expect(
      await screen.findByText(/Trop d’essais\. Réessayez dans \d+ s\./),
    ).toBeTruthy();
    expect(screen.getByLabelText('Chiffre 4')).toBeDisabled();
  });

  it('reprend un blocage en cours au démarrage', async () => {
    const { manager } = await existingVault();
    for (let i = 0; i < 5; i++) {
      await manager.unlock('111112').catch(() => undefined);
    }
    await render(<AppRoot manager={manager} content={content} />);
    expect(await screen.findByText(/Trop d’essais/)).toBeTruthy();
  });
});

describe('cycle de vie', () => {
  it('verrouille quand l’application passe en arrière-plan', async () => {
    const emit = captureAppState();
    const { manager } = await existingVault();
    await render(<AppRoot manager={manager} content={content} />);
    await unlockWith(MASTER);
    await screen.findByText('Autonomie du foyer');

    await emit('inactive');
    expect(screen.getByTestId('privacy-cover')).toBeTruthy();

    await emit('background');
    await emit('active');
    expect(
      await screen.findByText(
        'Coffre verrouillé à la sortie de l’application.',
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId('privacy-cover')).toBeNull();
  });

  it('verrouille sur demande', async () => {
    const { manager } = await existingVault();
    await render(<AppRoot manager={manager} content={content} />);
    await unlockWith(MASTER);
    await fireEvent.press(await screen.findByLabelText('Verrouiller'));
    expect(await screen.findByText('Saisissez votre code')).toBeTruthy();
  });

  it('autorise les captures d’écran depuis les réglages', async () => {
    const ctx = await existingVault();
    let allowed = false;
    await render(
      <AppRoot
        manager={ctx.manager}
        content={content}
        screenCapture={{
          available: true,
          isAllowed: async () => allowed,
          setAllowed: async value => {
            allowed = value;
          },
        }}
      />,
    );
    await unlockWith(MASTER);
    await fireEvent.press(await screen.findByLabelText('Réglages'));
    const toggle = await screen.findByLabelText(
      'Autoriser les captures d’écran',
    );
    expect(toggle.props.value).toBe(false);
    expect(screen.getByText(/l’écran apparaît noir/)).toBeTruthy();

    await fireEvent(toggle, 'valueChange', true);
    expect(allowed).toBe(true);
    expect(await screen.findByText(/Captures autorisées/)).toBeTruthy();
  });

  it('masque le réglage des captures hors Android', async () => {
    const { manager } = await existingVault();
    await render(<AppRoot manager={manager} content={content} />);
    await unlockWith(MASTER);
    await fireEvent.press(await screen.findByLabelText('Réglages'));
    await screen.findByText('Verrouiller maintenant');
    expect(
      screen.queryByLabelText('Autoriser les captures d’écran'),
    ).toBeNull();
  });

  it('propose d’effacer un coffre illisible', async () => {
    const { manager, store } = await existingVault();
    store.value = '{corrompu';
    await render(<AppRoot manager={manager} content={content} />);
    expect(
      await screen.findByText('Le coffre ne peut pas être ouvert'),
    ).toBeTruthy();

    await fireEvent.press(screen.getByText('Effacer le coffre…'));
    await fireEvent.press(screen.getByText('Effacer et recommencer'));
    expect(await screen.findByText('Créer votre coffre')).toBeTruthy();
  });
});

describe('écrans', () => {
  async function openApp() {
    const ctx = await existingVault();
    await render(<AppRoot manager={ctx.manager} content={content} />);
    await unlockWith(MASTER);
    await screen.findByText('Autonomie du foyer');
    return ctx;
  }

  it('recalcule l’autonomie quand le foyer change', async () => {
    await openApp();
    // Directement depuis l'accueil.
    await fireEvent.press(screen.getByLabelText('Ajouter une personne'));
    expect(await screen.findByLabelText('5 jours')).toBeTruthy(); // 30 L / (2 × 3 L)
    expect(screen.getByText('2 pers.')).toBeTruthy();

    // Et toujours depuis les réglages.
    await fireEvent.press(screen.getByLabelText('Réglages'));
    await fireEvent.press(await screen.findByLabelText('Retirer une personne'));
    expect(await screen.findByText('1 pers.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Accueil' }));
    expect(await screen.findByLabelText('10 jours')).toBeTruthy();
  });

  it('affiche l’état et la liste de réapprovisionnement', async () => {
    await openApp();
    // 10 jours d'eau pour un objectif de 14 : 12 L à racheter, vivres suffisants.
    expect(screen.getByText('Sous l’objectif')).toBeTruthy();
    expect(screen.getByText('Ressource limitante : eau')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Accéder aux plans d’action'));
    expect(await screen.findByText('À racheter pour 14 j')).toBeTruthy();
    expect(screen.getByText('+12 L')).toBeTruthy();
    expect(screen.queryByText(/^\+.*kcal$/)).toBeNull();

    await fireEvent.press(screen.getByLabelText('Augmenter l’objectif'));
    expect(await screen.findByText('À racheter pour 30 j')).toBeTruthy();
    expect(screen.getByText('+60 L')).toBeTruthy(); // 30 × 3 − 30
    expect(screen.getByText('+24 000 kcal')).toBeTruthy(); // 60 000 − 36 000
  });

  it('ajoute un article sous son stock minimal à la liste de rachat', async () => {
    await openApp();
    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Vivres' }),
    );
    await fireEvent.press(await screen.findByLabelText('Riz, 10 kg'));
    await fireEvent.changeText(
      await screen.findByLabelText('Stock minimal (kg)'),
      '15',
    );
    await fireEvent.changeText(
      screen.getByLabelText('Prévenir (jours avant)'),
      '0',
    );
    await fireEvent.press(screen.getByText('Enregistrer les réglages'));
    expect(
      await screen.findByText(
        "Le délai d'alerte doit être un nombre de jours entre 1 et 3650",
      ),
    ).toBeTruthy();

    await fireEvent.changeText(
      screen.getByLabelText('Prévenir (jours avant)'),
      '',
    );
    await fireEvent.press(screen.getByText('Enregistrer les réglages'));
    expect(
      await screen.findByText('Réglages de « Riz » enregistrés.'),
    ).toBeTruthy();
    expect(screen.getByText('Sous le minimum')).toBeTruthy();

    await fireEvent.press(screen.getByRole('tab', { name: 'Accueil' }));
    await fireEvent.press(
      await screen.findByLabelText('Accéder aux plans d’action'),
    );
    expect(await screen.findByText('+5 kg')).toBeTruthy();
  });

  it('consomme du stock et affiche le résultat', async () => {
    await openApp();
    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Eau' }));
    await fireEvent.press(await screen.findByLabelText('Eau en bidons, 30 L'));
    await fireEvent.changeText(
      await screen.findByLabelText('Quantité à retirer (L)'),
      '12',
    );
    await fireEvent.press(screen.getByText('Retirer'));
    expect(
      await screen.findByText('Retiré : 12 L du lot sans date. Reste 18 L.'),
    ).toBeTruthy();

    await fireEvent.changeText(
      screen.getByLabelText('Quantité à retirer (L)'),
      '50',
    );
    await fireEvent.press(screen.getByText('Retirer'));
    expect(
      await screen.findByText('Stock insuffisant : 18 disponible(s)'),
    ).toBeTruthy();
  });

  it('ajoute un article et signale le champ invalide', async () => {
    await openApp();
    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    await fireEvent.press(await screen.findByLabelText('+ Ajouter un article'));
    await fireEvent.changeText(
      screen.getByLabelText('Nom'),
      'Flocons d’avoine',
    );
    await fireEvent.changeText(screen.getByLabelText('Quantité (kg)'), '2');
    await fireEvent.changeText(
      screen.getByLabelText('À consommer avant le (AAAA-MM-JJ, facultatif)'),
      '2027-02-30',
    );
    await fireEvent.press(screen.getByText('Ajouter au stock'));
    expect(
      await screen.findByText('Date invalide (format AAAA-MM-JJ attendu)'),
    ).toBeTruthy();

    await fireEvent.changeText(
      screen.getByLabelText('À consommer avant le (AAAA-MM-JJ, facultatif)'),
      '2027-02-28',
    );
    await fireEvent.press(screen.getByText('Ajouter au stock'));
    expect(
      await screen.findByText('« Flocons d’avoine » ajouté au stock.'),
    ).toBeTruthy();
  });

  it('convertit une position en MGRS et calcule un cap', async () => {
    await openApp();
    await fireEvent.press(screen.getByRole('tab', { name: 'Carte' }));
    await fireEvent.changeText(screen.getByLabelText('Latitude'), '45,83265');
    await fireEvent.changeText(screen.getByLabelText('Longitude'), '6.86518');
    expect(await screen.findByText('32T LR 34199 77670')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Azimut' }));
    await fireEvent.changeText(
      screen.getByLabelText('Point d’arrivée (MGRS)'),
      '32T LR 34500 87800',
    );
    expect(await screen.findByText('déclinaison requise')).toBeTruthy();
    await fireEvent.changeText(
      screen.getByLabelText('Déclinaison magnétique (° Est, lue sur la carte)'),
      '2,5',
    );
    expect(screen.queryByText('déclinaison requise')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Coordonnées' }));
    await fireEvent.changeText(screen.getByLabelText('Latitude'), '85');
    expect(await screen.findByText(/Zone polaire/)).toBeTruthy();
  });

  it('affiche les vraies quantités sur l’accueil, les stocks et les guides', async () => {
    await openApp();
    expect(
      screen.getByLabelText('Eau disponible : 30 L, 10 j d’autonomie'),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        'Réserves alimentaires : 36 000 kcal, 18 j d’autonomie',
      ),
    ).toBeTruthy();

    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    expect(await screen.findByLabelText('Eau : 30 L, 1 article')).toBeTruthy();
    expect(
      screen.getByLabelText('Vivres : 36 000 kcal, 1 article'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Outils : 0 article')).toBeTruthy();
    expect(
      screen.getByLabelText(
        'Armes et munitions : 0 munition, 0 arme, 0 article',
      ),
    ).toBeTruthy();

    await fireEvent.press(screen.getByRole('tab', { name: 'Guides' }));
    const firstAid = BUNDLED_GUIDES.filter(
      g => g.category === 'Secourisme',
    ).length;
    await fireEvent.press(
      await screen.findByLabelText(`Secourisme, ${firstAid} fiches`),
    );
    expect(await screen.findByText('Hypothermie')).toBeTruthy();
    expect(screen.queryByText('Rendre l’eau potable')).toBeNull();
  });

  it('saisit l’eau en bidons et la retire bidon par bidon', async () => {
    await openApp();
    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Eau' }));
    await fireEvent.press(screen.getByLabelText('+ Ajouter un article'));
    await fireEvent.changeText(screen.getByLabelText('Nom'), 'Bidons garage');
    await fireEvent.changeText(
      screen.getByLabelText('Contenance d’un bidon (L)'),
      '10',
    );
    await fireEvent.changeText(screen.getByLabelText('Nombre de bidons'), '3');
    expect(screen.getByText('= 30 L')).toBeTruthy();
    await fireEvent.press(screen.getByText('Ajouter au stock'));
    expect(
      await screen.findByText('« Bidons garage » ajouté au stock.'),
    ).toBeTruthy();
    expect(screen.getByText('3 bidons de 10 L')).toBeTruthy();

    await fireEvent.press(screen.getByText('Retirer 1 bidon (10 L)'));
    expect(
      await screen.findByText('Retiré : 10 L du lot sans date. Reste 20 L.'),
    ).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Nombre de bidons'), '2');
    await fireEvent.press(screen.getByText('Ajouter au stock existant'));
    expect(
      await screen.findByText('Stock de « Bidons garage » complété.'),
    ).toBeTruthy();
    expect(screen.getByText('4 bidons de 10 L')).toBeTruthy();
  });

  it('enregistre une arme et compte ses munitions par calibre', async () => {
    await openApp();
    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Armes et munitions' }),
    );
    expect(await screen.findByText(/Aucune arme enregistrée/)).toBeTruthy();

    await fireEvent.press(screen.getByText('Ajouter une arme'));
    await fireEvent.press(screen.getByText('Ajouter l’arme'));
    expect(await screen.findAllByText('Champ obligatoire')).toBeTruthy();

    await fireEvent.changeText(
      screen.getByLabelText('Marque et modèle'),
      'Browning B525',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Fusil' }));
    await fireEvent.changeText(screen.getByLabelText('Calibre'), '12/70');
    await fireEvent.changeText(
      screen.getByLabelText('N° de série (facultatif)'),
      'AB1234',
    );
    await fireEvent.press(screen.getByText('Ajouter l’arme'));
    expect(await screen.findByText('« Browning B525 » ajoutée.')).toBeTruthy();
    expect(screen.getByText('Aucune munition')).toBeTruthy();

    // Munitions : article en pièces au même calibre, saisi autrement.
    await fireEvent.press(screen.getByLabelText('+ Ajouter un article'));
    await fireEvent.changeText(
      screen.getByLabelText('Nom'),
      'Cartouches plomb 7',
    );
    await fireEvent.changeText(
      screen.getByLabelText('Calibre des munitions'),
      '12 / 70',
    );
    await fireEvent.changeText(
      screen.getByLabelText('Quantité (cartouches)'),
      '250',
    );
    await fireEvent.press(screen.getByText('Ajouter au stock'));
    expect(
      await screen.findByText('« Cartouches plomb 7 » ajouté au stock.'),
    ).toBeTruthy();
    expect(
      await screen.findByLabelText('Browning B525, 12/70, 250 munitions'),
    ).toBeTruthy();

    await fireEvent.press(
      screen.getByLabelText('Browning B525, 12/70, 250 munitions'),
    );
    expect(await screen.findByText('N° de série : AB1234')).toBeTruthy();
  });

  it('cherche dans les fiches sans tenir compte des accents', async () => {
    await openApp();
    await fireEvent.press(screen.getByRole('tab', { name: 'Guides' }));
    await fireEvent.changeText(
      await screen.findByLabelText('Rechercher un guide'),
      'severe',
    );
    await fireEvent.press(await screen.findByText('Hypothermie'));
    expect(await screen.findByText('Toutes les fiches')).toBeTruthy();
    expect(
      screen.getByText(
        'Mettre la victime à l’abri du vent et l’isoler du sol.',
      ),
    ).toBeTruthy();
  });
});

describe('photos et documents', () => {
  const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL';

  async function openWithCamera(photoSource: PhotoSource) {
    const ctx = await existingVault();
    await render(
      <AppRoot
        manager={ctx.manager}
        content={content}
        photoSource={photoSource}
      />,
    );
    await unlockWith(MASTER);
    await screen.findByText('Autonomie du foyer');
  }

  async function addGlock() {
    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Armes et munitions' }),
    );
    await fireEvent.press(await screen.findByText('Ajouter une arme'));
    await fireEvent.changeText(
      screen.getByLabelText('Marque et modèle'),
      'Glock 17',
    );
    await fireEvent.changeText(screen.getByLabelText('Calibre'), '9x19');
    await fireEvent.press(screen.getByText('Ajouter l’arme'));
    await fireEvent.press(
      await screen.findByLabelText('Glock 17, 9x19, 0 munition'),
    );
  }

  it('photographie une arme, affiche et supprime la photo', async () => {
    await openWithCamera({
      available: true,
      take: async () => JPEG,
      pick: async () => null,
    });
    await addGlock();
    expect(await screen.findByText(/Aucune photo/)).toBeTruthy();

    await fireEvent.press(screen.getByText('Photographier'));
    const thumb = await screen.findByLabelText('Photo 1 de Glock 17');
    // Galerie annulée : rien n'est ajouté.
    await fireEvent.press(
      screen.getByLabelText('Choisir une image dans la galerie'),
    );
    expect(screen.queryByLabelText('Photo 2 de Glock 17')).toBeNull();

    await fireEvent.press(thumb);
    await fireEvent.press(await screen.findByText('Supprimer la photo'));
    await fireEvent.press(await screen.findByText('Supprimer'));
    expect(await screen.findByText(/Aucune photo/)).toBeTruthy();
  });

  it('ne verrouille pas le coffre pendant la prise de photo', async () => {
    const emit = captureAppState();
    await openWithCamera({
      available: true,
      // L'appareil photo passe l'application en arrière-plan.
      take: () =>
        whileAway(async () => {
          emit.raw('background');
          emit.raw('active');
          return JPEG;
        }),
      pick: async () => null,
    });
    await addGlock();
    await fireEvent.press(screen.getByText('Photographier'));
    expect(await screen.findByLabelText('Photo 1 de Glock 17')).toBeTruthy();
    expect(screen.queryByText('Saisissez votre code')).toBeNull();

    // Hors photo, le verrouillage reste immédiat.
    await emit('background');
    await emit('active');
    expect(await screen.findByText('Saisissez votre code')).toBeTruthy();
  });

  it('enregistre un document et signale son renouvellement', async () => {
    await openWithCamera({
      available: true,
      take: async () => JPEG,
      pick: async () => null,
    });
    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    await fireEvent.press(
      await screen.findByLabelText('Documents : 0 document'),
    );
    await fireEvent.press(await screen.findByText('Ajouter un document'));
    await fireEvent.press(screen.getByRole('button', { name: 'Passeport' }));
    await fireEvent.changeText(
      screen.getByLabelText('Titulaire (facultatif)'),
      'Camille Martin',
    );
    await fireEvent.changeText(
      screen.getByLabelText('Numéro (facultatif)'),
      '18AB12345',
    );
    await fireEvent.changeText(
      screen.getByLabelText('Date d’expiration (AAAA-MM-JJ, facultatif)'),
      '2027-02-30',
    );
    await fireEvent.press(screen.getByText('Ajouter le document'));
    expect(
      await screen.findByText('Date invalide (format AAAA-MM-JJ attendu)'),
    ).toBeTruthy();

    await fireEvent.changeText(
      screen.getByLabelText('Date d’expiration (AAAA-MM-JJ, facultatif)'),
      addDays(localToday(), 30),
    );
    await fireEvent.press(screen.getByText('Ajouter le document'));
    expect(
      await screen.findByText(
        '« Passeport » ajouté. Vous pouvez maintenant le photographier.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByLabelText('Passeport, Passeport, À renouveler'),
    ).toBeTruthy();
    expect(screen.getByText('N° : 18AB12345')).toBeTruthy();
    await fireEvent.press(screen.getByText('Photographier'));
    expect(await screen.findByLabelText('Photo 1 de Passeport')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Tous' }));
    expect(
      await screen.findByLabelText('Documents : 1 document, 1 à renouveler'),
    ).toBeTruthy();
  });
});

describe('fiches par type de produit', () => {
  async function openStocks(category: string) {
    const ctx = await existingVault();
    await render(<AppRoot manager={ctx.manager} content={content} />);
    await unlockWith(MASTER);
    await screen.findByText('Autonomie du foyer');
    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    await fireEvent.press(
      await screen.findByRole('button', { name: category }),
    );
    await fireEvent.press(screen.getByLabelText('+ Ajouter un article'));
  }

  it('estime les kcal d’un aliment d’après son nom', async () => {
    await openStocks('Vivres');
    expect(screen.getByText('Nouvel aliment')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Nom'), 'Riz basmati');
    expect(
      screen.getByText(
        'Sans saisie, estimation d’après « riz » : 3 550 kcal par kg.',
      ),
    ).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Épicerie sèche' }),
    );
    await fireEvent.changeText(screen.getByLabelText('Quantité (kg)'), '2');
    await fireEvent.changeText(
      screen.getByLabelText('Emplacement (facultatif)'),
      'Cellier',
    );
    await fireEvent.press(screen.getByText('Ajouter au stock'));
    expect(
      await screen.findByText('« Riz basmati » ajouté au stock.'),
    ).toBeTruthy();
    expect(screen.getByText('≈ 3 550 kcal par kg (estimé : riz)')).toBeTruthy();
    expect(screen.getByText('Épicerie sèche')).toBeTruthy();
    expect(screen.getByText('Cellier')).toBeTruthy();
  });

  it('propose une fiche santé avec péremption et posologie', async () => {
    await openStocks('Santé');
    expect(screen.getByText('Nouveau produit de santé')).toBeTruthy();
    await fireEvent.changeText(
      screen.getByLabelText('Nom'),
      'Paracétamol 500 mg',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Médicament' }));
    await fireEvent.changeText(
      screen.getByLabelText('Quantité (pièce(s))'),
      '16',
    );
    await fireEvent.changeText(
      screen.getByLabelText('Date de péremption (AAAA-MM-JJ, facultatif)'),
      '2028-03-31',
    );
    await fireEvent.changeText(
      screen.getByLabelText('Posologie, indication (facultatif)'),
      '1 comprimé toutes les 6 h',
    );
    await fireEvent.press(screen.getByText('Ajouter au stock'));
    expect(
      await screen.findByText('« Paracétamol 500 mg » ajouté au stock.'),
    ).toBeTruthy();
    expect(screen.getByText('1 comprimé toutes les 6 h')).toBeTruthy();
    expect(screen.queryByText(/Calories/)).toBeNull();
  });

  it('propose une date de renouvellement pour l’eau du robinet', async () => {
    await openStocks('Eau');
    expect(screen.getByText('Nouvelle réserve d’eau')).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Eau du robinet stockée' }),
    );
    expect(
      screen.getByLabelText('À renouveler avant le (AAAA-MM-JJ, facultatif)')
        .props.value,
    ).toBe(addDays(localToday(), 182));
  });

  it('ne demande pas de date pour les munitions', async () => {
    await openStocks('Armes et munitions');
    expect(screen.getByText('Nouvelles munitions')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Cartouches à plomb' }),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/avant le|péremption/)).toBeNull();
    expect(screen.getByLabelText('Charge, marque (facultatif)')).toBeTruthy();
  });
});

describe('accueil sans vivres', () => {
  it('explique que les vivres manquent au lieu d’une date d’épuisement', async () => {
    const ctx = makeManager();
    const db = await createVault(ctx.manager, content, { masterPin: MASTER });
    await new InventoryRepository(db).createItem(
      { name: 'Eau', category: 'water', unit: 'L' },
      { quantity: 30 },
    );
    db.close();
    await render(<AppRoot manager={ctx.manager} content={content} />);
    await unlockWith(MASTER);
    expect(await screen.findByText('Aucun vivre compté')).toBeTruthy();
    expect(
      screen.getByText(
        'Ajoutez vos vivres dans Stocks › Vivres. L’eau seule couvre 10 j.',
      ),
    ).toBeTruthy();
    await fireEvent.press(
      screen.getByLabelText('Aucun vivre compté. Ajouter des vivres'),
    );
    expect(await screen.findByLabelText('Rechercher un article')).toBeTruthy();
  });
});
