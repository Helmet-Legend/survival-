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
  return (state: AppStateStatus) => act(() => handlers.forEach(h => h(state)));
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

    await fireEvent.press(screen.getByRole('tab', { name: 'Stock' }));
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
    await fireEvent.press(await screen.findByText('Verrouiller'));
    expect(await screen.findByText('Saisissez votre code')).toBeTruthy();
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
    await fireEvent.press(screen.getByLabelText('Ajouter une personne'));
    expect(await screen.findByLabelText('5 jours')).toBeTruthy(); // 30 L / (2 × 3 L)
    expect(screen.getByText('2 pers.')).toBeTruthy();
  });

  it('affiche l’état et la liste de réapprovisionnement', async () => {
    await openApp();
    // 10 jours d'eau pour un objectif de 14 : 12 L à racheter, vivres suffisants.
    expect(screen.getByText('Sous l’objectif')).toBeTruthy();
    expect(screen.getByText('À racheter pour 14 j')).toBeTruthy();
    expect(screen.getByText('+12 L')).toBeTruthy();
    expect(screen.queryByText(/^\+.*kcal$/)).toBeNull();

    await fireEvent.press(screen.getByLabelText('Augmenter l’objectif'));
    expect(await screen.findByText('À racheter pour 30 j')).toBeTruthy();
    expect(screen.getByText('+60 L')).toBeTruthy(); // 30 × 3 − 30
    expect(screen.getByText('+24 000 kcal')).toBeTruthy(); // 60 000 − 36 000
  });

  it('ajoute un article sous son stock minimal à la liste de rachat', async () => {
    await openApp();
    await fireEvent.press(screen.getByRole('tab', { name: 'Stock' }));
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

    await fireEvent.press(screen.getByRole('tab', { name: 'Autonomie' }));
    expect(await screen.findByText('+5 kg')).toBeTruthy();
  });

  it('consomme du stock et affiche le résultat', async () => {
    await openApp();
    await fireEvent.press(screen.getByRole('tab', { name: 'Stock' }));
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
    await fireEvent.press(screen.getByRole('tab', { name: 'Stock' }));
    await fireEvent.press(await screen.findByText('+ Ajouter un article'));
    await fireEvent.changeText(
      screen.getByLabelText('Nom'),
      'Flocons d’avoine',
    );
    await fireEvent.changeText(screen.getByLabelText('Quantité'), '2');
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
    await fireEvent.press(screen.getByRole('tab', { name: 'Coordonnées' }));
    await fireEvent.changeText(screen.getByLabelText('Latitude'), '45,83265');
    await fireEvent.changeText(screen.getByLabelText('Longitude'), '6.86518');
    expect(await screen.findByText('32T LR 34199 77670')).toBeTruthy();

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

    await fireEvent.changeText(screen.getByLabelText('Latitude'), '85');
    expect(await screen.findByText(/Zone polaire/)).toBeTruthy();
  });

  it('cherche dans les fiches sans tenir compte des accents', async () => {
    await openApp();
    await fireEvent.press(screen.getByRole('tab', { name: 'Fiches' }));
    await fireEvent.changeText(
      await screen.findByLabelText('Rechercher'),
      'severe',
    );
    await fireEvent.press(await screen.findByText('Hypothermie'));
    expect(await screen.findByText('← Toutes les fiches')).toBeTruthy();
    expect(
      screen.getByText(
        'Mettre la victime à l’abri du vent et l’isoler du sol.',
      ),
    ).toBeTruthy();
  });
});
