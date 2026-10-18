/**
 * Tests d'intégration de l'interface : l'application complète est rendue
 * sur le vrai moteur SQLite (node:sqlite) ; seuls les modules natifs
 * (SQLCipher, Keychain, Argon2 natif) sont simulés.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import React from 'react';
import {
  AppState,
  Clipboard,
  Linking,
  Share,
  type AppStateStatus,
} from 'react-native';

import { BUNDLED_GUIDES, GUIDE_FOLDERS } from '../../src/content/guides';
import { VaultKeyManager } from '../../src/crypto/VaultKeyManager';
import {
  ArmoryRepository,
  InventoryRepository,
  seedDecoyInventory,
} from '../../src/inventory';
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

/** Ouvre la section « Plus de détails » d'une fiche, si elle est repliée. */
async function openDetails() {
  const more = screen.queryByLabelText('Plus de détails');
  if (more) {
    await fireEvent.press(more);
  }
}

/** Choisit une valeur d'un champ à choix (pastilles ou liste déroulante). */
async function pick(field: string, option: string) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const dropdown = screen.queryByLabelText(new RegExp(`^${escaped} : `));
  if (dropdown) {
    await fireEvent.press(dropdown);
    await fireEvent.press(await screen.findByRole('radio', { name: option }));
    return;
  }
  if (screen.queryByLabelText(field) === null) {
    await openDetails();
  }
  await fireEvent.press(
    within(screen.getByLabelText(field)).getByRole('radio', { name: option }),
  );
}

/** Choisit l'unité de la quantité. */
async function unit(option: string) {
  await pick('Unité (Quantité)', option);
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

  it('ouvre l’écran Urgence : appels, position GPS, SMS et fiches', async () => {
    const ctx = await existingVault();
    await render(
      <AppRoot
        manager={ctx.manager}
        content={content}
        location={{
          available: true,
          getPosition: async () => ({
            latitude: 45.83265,
            longitude: 6.86518,
            accuracy: 8,
            stale: false,
          }),
        }}
      />,
    );
    await unlockWith(MASTER);
    await fireEvent.press(
      await screen.findByLabelText('Ouvrir l’écran Urgence'),
    );
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);

    await fireEvent.press(
      screen.getByLabelText('Appeler le 112, Urgences (toute l’Europe)'),
    );
    expect(open).toHaveBeenCalledWith('tel:112');

    await fireEvent.press(screen.getByText('Localiser (GPS)'));
    expect(await screen.findByText('32T LR 34199 77670')).toBeTruthy();
    expect(screen.getByText('Précision ± 8 m')).toBeTruthy();
    await fireEvent.press(screen.getByText('Envoyer ma position par SMS'));
    const url = String(open.mock.calls[1][0]);
    expect(url.startsWith('sms:?body=')).toBe(true);
    expect(decodeURIComponent(url)).toContain(
      'Ma position : 45.83265, 6.86518 (± 8 m). MGRS 32T LR 34199 77670.',
    );

    // Plan familial : préparé depuis l'écran Urgence, puis joignable.
    await fireEvent.press(screen.getByText('Préparer le plan familial'));
    await fireEvent.press(await screen.findByText('Ajouter un contact'));
    await fireEvent.changeText(screen.getByLabelText('Nom'), 'Paul');
    await fireEvent.changeText(
      screen.getByLabelText('Téléphone'),
      '06 12 34 56 78',
    );
    await fireEvent(
      screen.getByLabelText('Contact 1 hors zone'),
      'valueChange',
      true,
    );
    await fireEvent.changeText(
      screen.getByLabelText('Près du domicile'),
      'Parking de l’école',
    );
    await fireEvent.press(screen.getByText('Enregistrer le plan'));
    expect(await screen.findByText('Plan familial enregistré.')).toBeTruthy();
    const share = jest.spyOn(Share, 'share').mockResolvedValue({
      action: Share.sharedAction,
      activityType: undefined,
    });
    await fireEvent.press(screen.getByText('Partager le plan'));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const shared = share.mock.calls[0][0] as { message: string };
    expect(shared.message).toContain('- Paul : 06 12 34 56 78 · hors zone');
    expect(shared.message).toContain('Près du domicile : Parking de l’école');
    share.mockRestore();
    await fireEvent.press(screen.getByLabelText('Retour à l’urgence'));
    expect(await screen.findByText('Parking de l’école')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Appeler Paul'));
    expect(open).toHaveBeenLastCalledWith('tel:0612345678');

    await fireEvent.press(screen.getByText('Arrêt cardiaque'));
    expect(
      (await screen.findAllByText(/massage cardiaque|compressions/i)).length,
    ).toBeGreaterThan(0);
    open.mockRestore();
  });

  it('exporte une sauvegarde chiffrée puis la restaure', async () => {
    const ctx = await existingVault();
    const file: { saved: { name: string; text: string } | null } = {
      saved: null,
    };
    await render(
      <AppRoot
        manager={ctx.manager}
        content={content}
        files={{
          available: true,
          saveText: async (name, _mime, text) => {
            file.saved = { name, text };
            return true;
          },
          openText: async () => file.saved?.text ?? null,
        }}
        backupCrypto={{
          engine: new JsArgon2(),
          random: new SeededRandom(7),
          params: TEST_ARGON2_PARAMS,
        }}
      />,
    );
    await unlockWith(MASTER);
    await fireEvent.press(await screen.findByLabelText('Réglages'));
    await fireEvent.press(await screen.findByText('Exporter une sauvegarde'));
    await fireEvent.changeText(
      screen.getByLabelText('Mot de passe de la sauvegarde'),
      'court',
    );
    await fireEvent.press(screen.getByText('Chiffrer et enregistrer'));
    expect(await screen.findByText('Au moins 8 caractères')).toBeTruthy();

    await fireEvent.changeText(
      screen.getByLabelText('Mot de passe de la sauvegarde'),
      'phrase secrète',
    );
    await fireEvent.changeText(
      screen.getByLabelText('Confirmer le mot de passe'),
      'phrase secrète',
    );
    await fireEvent.press(screen.getByText('Chiffrer et enregistrer'));
    expect(await screen.findByText(/Sauvegarde enregistrée/)).toBeTruthy();
    expect(file.saved?.name).toMatch(
      /^fenrir-sauvegarde-\d{4}-\d{2}-\d{2}\.fenrir$/,
    );
    expect(file.saved?.text).not.toContain('Riz');

    // Le stock change, puis la sauvegarde est restaurée.
    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Nourriture' }),
    );
    await fireEvent.press(await screen.findByLabelText('Riz, 10 kg'));
    await fireEvent.press(await screen.findByLabelText('Supprimer « Riz »'));
    await fireEvent.press(screen.getByLabelText('Oui, supprimer'));
    expect(await screen.findByText('« Riz » supprimé.')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Réglages'));
    await fireEvent.press(await screen.findByText('Restaurer une sauvegarde'));
    expect(await screen.findByText(/remplace tout le contenu/)).toBeTruthy();
    await fireEvent.changeText(
      screen.getByLabelText('Mot de passe de la sauvegarde'),
      'mauvais mot de passe',
    );
    await fireEvent.press(screen.getByText('Restaurer'));
    expect(await screen.findByText(/Mot de passe incorrect/)).toBeTruthy();
    await fireEvent.changeText(
      screen.getByLabelText('Mot de passe de la sauvegarde'),
      'phrase secrète',
    );
    await fireEvent.press(screen.getByText('Restaurer'));
    expect(await screen.findByText(/restaurée/)).toBeTruthy();

    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Nourriture' }),
    );
    expect(await screen.findByLabelText('Riz, 10 kg')).toBeTruthy();
  });

  it('active les rappels neutres et les met à jour au verrouillage', async () => {
    const ctx = await existingVault();
    const calls: Array<readonly number[] | 'cancel'> = [];
    let granted = false;
    await render(
      <AppRoot
        manager={ctx.manager}
        content={content}
        reminders={{
          available: true,
          requestPermission: async () => granted,
          schedule: async times => {
            calls.push(times);
          },
          cancelAll: async () => {
            calls.push('cancel');
          },
        }}
      />,
    );
    await unlockWith(MASTER);
    // Désactivés par défaut : l'ouverture du coffre n'en programme aucun.
    await waitFor(() => expect(calls).toEqual(['cancel']));
    await fireEvent.press(await screen.findByLabelText('Réglages'));
    const toggle = await screen.findByLabelText('Rappels de péremption');
    expect(toggle.props.value).toBe(false);
    expect(screen.getByText(/sans nom\s+d’article/)).toBeTruthy();

    // Autorisation refusée : rien n'est activé.
    await fireEvent(toggle, 'valueChange', true);
    expect(await screen.findByText(/Notifications refusées/)).toBeTruthy();
    expect(calls).toEqual(['cancel']);

    granted = true;
    await fireEvent(
      screen.getByLabelText('Rappels de péremption'),
      'valueChange',
      true,
    );
    expect(await screen.findByText('Aucun rappel à venir.')).toBeTruthy();
    expect(calls).toEqual(['cancel', []]);

    await fireEvent.press(screen.getByLabelText('Verrouiller'));
    expect(await screen.findByText('Saisissez votre code')).toBeTruthy();
    await waitFor(() => expect(calls).toEqual(['cancel', [], []]));
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
  async function openApp(
    extra: Partial<
      Pick<Parameters<typeof AppRoot>[0], 'scanSource' | 'productFetch'>
    > = {},
  ) {
    const ctx = await existingVault();
    await render(
      <AppRoot manager={ctx.manager} content={content} {...extra} />,
    );
    await unlockWith(MASTER);
    await screen.findByText('Autonomie du foyer');
    return ctx;
  }

  it('vérifie le kit 72 h d’après le stock et ouvre la fiche d’un manque', async () => {
    await openApp();
    await fireEvent.press(
      screen.getByLabelText('Ouvrir la préparation par paliers'),
    );
    // 30 L pour 1 personne à 3 L par jour : 10 jours d'eau, 18 de vivres.
    expect(await screen.findByText('10 j sur 3')).toBeTruthy();
    expect(screen.getByText('18 j sur 3')).toBeTruthy();
    expect(screen.getByText('2 sur 13 prêts')).toBeTruthy();
    await fireEvent.press(screen.getByText('7 jours'));
    expect(await screen.findByText('10 j sur 7')).toBeTruthy();
    await fireEvent.press(screen.getByText('10 jours'));
    expect(await screen.findByText('10 j sur 10')).toBeTruthy();

    await fireEvent.press(
      screen.getByRole('checkbox', { name: 'Argent liquide' }),
    );
    expect(await screen.findByText('3 sur 13 prêts')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Ajouter : Radio à piles'));
    expect(await screen.findByDisplayValue('Radio à piles')).toBeTruthy();
  });

  it('montre les hypothèses du calcul et simule des scénarios', async () => {
    await openApp();
    expect(
      screen.getByText(/Calcul : 3 L d’eau et 2 000 kcal par personne/),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        /^Énergie stockée : 0 Wh utiles, Capacités non renseignées/,
      ),
    ).toBeTruthy();
    await fireEvent.press(
      screen.getByLabelText('Détail du calcul : ouvrir le plan d’action'),
    );
    expect(await screen.findByText('Scénarios de consommation')).toBeTruthy();
    expect(
      screen.getByText(/Autonomie du foyer dans ce scénario : 10 j/),
    ).toBeTruthy();
    await fireEvent.press(screen.getByText('Canicule'));
    // 30 L à 4,5 L par jour : 6 jours.
    expect(
      await screen.findByText(/Autonomie du foyer dans ce scénario : 6 j/),
    ).toBeTruthy();
    expect(screen.getByText('4,5 L / jour')).toBeTruthy();
  });

  it('calcule les besoins en eau par usage et les besoins électriques', async () => {
    await openApp();
    await fireEvent.press(
      screen.getByLabelText('Détail du calcul : ouvrir le plan d’action'),
    );
    await fireEvent.press(
      await screen.findByText('Calculateurs eau et électricité'),
    );
    expect(await screen.findByText('Eau du foyer')).toBeTruthy();
    // 1 personne, 3 L de boisson, objectif de 14 jours : 42 L, 30 L en stock.
    expect(screen.getByText('42 L')).toBeTruthy();
    expect(screen.getByText('12 L')).toBeTruthy();
    await fireEvent.press(
      screen.getByText('Repères Sphère : 2,5 L · 3 L · 2 L'),
    );
    // 2,5 + 3 + 2 = 7,5 L par jour, 105 L pour 14 jours.
    expect(await screen.findByText('7,5 L')).toBeTruthy();
    expect(screen.getByText('105 L')).toBeTruthy();
    expect(screen.getByText('75 L')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Appareil'), 'Lampe LED');
    await fireEvent.changeText(screen.getByLabelText('Puissance (W)'), '5');
    await fireEvent.press(screen.getByText('Ajouter l’appareil'));
    expect(await screen.findByText(/Durée invalide/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Heures par jour'), '4');
    await fireEvent.press(screen.getByText('Ajouter l’appareil'));
    expect(await screen.findByText('Lampe LED')).toBeTruthy();
    expect(screen.getByText('20 Wh')).toBeTruthy();
    // 20 Wh × 1,2 ÷ 0,8 = 30 Wh.
    expect(screen.getByText('30 Wh')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Retirer Lampe LED'));
    expect(
      await screen.findByText('Aucun appareil pour l’instant.'),
    ).toBeTruthy();
  });

  it('scanne en série, reconnaît en ligne et complète le stock', async () => {
    const LENTILS = '3017620422003';
    const UNKNOWN = '96385074';
    const reads: string[][] = [
      [LENTILS, LENTILS, UNKNOWN],
      [LENTILS],
      [LENTILS, LENTILS],
    ];
    const scanSource = {
      available: true,
      scan: jest.fn(async () => reads.shift()?.map(code => ({ code })) ?? null),
    };
    const requested: string[] = [];
    const productFetch = jest.fn(async (url: string) => {
      requested.push(url);
      const found = url.includes(LENTILS);
      return {
        ok: found,
        status: found ? 200 : 404,
        json: async () => ({
          status: 1,
          product: {
            product_name_fr: 'Lentilles cuisinées',
            brands: 'Cassegrain',
            quantity: '400 g',
            product_quantity: 400,
            product_quantity_unit: 'g',
            nutriments: { 'energy-kcal_100g': 99 },
          },
        }),
      };
    });
    await openApp({ scanSource, productFetch });
    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    await fireEvent.press(
      await screen.findByLabelText('Scanner des codes-barres'),
    );
    await fireEvent.press(
      await screen.findByLabelText('Scanner plusieurs articles à la suite'),
    );
    expect(
      await screen.findByText('3 lectures ajoutées au panier.'),
    ).toBeTruthy();
    // Rien n'est envoyé avant l'accord.
    expect(productFetch).not.toHaveBeenCalled();
    expect(screen.getByText('Panier · 2')).toBeTruthy();
    await fireEvent.press(screen.getByText('Autoriser la recherche'));
    expect(await screen.findByText('Lentilles cuisinées')).toBeTruthy();
    expect(
      screen.getByText('Inconnu des bases en ligne : fiche à compléter.'),
    ).toBeTruthy();
    expect(requested.every(u => /product\/\d+\.json/.test(u))).toBe(true);

    await fireEvent.press(screen.getByText('Créer la fiche préremplie'));
    expect(
      await screen.findByDisplayValue('Lentilles cuisinées (Cassegrain)'),
    ).toBeTruthy();
    expect(screen.getByDisplayValue('99')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Enregistrer le stock'));
    // Retour au scanner : le produit a quitté le panier.
    expect(await screen.findByText('Panier · 1')).toBeTruthy();

    // Le même code est désormais reconnu sans réseau.
    await fireEvent.press(screen.getByText('Scanner un article'));
    expect(
      await screen.findByLabelText(
        'Ajouter au stock : Lentilles cuisinées (Cassegrain)',
      ),
    ).toBeTruthy();
    await fireEvent.changeText(
      screen.getByLabelText('Péremption'),
      '31/12/2028',
    );
    await fireEvent.press(
      screen.getByLabelText(
        'Ajouter au stock : Lentilles cuisinées (Cassegrain)',
      ),
    );
    expect(
      await screen.findByText(
        'Stock de « Lentilles cuisinées (Cassegrain) » complété : +1 pièce.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Panier · 1')).toBeTruthy();

    // Retrait : 2 fiches créées + 1 ajoutée = 3 en stock, 2 lectures retirées.
    await fireEvent.press(screen.getByText('Retirer du stock'));
    await fireEvent.press(screen.getByText('Scanner en série'));
    expect(await screen.findByText('À retirer · 1')).toBeTruthy();
    expect(screen.getByText(/^En stock : 3 pièces/)).toBeTruthy();
    await fireEvent.press(
      screen.getByLabelText(
        'Retirer du stock : Lentilles cuisinées (Cassegrain)',
      ),
    );
    expect(
      await screen.findByText(
        'Retrait de « Lentilles cuisinées (Cassegrain) » : 2 pièces. Reste 1.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/^À retirer/)).toBeNull();

    // Code jamais associé : rien n'est retiré.
    await fireEvent.changeText(screen.getByLabelText('Code-barres'), UNKNOWN);
    await fireEvent.press(screen.getByText('Retirer : valider le code'));
    expect(await screen.findByText(/^Inconnu de vos stocks/)).toBeTruthy();
  });

  it('range un code inconnu dans la catégorie choisie', async () => {
    await openApp({
      scanSource: { available: false, scan: async () => null },
      productFetch: async () => ({
        ok: false,
        status: 404,
        json: async () => ({}),
      }),
    });
    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    await fireEvent.press(
      await screen.findByLabelText('Scanner des codes-barres'),
    );
    await fireEvent.changeText(
      await screen.findByLabelText('Code-barres'),
      '96385074',
    );
    await fireEvent.press(screen.getByText('Ajouter le code'));
    await fireEvent.press(await screen.findByText('Rester hors ligne'));
    await fireEvent.press(await screen.findByText('Hygiène'));
    await fireEvent.press(screen.getByText('Créer une fiche à compléter'));
    expect(await screen.findByText('Ajouter du médical')).toBeTruthy();
  });

  it('passe tout l’écran en lumière rouge et s’en souvient', async () => {
    await openApp();
    expect(screen.queryByTestId('red-light')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Réglages'));
    await fireEvent(
      await screen.findByLabelText('Mode lumière rouge'),
      'valueChange',
      true,
    );
    expect(await screen.findByTestId('red-light')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Verrouiller'));
    await unlockWith(MASTER);
    await screen.findByText('Autonomie du foyer');
    expect(screen.getByTestId('red-light')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Ouvrir l’écran Urgence'));
    await fireEvent.press(await screen.findByText('Quitter la lumière rouge'));
    expect(screen.queryByTestId('red-light')).toBeNull();
  });

  it('retire une unité en un geste et règle l’eau à 2 L', async () => {
    await openApp();
    expect(
      screen.getByLabelText('Eau disponible : 30 L, 10 j d’autonomie'),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/périmé. Ouvrir le stock/)).toBeNull();

    await fireEvent.press(screen.getByLabelText('Réglages'));
    await fireEvent.press(await screen.findByText('Mon foyer et hypothèses'));
    await fireEvent.press(await screen.findByText('2 L'));
    await fireEvent.press(screen.getByRole('tab', { name: 'Accueil' }));
    expect(
      await screen.findByLabelText('Eau disponible : 30 L, 15 j d’autonomie'),
    ).toBeTruthy();

    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Nourriture' }),
    );
    await fireEvent.press(await screen.findByLabelText('Retirer 1 kg de Riz'));
    expect(await screen.findByText('Riz : 1 kg retiré. Reste 9.')).toBeTruthy();
    expect(screen.getByLabelText('Riz, 9 kg')).toBeTruthy();
  });

  it('simule une crise jour par jour sur le stock réel', async () => {
    await openApp();
    await fireEvent.press(
      screen.getByLabelText('Ouvrir le simulateur de crise'),
    );
    // Coupure de courant de 5 jours : 30 L à 3 L par jour suffisent.
    expect(await screen.findAllByText(/tient les 5 jours/)).toHaveLength(2);
    expect(
      screen.getByText(/Énergie : aucune batterie de capacité connue/),
    ).toBeTruthy();
    expect(screen.getByText(/^Jour 5 · /)).toBeTruthy();

    await fireEvent.press(screen.getByText('Confinement'));
    await fireEvent.press(await screen.findByText('21 jours'));
    // Eau : 10 jours couverts, 11 jours × 3 L manquent.
    expect(
      await screen.findByText(/manque dès le jour 11 · 33 L à prévoir/),
    ).toBeTruthy();
    expect(screen.getByText(/^Jour 21 · /)).toBeTruthy();

    await fireEvent.press(screen.getByText('Se mettre à l’abri'));
    expect(
      await screen.findByText('Se mettre à l’abri (confinement)'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByText('Retour à la simulation'));
    // Le scénario choisi est conservé au retour.
    await fireEvent.press(await screen.findByText('Ajouter de l’eau'));
    expect(
      await screen.findByText(/Ajouter de l’eau|Nouvelle fiche/),
    ).toBeTruthy();
  });

  it('range la préparation dans son onglet et revient à l’écran d’origine', async () => {
    await openApp();
    await fireEvent.press(screen.getByRole('tab', { name: 'Préparer' }));
    expect(
      await screen.findByLabelText(/^Indice de préparation : \d+ sur 100/),
    ).toBeTruthy();
    await fireEvent.press(
      screen.getByLabelText('Ouvrir le simulateur de crise'),
    );
    await screen.findByText('Simulateur de crise');
    await fireEvent.press(screen.getByLabelText('Retour à Préparer'));
    // Plan d’action puis calculateurs : chaque retour remonte d’un écran.
    await fireEvent.press(
      await screen.findByLabelText('Ouvrir le plan d’action'),
    );
    await fireEvent.press(
      await screen.findByText('Calculateurs eau et électricité'),
    );
    await fireEvent.press(
      await screen.findByLabelText('Retour au plan d’action'),
    );
    await fireEvent.press(await screen.findByLabelText('Retour à Préparer'));
    expect(
      await screen.findByLabelText('Ouvrir le plan d’achats'),
    ).toBeTruthy();
    // SOS dans l’en-tête, depuis n’importe quelle section.
    await fireEvent.press(screen.getByLabelText('Ouvrir l’écran Urgence'));
    await fireEvent.press(await screen.findByLabelText('Retour à Préparer'));
    expect(
      await screen.findByLabelText('Ouvrir le plan d’achats'),
    ).toBeTruthy();
  });

  it('montre sur l’accueil les actions prioritaires et les accès rapides', async () => {
    await openApp();
    // Prochaine action de l’indice : une lampe, dans la fiche d’ajout habituelle.
    await fireEvent.press(
      screen.getByLabelText('À faire : Une lampe par personne'),
    );
    expect(await screen.findByDisplayValue('Lampe frontale')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Retour'));
    await fireEvent.press(await screen.findByRole('tab', { name: 'Accueil' }));
    await fireEvent.press(
      await screen.findByLabelText('Ouvrir les fiches pratiques'),
    );
    expect(
      screen.getByRole('tab', { name: 'Fiches' }).props.accessibilityState,
    ).toEqual({ selected: true });
  });

  it('règle le foyer dans Mon foyer et ouvre le kit depuis l’urgence', async () => {
    await openApp();
    await fireEvent.press(
      screen.getByLabelText('Hypothèses du calcul. Modifier dans Mon foyer'),
    );
    expect(await screen.findByText('Mon foyer')).toBeTruthy();
    await fireEvent.press(await screen.findByText('2 L'));
    await fireEvent.press(screen.getByLabelText('Retour à l’accueil'));
    expect(
      await screen.findByLabelText('Eau disponible : 30 L, 15 j d’autonomie'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Ouvrir l’écran Urgence'));
    await fireEvent.press(
      await screen.findByLabelText('Ouvrir la check-list du kit 72 heures'),
    );
    await fireEvent.press(await screen.findByLabelText('Retour à l’urgence'));
    expect(await screen.findByText('Ma position')).toBeTruthy();
  });

  it('affiche l’indice de préparation et ses actions', async () => {
    await openApp();
    // Prochaine action de l’indice : aussi dans « À faire en priorité ».
    expect(screen.getByText('À faire en priorité')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Préparer' }));
    const card = await screen.findByLabelText(
      /^Indice de préparation : \d+ sur 100, .+\. Voir le détail$/,
    );
    await fireEvent.press(card);
    expect(await screen.findByText('Détail des critères')).toBeTruthy();
    expect(screen.getByText('Prochaines actions')).toBeTruthy();
    // Aucun document ni plan familial dans le coffre de test.
    expect(
      screen.getByLabelText(/^Documents : 0 sur 10 points\./),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        /^Plan familial : 0 sur 10 points\. Plan familial vide\./,
      ),
    ).toBeTruthy();
    // Première action : la radio, préremplie dans la fiche d'ajout habituelle.
    await fireEvent.press(screen.getByLabelText('Ajouter au stock : Radio'));
    expect(await screen.findByDisplayValue('Radio à piles')).toBeTruthy();
  });

  it('échelonne les achats et les rappelle sur l’accueil', async () => {
    await openApp();
    await fireEvent.press(
      screen.getByLabelText('Détail du calcul : ouvrir le plan d’action'),
    );
    await fireEvent.press(await screen.findByText('Plan d’achats échelonné'));
    await fireEvent.press(await screen.findByText('6 mois'));
    await fireEvent.press(screen.getByText('Créer le plan'));
    expect(
      await screen.findByText(/^Plan créé : \d+ achats? sur 6 mois\.$/),
    ).toBeTruthy();
    expect(screen.getByText(/^Ce mois-ci · /)).toBeTruthy();
    const radio = screen.getByRole('checkbox', {
      name: 'Radio à piles, Pour suivre les consignes des autorités.',
    });
    await fireEvent.press(radio);
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', {
          name: 'Radio à piles, Pour suivre les consignes des autorités.',
        }).props.accessibilityState,
      ).toEqual({ checked: true }),
    );
    // Ouvert depuis le plan d’action : le retour y ramène, puis à l’accueil.
    await fireEvent.press(screen.getByLabelText('Retour au plan d’action'));
    await fireEvent.press(await screen.findByLabelText('Retour à l’accueil'));
    expect(
      await screen.findByLabelText(
        /^Achats du mois : \d+ à faire\. Ouvrir le plan d’achats$/,
      ),
    ).toBeTruthy();
  });

  it('chiffre les achats, applique un budget et met à jour sans perdre les coches', async () => {
    await openApp();
    await fireEvent.press(
      screen.getByLabelText('Détail du calcul : ouvrir le plan d’action'),
    );
    await fireEvent.press(await screen.findByText('Plan d’achats échelonné'));
    await fireEvent.press(await screen.findByText('Créer le plan'));
    await screen.findByText(/^Plan créé/);
    const radioName = 'Radio à piles, Pour suivre les consignes des autorités.';
    const price = screen.getByLabelText(`Prix : ${radioName}`);
    await fireEvent.changeText(price, '35');
    await fireEvent(price, 'blur');
    expect(await screen.findAllByText(/^35 €/)).not.toHaveLength(0);

    const budget = screen.getByLabelText('Budget par mois (€)');
    await fireEvent.changeText(budget, '50');
    await fireEvent(budget, 'blur');
    expect(await screen.findByText(/^Budget de 50 € par mois/)).toBeTruthy();
    expect(screen.getAllByText('35 € / 50 €')).not.toHaveLength(0);

    await fireEvent.press(screen.getByRole('checkbox', { name: radioName }));
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: radioName }).props
          .accessibilityState,
      ).toEqual({ checked: true }),
    );
    await fireEvent.press(screen.getByText('Mettre à jour d’après le stock'));
    expect(await screen.findByText(/coches gardées\.$/)).toBeTruthy();
    expect(
      screen.getByRole('checkbox', { name: radioName }).props
        .accessibilityState,
    ).toEqual({ checked: true });
    // Ouvert depuis le plan d’action : le retour y ramène, puis à l’accueil.
    await fireEvent.press(screen.getByLabelText('Retour au plan d’action'));
    await fireEvent.press(await screen.findByLabelText('Retour à l’accueil'));
    expect(
      await screen.findByLabelText(
        /^Achats du mois : \d+ à faire\. Ouvrir le plan d’achats$/,
      ),
    ).toBeTruthy();
  });

  it('ajoute au plan d’achats les manques d’une crise simulée', async () => {
    await openApp();
    await fireEvent.press(
      screen.getByLabelText('Ouvrir le simulateur de crise'),
    );
    await fireEvent.press(await screen.findByText('Confinement'));
    await fireEvent.press(await screen.findByText('21 jours'));
    await screen.findByText(/manque dès le jour 11/);
    await fireEvent.press(
      screen.getByText('Ajouter les manques au plan d’achats'),
    );
    expect(
      await screen.findByText(/^Ajouté au plan d’achats et réparti/),
    ).toBeTruthy();
    await fireEvent.press(screen.getByText('Ouvrir le plan d’achats'));
    expect(
      (await screen.findAllByText(/^Eau potable · confinement de 21 jours/))
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(' · simulation').length).toBeGreaterThan(0);
  });

  it('trace chaque mouvement dans l’historique', async () => {
    await openApp();
    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Nourriture' }),
    );
    await fireEvent.press(await screen.findByLabelText('Retirer 1 kg de Riz'));
    expect(await screen.findByText('Riz : 1 kg retiré. Reste 9.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Plus d’actions'));
    await fireEvent.press(screen.getByLabelText('Historique des mouvements'));
    expect(await screen.findByText('Aujourd’hui')).toBeTruthy();
    expect(
      screen.getByLabelText(/^Retrait, −1 kg, Riz, \d{2}:\d{2}$/),
    ).toBeTruthy();
    await fireEvent.press(screen.getByText('Entrées'));
    await waitFor(() =>
      expect(screen.queryByLabelText(/^Retrait, −1 kg, Riz/)).toBeNull(),
    );
    await fireEvent.press(screen.getByText('Sorties'));
    expect(await screen.findByLabelText(/^Retrait, −1 kg, Riz/)).toBeTruthy();
  });

  it('recalcule l’autonomie quand le foyer change', async () => {
    await openApp();
    // Directement depuis l'accueil.
    await fireEvent.press(screen.getByLabelText('Ajouter une personne'));
    expect(await screen.findByLabelText('5 jours')).toBeTruthy(); // 30 L / (2 × 3 L)
    expect(screen.getByText('2 pers.')).toBeTruthy();

    // Et depuis Mon foyer, dans l’onglet Préparer.
    await fireEvent.press(screen.getByRole('tab', { name: 'Préparer' }));
    await fireEvent.press(
      await screen.findByLabelText(
        'Ouvrir Mon foyer : personnes, objectif, eau, calories, énergie',
      ),
    );
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
    await fireEvent.press(
      screen.getByLabelText('Détail du calcul : ouvrir le plan d’action'),
    );
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
      await screen.findByRole('button', { name: 'Nourriture' }),
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
      await screen.findByLabelText(
        'Détail du calcul : ouvrir le plan d’action',
      ),
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
    await fireEvent.press(screen.getByLabelText('Retirer'));
    expect(
      await screen.findByText('Retiré : 12 L du lot sans date. Reste 18 L.'),
    ).toBeTruthy();

    await fireEvent.changeText(
      screen.getByLabelText('Quantité à retirer (L)'),
      '50',
    );
    await fireEvent.press(screen.getByLabelText('Retirer'));
    expect(
      await screen.findByText('Stock insuffisant : 18 disponible(s)'),
    ).toBeTruthy();
  });

  it('ajoute un article dans sa catégorie et signale le champ invalide', async () => {
    await openApp();
    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    await fireEvent.press(await screen.findByLabelText('+ Ajouter un article'));
    // Sept fiches, une par catégorie.
    for (const title of [
      'Eau',
      'Nourriture',
      'Armement & munitions',
      'Médical',
      'Outils',
      'Matériel & équipements',
      'Énergie',
    ]) {
      expect(screen.getByLabelText(`Ajouter : ${title}`)).toBeTruthy();
    }
    await fireEvent.press(screen.getByLabelText('Ajouter : Nourriture'));
    expect(await screen.findByText('Ajouter de la nourriture')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Enregistrer le stock'));
    expect(await screen.findByText('Champ obligatoire')).toBeTruthy();

    await fireEvent.changeText(
      screen.getByLabelText('Nom / Description, obligatoire'),
      'Flocons d’avoine',
    );
    await fireEvent.changeText(
      screen.getByLabelText('Quantité, obligatoire'),
      '2',
    );
    await unit('kg');
    await fireEvent.changeText(
      screen.getByLabelText('Date de péremption'),
      '30022027',
    );
    expect(screen.getByLabelText('Date de péremption').props.value).toBe(
      '30/02/2027',
    );
    await fireEvent.press(screen.getByLabelText('Enregistrer le stock'));
    expect(await screen.findByText('Date invalide (JJ/MM/AAAA)')).toBeTruthy();
    // Les valeurs saisies restent en place.
    expect(
      screen.getByLabelText('Nom / Description, obligatoire').props.value,
    ).toBe('Flocons d’avoine');

    await fireEvent.changeText(
      screen.getByLabelText('Date de péremption'),
      '28/02/2027',
    );
    await fireEvent.press(screen.getByLabelText('Enregistrer le stock'));
    expect(
      await screen.findByText('« Flocons d’avoine » enregistré.'),
    ).toBeTruthy();
    // Retour dans la catégorie de l'article.
    await fireEvent.press(
      await screen.findByLabelText('Flocons d’avoine, 2 kg'),
    );
    expect(
      await screen.findByText(
        'Données incomplètes : non comptées dans l’autonomie',
      ),
    ).toBeTruthy();

    // L'accueil le signale, sans inventer de calories.
    await fireEvent.press(screen.getByRole('tab', { name: 'Accueil' }));
    expect(await screen.findByText('Données incomplètes')).toBeTruthy();
    expect(
      screen.getByLabelText(
        'Réserves alimentaires : 36 000 kcal, 18 j d’autonomie',
      ),
    ).toBeTruthy();
  });

  it('convertit une position en MGRS et calcule un cap', async () => {
    await openApp();
    await fireEvent.press(screen.getByRole('tab', { name: 'Position' }));
    await fireEvent.changeText(screen.getByLabelText('Latitude'), '45,83265');
    await fireEvent.changeText(screen.getByLabelText('Longitude'), '6.86518');
    expect(await screen.findByText('32T LR 34199 77670')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Copier MGRS'));
    expect(Clipboard.setString).toHaveBeenCalledWith('32T LR 34199 77670');
    expect(screen.getByLabelText('MGRS copié')).toBeTruthy();

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

  it('remplit la position avec le GPS du téléphone', async () => {
    const ctx = await existingVault();
    await render(
      <AppRoot
        manager={ctx.manager}
        content={content}
        location={{
          available: true,
          getPosition: async () => ({
            latitude: 45.83265,
            longitude: 6.86518,
            accuracy: 8,
            stale: false,
          }),
        }}
      />,
    );
    await unlockWith(MASTER);
    await fireEvent.press(await screen.findByRole('tab', { name: 'Position' }));
    await fireEvent.press(screen.getByText('Utiliser ma position GPS'));
    expect(
      await screen.findByText('Position GPS · précision ± 8 m'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Latitude').props.value).toBe('45.832650');
    expect(await screen.findByText(/^32T LR 34199 77670$/)).toBeTruthy();
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
    expect(screen.queryByText('Données incomplètes')).toBeNull();

    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    expect(await screen.findByLabelText('Eau : 30 L, 1 article')).toBeTruthy();
    expect(
      screen.getByLabelText('Nourriture : 36 000 kcal, 1 article'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Outils : 0 article')).toBeTruthy();
    expect(
      screen.getByLabelText('Armement : 0 munition, 0 arme, 0 article'),
    ).toBeTruthy();

    await fireEvent.press(screen.getByRole('tab', { name: 'Fiches' }));
    const firstAid = BUNDLED_GUIDES.filter(g => g.category === 'Santé').length;
    await fireEvent.press(
      await screen.findByLabelText(`Santé, ${firstAid} fiches`),
    );
    expect(await screen.findByText('Hypothermie')).toBeTruthy();
    expect(screen.queryByText('Rendre l’eau potable')).toBeNull();

    // Schéma pas à pas : étapes encadrées reliées par des flèches.
    await fireEvent.press(screen.getByText('Bilan rapide d’une victime'));
    expect(
      await screen.findByText('SÉCURISER la zone et se protéger'),
    ).toBeTruthy();
    expect(screen.getAllByText('↓')).toHaveLength(3);
    expect(screen.queryByText(/^◇/)).toBeNull();
  });

  it('montre les trois péremptions les plus proches sur l’accueil', async () => {
    const ctx = makeManager();
    const db = await createVault(ctx.manager, content, { masterPin: MASTER });
    const repo = new InventoryRepository(db);
    const today = localToday();
    for (const [name, days] of [
      ['Lait', 40],
      ['Pâtes', 20],
      ['Bouteilles', -3],
      ['Compote', 10],
    ] as const) {
      await repo.createItem(
        { name, category: 'food', unit: 'unit', caloriesPerUnit: 100 },
        { quantity: 2, expirationDate: addDays(today, days) },
      );
    }
    db.close();
    await render(<AppRoot manager={ctx.manager} content={content} />);
    await unlockWith(MASTER);
    await screen.findByText('Autonomie du foyer');

    expect(screen.getByLabelText('1 lot périmé. Ouvrir le stock')).toBeTruthy();
    expect(screen.getAllByText('Bouteilles').length).toBeGreaterThan(0);
    expect(screen.getByText('Compote')).toBeTruthy();
    expect(screen.getByText('Pâtes')).toBeTruthy();
    expect(screen.queryByText('Lait')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Voir les 4 péremptions'));
    expect(await screen.findByText('Lait')).toBeTruthy();

    // « À surveiller » dans les stocks : périmé d’abord, puis sous 30 jours.
    await fireEvent.press(screen.getByLabelText('Retour à l’accueil'));
    await fireEvent.press(
      await screen.findByLabelText('1 lot périmé. Ouvrir le stock'),
    );
    const watched = await screen.findAllByLabelText(
      /^(Bouteilles|Compote|Pâtes|Lait), /,
    );
    expect(watched.map(w => w.props.accessibilityLabel.split(',')[0])).toEqual([
      'Bouteilles',
      'Compote',
      'Pâtes',
    ]);
    expect(
      screen.getByRole('button', { name: 'À surveiller · 3' }).props
        .accessibilityState,
    ).toEqual({ selected: true });
  });

  it('retire bidon par bidon l’eau saisie avant les fiches', async () => {
    const ctx = makeManager();
    const db = await createVault(ctx.manager, content, { masterPin: MASTER });
    await new InventoryRepository(db).createItem(
      {
        name: 'Bidons garage',
        category: 'water',
        unit: 'L',
        packageSize: 10,
      },
      { quantity: 30 },
    );
    db.close();
    await render(<AppRoot manager={ctx.manager} content={content} />);
    await unlockWith(MASTER);
    await screen.findByText('Autonomie du foyer');
    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Eau' }));
    await fireEvent.press(await screen.findByLabelText('Bidons garage, 30 L'));
    expect(await screen.findByText('3 bidons de 10 L')).toBeTruthy();

    await fireEvent.press(screen.getByText('Retirer 1 bidon (10 L)'));
    expect(
      await screen.findByText('Retiré : 10 L du lot sans date. Reste 20 L.'),
    ).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Nombre de bidons'), '2');
    await fireEvent.press(screen.getByLabelText('Ajouter au stock existant'));
    expect(
      await screen.findByText('Stock de « Bidons garage » complété.'),
    ).toBeTruthy();
    expect(screen.getByText('4 bidons de 10 L')).toBeTruthy();
  });

  it('enregistre une arme et compte ses munitions par calibre', async () => {
    await openApp();
    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Armement' }),
    );
    expect(await screen.findByText(/Aucune arme enregistrée/)).toBeTruthy();

    await fireEvent.press(screen.getByText('Ajouter une arme'));
    expect(await screen.findByText('Ajouter une arme / munition')).toBeTruthy();
    expect(
      screen.getByRole('tab', { name: 'Arme', selected: true }),
    ).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Enregistrer le stock'));
    expect(await screen.findAllByText('Champ obligatoire')).toBeTruthy();

    await fireEvent.changeText(
      screen.getByLabelText('Nom / Modèle, obligatoire'),
      'Browning B525',
    );
    await pick('Type', 'Fusil (canon lisse)');
    await fireEvent.changeText(
      screen.getByLabelText('Calibre, obligatoire'),
      '12/70',
    );
    await fireEvent.changeText(
      screen.getByLabelText('Numéro de série'),
      'AB1234',
    );
    await fireEvent.press(screen.getByLabelText('Enregistrer le stock'));
    expect(
      await screen.findByText('« Browning B525 » enregistré.'),
    ).toBeTruthy();
    expect(screen.getByText('Aucune munition')).toBeTruthy();

    // Munitions : 10 boîtes de 25 au même calibre, saisi autrement.
    await fireEvent.press(
      screen.getByLabelText('+ Ajouter : Armement & munitions'),
    );
    expect(
      await screen.findByRole('tab', { name: 'Munition', selected: true }),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Date de péremption')).toBeNull();
    await fireEvent.changeText(
      screen.getByLabelText('Nom / Modèle, obligatoire'),
      'Cartouches plomb 7',
    );
    await fireEvent.changeText(screen.getByLabelText('Calibre'), '12 / 70');
    await fireEvent.changeText(
      screen.getByLabelText('Quantité, obligatoire'),
      '10',
    );
    await unit('boîte(s)');
    await fireEvent.changeText(
      screen.getByLabelText('Cartouches par boîte'),
      '25',
    );
    await fireEvent.press(screen.getByLabelText('Enregistrer le stock'));
    expect(
      await screen.findByText('« Cartouches plomb 7 » enregistré.'),
    ).toBeTruthy();
    expect(screen.getByText(/10 boîtes de 25 cartouches/)).toBeTruthy();

    await fireEvent.press(
      screen.getByLabelText('Browning B525, 12/70, 250 munitions'),
    );
    // Numéro de série masqué tant qu'on ne demande pas à le voir.
    expect(await screen.findByText('Fusil (canon lisse)')).toBeTruthy();
    expect(screen.queryByText('AB1234')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Afficher le numéro de série'));
    expect(await screen.findByText('AB1234')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Tous' }));
    expect(
      await screen.findByLabelText(
        'Armement : 250 munitions, 1 arme, 1 article',
      ),
    ).toBeTruthy();
  });

  it('ajoute des munitions depuis la fiche d’une arme existante', async () => {
    const ctx = makeManager();
    const db = await createVault(ctx.manager, content, { masterPin: MASTER });
    await new ArmoryRepository(db).createWeapon({
      model: 'Browning B525',
      kind: 'shotgun',
      caliber: '12/70',
    });
    db.close();
    await render(<AppRoot manager={ctx.manager} content={content} />);
    await unlockWith(MASTER);
    await screen.findByText('Autonomie du foyer');
    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Armement' }),
    );
    await fireEvent.press(
      await screen.findByLabelText('Browning B525, 12/70, 0 munition'),
    );
    expect(
      await screen.findByText('Aucune munition de ce calibre en stock.'),
    ).toBeTruthy();

    // Le calibre de l'arme est déjà rempli.
    await fireEvent.press(
      screen.getByLabelText('Ajouter des munitions en 12/70'),
    );
    expect(
      await screen.findByRole('tab', { name: 'Munition', selected: true }),
    ).toBeTruthy();
    expect(screen.getByLabelText('Calibre').props.value).toBe('12/70');
    await fireEvent.changeText(
      screen.getByLabelText('Quantité, obligatoire'),
      '50',
    );
    await fireEvent.press(screen.getByLabelText('Enregistrer le stock'));
    expect(
      await screen.findByText('« Munitions 12/70 » enregistré.'),
    ).toBeTruthy();

    // La fiche de l'arme liste ce stock et permet de le compléter.
    await fireEvent.press(
      screen.getByLabelText('Browning B525, 12/70, 50 munitions'),
    );
    await fireEvent.press(
      await screen.findByLabelText(
        'Compléter « Munitions 12/70 », 50 cartouches',
      ),
    );
    expect(
      await screen.findByLabelText('Ajouter au stock existant'),
    ).toBeTruthy();
  });

  it('supprime un lot puis tout un article, après confirmation', async () => {
    const ctx = makeManager();
    const db = await createVault(ctx.manager, content, { masterPin: MASTER });
    const repo = new InventoryRepository(db);
    const item = await repo.createItem(
      { name: 'Bidons cave', category: 'water', unit: 'L' },
      { quantity: 10, expirationDate: '2030-01-31' },
    );
    await repo.addLot(item.id, { quantity: 5 });
    db.close();
    await render(<AppRoot manager={ctx.manager} content={content} />);
    await unlockWith(MASTER);
    await screen.findByText('Autonomie du foyer');
    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Eau' }));
    await fireEvent.press(await screen.findByLabelText('Bidons cave, 15 L'));

    // Un lot : confirmation, puis seul ce lot disparaît.
    await fireEvent.press(
      await screen.findByLabelText('Supprimer le lot 5 L, non périssable'),
    );
    await fireEvent.press(screen.getByText('Supprimer ce lot'));
    expect(
      await screen.findByText('Lot supprimé : 5 L, non périssable.'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Bidons cave, 10 L')).toBeTruthy();

    // L'article entier : « Annuler » ne supprime rien.
    await fireEvent.press(screen.getByLabelText('Supprimer « Bidons cave »'));
    expect(screen.getByText(/Cette action est définitive/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Annuler'));
    expect(screen.getByLabelText('Bidons cave, 10 L')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Supprimer « Bidons cave »'));
    await fireEvent.press(screen.getByText('Oui, supprimer'));
    expect(await screen.findByText('« Bidons cave » supprimé.')).toBeTruthy();
    expect(screen.queryByLabelText(/^Bidons cave,/)).toBeNull();
  });

  it('supprime depuis la fiche modifiée et efface une fiche d’ajout', async () => {
    await openApp();
    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Nourriture' }),
    );

    // Fiche d'ajout : la corbeille efface la saisie, sans rien enregistrer.
    await fireEvent.press(screen.getByLabelText('+ Ajouter : Nourriture'));
    await fireEvent.changeText(
      await screen.findByLabelText('Nom / Description, obligatoire'),
      'Pâtes',
    );
    await fireEvent.press(screen.getByLabelText('Effacer la saisie'));
    await fireEvent.press(screen.getByLabelText('Oui, tout effacer'));
    expect(
      screen.getByLabelText('Nom / Description, obligatoire').props.value,
    ).toBe('');
    await fireEvent.press(screen.getByLabelText('Retour'));

    // Fiche existante : suppression après confirmation.
    await fireEvent.press(await screen.findByLabelText('Riz, 10 kg'));
    await fireEvent.press(await screen.findByText('Modifier la fiche'));
    await fireEvent.press(
      await screen.findByLabelText('Supprimer cette fiche'),
    );
    expect(
      screen.getByText(
        'Supprimer « Riz » et tout son stock ? Cette action est définitive.',
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Annuler'));
    expect(screen.queryByText(/Cette action est définitive/)).toBeNull();
    await fireEvent.press(screen.getByLabelText('Supprimer cette fiche'));
    await fireEvent.press(screen.getByLabelText('Oui, supprimer'));
    expect(await screen.findByText('« Riz » supprimé.')).toBeTruthy();
    expect(screen.queryByLabelText('Riz, 10 kg')).toBeNull();
  });

  it('cherche dans les fiches sans tenir compte des accents', async () => {
    await openApp();
    await fireEvent.press(screen.getByRole('tab', { name: 'Fiches' }));
    await fireEvent.changeText(
      await screen.findByLabelText('Rechercher une fiche'),
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

  it('ouvre la fiche balistique et coche sa liste de contrôle', async () => {
    await openApp();
    await fireEvent.press(screen.getByRole('tab', { name: 'Fiches' }));
    await fireEvent.press(
      await screen.findByLabelText(/^Équipement et protection, \d+ fiches?$/),
    );
    await fireEvent.press(
      await screen.findByText(
        'Protections balistiques — NIJ IIIA, III, IV et casque FAST',
      ),
    );
    expect(await screen.findByText('Tableau comparatif')).toBeTruthy();
    expect(screen.getByText('En bref')).toBeTruthy();
    expect(screen.getByText(/^\d+ min de lecture$/)).toBeTruthy();
    expect(screen.getByText('Sources officielles citées')).toBeTruthy();
    expect(screen.queryByText(/^Fiche à revoir/)).toBeNull();
    expect(screen.getByText('Sources et références')).toBeTruthy();
    expect(screen.getByText('0 sur 9 vérifiés')).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('checkbox', {
        name: 'Étiquette et traçabilité lisibles',
      }),
    );
    expect(
      await screen.findByText(
        /^1 sur 9 vérifiés · dernier contrôle le \d{2}\/\d{2}\/\d{4}$/,
      ),
    ).toBeTruthy();
    await fireEvent.press(
      screen.getByLabelText('Nouveau contrôle : tout décocher'),
    );
    expect(await screen.findByText('0 sur 9 vérifiés')).toBeTruthy();
    // Fermeture : retour à la liste du dossier.
    await fireEvent.press(screen.getByText('Toutes les fiches'));
    expect(
      (await screen.findAllByText('Équipement et protection')).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText('Tableau comparatif')).toBeNull();

    await fireEvent.changeText(
      screen.getByLabelText('Rechercher une fiche'),
      'casque FAST',
    );
    expect(
      await screen.findByText(
        'Protections balistiques — NIJ IIIA, III, IV et casque FAST',
      ),
    ).toBeTruthy();
  });

  it('range les fiches par dossier et met en forme le morse', async () => {
    await openApp();
    await fireEvent.press(screen.getByRole('tab', { name: 'Fiches' }));
    await screen.findByLabelText(/^Gestion de crise, \d+ fiches$/);
    const folders = screen
      .getAllByRole('button')
      .map(b => String(b.props.accessibilityLabel ?? ''))
      .filter(label => / fiches?$/.test(label))
      .map(label => label.replace(/, \d+ fiches?$/, ''));
    expect(folders).toEqual([...GUIDE_FOLDERS]);

    await fireEvent.press(screen.getByLabelText(/^Communication, /));
    await fireEvent.press(await screen.findByText('Code morse'));
    expect(await screen.findByText('Lettres')).toBeTruthy();
    expect(screen.getByText('SOS ···–––···')).toBeTruthy();
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
      await screen.findByRole('button', { name: 'Armement' }),
    );
    await fireEvent.press(await screen.findByText('Ajouter une arme'));
    await fireEvent.changeText(
      await screen.findByLabelText('Nom / Modèle, obligatoire'),
      'Glock 17',
    );
    await fireEvent.changeText(
      screen.getByLabelText('Calibre, obligatoire'),
      '9x19',
    );
    await fireEvent.press(screen.getByLabelText('Enregistrer le stock'));
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
      screen.getByLabelText('Date d’expiration (JJ/MM/AAAA, facultatif)'),
      '30/02/2027',
    );
    await fireEvent.press(screen.getByText('Ajouter le document'));
    expect(await screen.findByText('Date invalide (JJ/MM/AAAA)')).toBeTruthy();

    await fireEvent.changeText(
      screen.getByLabelText('Date d’expiration (JJ/MM/AAAA, facultatif)'),
      addDays(localToday(), 30).split('-').reverse().join('/'),
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
  async function openForm(title: string) {
    const ctx = await existingVault();
    await render(<AppRoot manager={ctx.manager} content={content} />);
    await unlockWith(MASTER);
    await screen.findByText('Autonomie du foyer');
    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    await fireEvent.press(await screen.findByLabelText('+ Ajouter un article'));
    await fireEvent.press(screen.getByLabelText(`Ajouter : ${title}`));
  }

  it('remplit une fiche en quelques appuis avec la saisie rapide', async () => {
    await openForm('Nourriture');
    // Seuls les champs essentiels sont affichés d'emblée.
    expect(screen.queryByLabelText('Emplacement')).toBeNull();
    await fireEvent.press(
      within(await screen.findByLabelText('Saisie rapide')).getByRole(
        'button',
        { name: 'Lentilles' },
      ),
    );
    expect(
      screen.getByLabelText('Nom / Description, obligatoire').props.value,
    ).toBe('Lentilles');
    expect(
      within(screen.getByLabelText('Unité (Quantité)')).getByRole('radio', {
        name: 'kg',
        selected: true,
      }),
    ).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Ajouter 1 (Quantité)'));
    await fireEvent.press(screen.getByLabelText('Ajouter 1 (Quantité)'));
    await fireEvent.press(screen.getByLabelText('Ajouter 1 (Quantité)'));
    await fireEvent.press(screen.getByLabelText('Retirer 1 (Quantité)'));
    expect(screen.getByLabelText('Quantité, obligatoire').props.value).toBe(
      '2',
    );
    // Le type usuel est déjà choisi dans les détails.
    await openDetails();
    expect(
      within(screen.getByLabelText('Type d’aliment')).getByRole('radio', {
        name: 'Légumineuse',
        selected: true,
      }),
    ).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Enregistrer le stock'));
    expect(await screen.findByText('« Lentilles » enregistré.')).toBeTruthy();
    expect(screen.getByLabelText('Lentilles, 2 kg')).toBeTruthy();
  });

  it('remplit un sac d’évacuation sans toucher au stock du foyer', async () => {
    const ctx = await existingVault();
    await render(<AppRoot manager={ctx.manager} content={content} />);
    await unlockWith(MASTER);
    await screen.findByText('Autonomie du foyer');
    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    await fireEvent.press(
      await screen.findByLabelText('Sacs d’évacuation : 0 sac'),
    );
    expect(screen.getByText('Aucun sac d’évacuation.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Nouveau sac'));
    await fireEvent.changeText(
      screen.getByLabelText('Nom du sac'),
      'Sac de Léa',
    );
    await fireEvent.changeText(
      screen.getByLabelText('Pour qui (facultatif)'),
      'Léa',
    );
    await fireEvent.press(screen.getByText('Créer le sac'));
    expect(await screen.findByText('Ce sac est vide.')).toBeTruthy();
    expect(screen.getByText('Sac de Léa')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('+ Ajouter dans le sac'));
    await fireEvent.press(screen.getByLabelText('Ajouter : Nourriture'));
    await fireEvent.press(
      within(await screen.findByLabelText('Saisie rapide')).getByRole(
        'button',
        { name: 'Lentilles' },
      ),
    );
    await fireEvent.changeText(
      screen.getByLabelText('Quantité, obligatoire'),
      '2',
    );
    await fireEvent.press(screen.getByLabelText('Enregistrer le stock'));
    // Retour dans le sac, pas dans la catégorie Eau.
    expect(await screen.findByText('« Lentilles » enregistré.')).toBeTruthy();
    expect(screen.getByText('Sac de Léa')).toBeTruthy();
    expect(screen.getByLabelText('Lentilles, 2 kg')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Tous les sacs'));
    expect(
      await screen.findByLabelText('Sac Sac de Léa : 1 article'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Tous' }));
    // Le stock du foyer est inchangé.
    expect(
      await screen.findByLabelText('Nourriture : 36 000 kcal, 1 article'),
    ).toBeTruthy();
  });

  it('range piles et batteries dans la catégorie Énergie', async () => {
    await openForm('Énergie');
    expect(await screen.findByText('Ajouter de l’énergie')).toBeTruthy();
    await fireEvent.press(
      within(screen.getByLabelText('Saisie rapide')).getByRole('button', {
        name: 'Piles AA',
      }),
    );
    expect(
      within(screen.getByLabelText('Type d’énergie')).getByRole('radio', {
        name: 'Piles / accus',
        selected: true,
      }),
    ).toBeTruthy();
    await fireEvent.changeText(
      screen.getByLabelText('Quantité, obligatoire'),
      '3',
    );
    await fireEvent.press(screen.getByLabelText('Enregistrer le stock'));
    expect(await screen.findByText('« Piles AA » enregistré.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Tous' }));
    expect(await screen.findByLabelText('Énergie : 1 article')).toBeTruthy();
    // Le matériel ne propose plus de type « Énergie ».
    await fireEvent.press(screen.getByLabelText('+ Ajouter un article'));
    await fireEvent.press(
      screen.getByLabelText('Ajouter : Matériel & équipements'),
    );
    await openDetails();
    expect(
      within(await screen.findByLabelText('Type de matériel')).queryByRole(
        'radio',
        { name: 'Énergie' },
      ),
    ).toBeNull();
  });

  it('propose une valeur énergétique habituelle, comptée après confirmation', async () => {
    await openForm('Nourriture');
    await fireEvent.changeText(
      await screen.findByLabelText('Nom / Description, obligatoire'),
      'Riz basmati',
    );
    await unit('kg');
    await fireEvent.changeText(
      screen.getByLabelText('Quantité, obligatoire'),
      '4',
    );
    expect(screen.getByText(/Valeur habituelle pour « riz »/)).toBeTruthy();
    // Rien n'est rempli tant que la valeur n'est pas confirmée.
    expect(screen.getByLabelText('Valeur énergétique').props.value).toBe('');
    await fireEvent.press(screen.getByLabelText('Utiliser cette valeur'));
    expect(screen.getByLabelText('Valeur énergétique').props.value).toBe('355');
    // 4 kg × 3 550 kcal = 14 200 kcal, à 2 000 kcal par jour.
    expect(screen.getByText(/environ 7,1 jours pour 1 pers\./)).toBeTruthy();
    expect(screen.getByText('14 200 kcal')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Enregistrer le stock'));
    expect(await screen.findByText('« Riz basmati » enregistré.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Tous' }));
    expect(
      await screen.findByLabelText('Nourriture : 50 200 kcal, 2 articles'),
    ).toBeTruthy();
  });

  it('propose aussi le poids habituel d’une boîte de conserve', async () => {
    await openForm('Nourriture');
    await fireEvent.press(
      within(await screen.findByLabelText('Saisie rapide')).getByRole(
        'button',
        { name: 'Conserves' },
      ),
    );
    await fireEvent.changeText(
      screen.getByLabelText('Quantité, obligatoire'),
      '3',
    );
    expect(screen.getByText(/400 g par boîte/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Utiliser cette valeur'));
    expect(screen.getByText('1 200 kcal')).toBeTruthy();
  });

  it('saisit l’eau en nombre de contenants × contenance', async () => {
    await openForm('Eau');
    // Plus de ligne « Quantité » : seulement nombre × contenance.
    expect(
      await screen.findByLabelText('Contenance, obligatoire'),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Quantité, obligatoire')).toBeNull();
    expect(screen.getByLabelText('Nombre, obligatoire').props.value).toBe('1');
    await fireEvent.changeText(
      screen.getByLabelText('Nom / Description, obligatoire'),
      'Jerricans garage',
    );
    // Contenance manquante : erreur, rien d'enregistré.
    await fireEvent.press(screen.getByLabelText('Enregistrer le stock'));
    expect(
      await screen.findByText(
        'Indiquez le nombre et la contenance (en litres)',
      ),
    ).toBeTruthy();
    await fireEvent.changeText(
      screen.getByLabelText('Nombre, obligatoire'),
      '4',
    );
    await fireEvent.changeText(
      screen.getByLabelText('Contenance, obligatoire'),
      '20',
    );
    expect(screen.getByText('80 L')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Enregistrer le stock'));
    expect(await screen.findByLabelText('Jerricans garage, 80 L')).toBeTruthy();
  });

  it('compte les calories seulement d’après la valeur saisie', async () => {
    await openForm('Nourriture');
    await fireEvent.changeText(
      await screen.findByLabelText('Nom / Description, obligatoire'),
      'Riz basmati',
    );
    await pick('Type d’aliment', 'Féculent');
    await fireEvent.changeText(
      screen.getByLabelText('Quantité, obligatoire'),
      '2',
    );
    await unit('kg');
    await fireEvent.changeText(
      screen.getByLabelText('Valeur énergétique'),
      '350',
    );
    await fireEvent.changeText(screen.getByLabelText('Emplacement'), 'Cellier');
    await fireEvent.press(screen.getByLabelText('Enregistrer le stock'));
    expect(await screen.findByText('« Riz basmati » enregistré.')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Riz basmati, 2 kg'));
    expect(await screen.findByText('350 kcal / 100 g')).toBeTruthy();
    expect(screen.getByText('3 500 kcal par kg')).toBeTruthy();
    expect(screen.getAllByText('Féculent').length).toBeGreaterThan(0);
    expect(screen.getByText('Cellier')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Tous' }));
    expect(
      await screen.findByLabelText('Nourriture : 43 000 kcal, 2 articles'),
    ).toBeTruthy();
  });

  it('modifie une fiche existante sans toucher à ses lots', async () => {
    await openForm('Nourriture');
    await fireEvent.press(await screen.findByLabelText('Retour'));
    await fireEvent.press(await screen.findByLabelText('Riz, 10 kg'));
    await fireEvent.press(await screen.findByText('Modifier la fiche'));
    expect(await screen.findByText('Modifier l’aliment')).toBeTruthy();
    expect(screen.queryByLabelText('Quantité, obligatoire')).toBeNull();
    await fireEvent.changeText(
      screen.getByLabelText('Nom / Description, obligatoire'),
      'Riz long',
    );
    await pick('Conservation', 'Au sec, à l’abri de l’humidité');
    await fireEvent.press(screen.getByLabelText('Enregistrer le stock'));
    expect(await screen.findByText('« Riz long » modifié.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Riz long, 10 kg'));
    expect(
      await screen.findByText('Au sec, à l’abri de l’humidité'),
    ).toBeTruthy();
    expect(screen.getByText('3 600 kcal par kg')).toBeTruthy();
  });

  it('ne déduit pas la potabilité du contenant', async () => {
    await openForm('Eau');
    expect(await screen.findByText('Ajouter de l’eau')).toBeTruthy();
    await pick('Type de contenant', 'Jerrican / bidon');
    // Aucune potabilité cochée d'office.
    expect(
      within(screen.getByLabelText('Potabilité')).queryByRole('radio', {
        selected: true,
      }),
    ).toBeNull();
    expect(screen.queryByLabelText('Date de traitement')).toBeNull();
    await pick('Traitement', 'Ébullition');
    expect(screen.getByLabelText('Date de traitement')).toBeTruthy();
  });

  it('ne demande pas de date de péremption pour les munitions', async () => {
    await openForm('Armement & munitions');
    expect(
      await screen.findByRole('tab', { name: 'Munition', selected: true }),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Date de péremption')).toBeNull();
    // Champs facultatifs repliés, à portée d'un appui.
    expect(screen.queryByLabelText('Date de contrôle')).toBeNull();
    await openDetails();
    expect(screen.getByLabelText('Date de contrôle')).toBeTruthy();
    expect(screen.queryByLabelText('Date de péremption')).toBeNull();
    await fireEvent.press(screen.getByRole('tab', { name: 'Accessoire' }));
    expect(screen.queryByLabelText(/^Calibre/)).toBeNull();
  });
});

describe('fiche médicale', () => {
  async function openMedical() {
    const ctx = await existingVault();
    await render(<AppRoot manager={ctx.manager} content={content} />);
    await unlockWith(MASTER);
    await screen.findByText('Autonomie du foyer');
    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    await fireEvent.press(await screen.findByLabelText('+ Ajouter un article'));
    await fireEvent.press(screen.getByLabelText('Ajouter : Médical'));
    await screen.findByText('Ajouter du médical');
  }

  const save = () =>
    fireEvent.press(screen.getByLabelText('Enregistrer le stock'));
  const count = (value: string) =>
    fireEvent.changeText(screen.getByLabelText('Nombre, obligatoire'), value);

  it('reprend exactement les libellés, l’ordre et le récapitulatif', async () => {
    await openMedical();
    const order = [
      'Nom du produit, obligatoire',
      'Catégorie : non renseigné',
      'Conditionnement : non renseigné',
      'Nombre, obligatoire',
      'Date de péremption',
      'Emplacement',
      'Stock total : —',
      'Enregistrer le stock',
    ];
    // Ordre d'apparition dans l'arbre rendu.
    const seen: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (node === null || typeof node !== 'object') {
        return;
      }
      const { props, children } = node as {
        props?: { accessibilityLabel?: unknown };
        children?: unknown;
      };
      const label = props?.accessibilityLabel;
      if (
        typeof label === 'string' &&
        order.includes(label) &&
        !seen.includes(label)
      ) {
        seen.push(label);
      }
      walk(children);
    };
    walk(screen.toJSON());
    expect(seen).toEqual(order);
    expect(
      screen.getByLabelText('Nom du produit, obligatoire').props.placeholder,
    ).toBe('Ex. Compresses stériles');
    expect(screen.getByLabelText('Date de péremption').props.placeholder).toBe(
      'Facultative — choisir une date',
    );
    expect(screen.getByLabelText('Emplacement').props.placeholder).toBe(
      'Ex. Armoire médicale',
    );
    // Aucun champ ni ajout hors spécification.
    expect(
      screen.queryByLabelText(/Dosage|Contenance|Poids|Volume/),
    ).toBeNull();
    expect(screen.queryByLabelText('Plus de détails')).toBeNull();
    expect(screen.queryByLabelText('Saisie rapide')).toBeNull();
    expect(screen.queryByLabelText('Ajouter une photo (optionnel)')).toBeNull();

    // Options de catégorie, dans l'ordre.
    await fireEvent.press(screen.getByLabelText('Catégorie : non renseigné'));
    expect(
      screen.getAllByRole('radio').map(r => r.props.accessibilityLabel),
    ).toEqual([
      'Pansements',
      'Médicaments',
      'Antiseptiques',
      'Protection',
      'Diagnostic',
      'Hygiène',
      'Autre',
    ]);
    await fireEvent.press(screen.getByRole('radio', { name: 'Pansements' }));

    // « Stock total » suit la saisie, avec les pluriels français.
    for (const [packaging, n, expected] of [
      ['Boîte', '1', '1 boîte'],
      ['Boîte', '3', '3 boîtes'],
      ['Pièce', '1', '1 pièce'],
      ['Pièce', '2', '2 pièces'],
      ['Flacon', '1', '1 flacon'],
      ['Flacon', '4', '4 flacons'],
      ['Paquet', '1', '1 paquet'],
      ['Paquet', '5', '5 paquets'],
    ]) {
      await pick('Conditionnement', packaging);
      await count(n);
      expect(screen.getByLabelText(`Stock total : ${expected}`)).toBeTruthy();
    }
  });

  it('exige nom, catégorie, conditionnement et un nombre entier positif', async () => {
    await openMedical();
    await save();
    expect(await screen.findByText('Champ obligatoire')).toBeTruthy();
    await fireEvent.changeText(
      screen.getByLabelText('Nom du produit, obligatoire'),
      'Compresses stériles',
    );
    await save();
    expect(await screen.findByText('Champ obligatoire')).toBeTruthy(); // catégorie
    await pick('Catégorie', 'Pansements');
    await save();
    expect(
      await screen.findByText('Choisissez un conditionnement'),
    ).toBeTruthy();
    await pick('Conditionnement', 'Boîte');
    await save();
    expect(await screen.findByText('Nombre obligatoire')).toBeTruthy();
    for (const [value, message] of [
      ['0', 'Nombre positif attendu'],
      ['-2', 'Nombre positif attendu'],
      ['2,5', 'Nombre entier attendu (ex. 3)'],
    ]) {
      await count(value);
      await save();
      expect(await screen.findByText(message)).toBeTruthy();
    }
    // La saisie reste en place après chaque erreur.
    expect(
      screen.getByLabelText('Nom du produit, obligatoire').props.value,
    ).toBe('Compresses stériles');
    await count('3');
    await save();
    expect(
      await screen.findByText('« Compresses stériles » enregistré.'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Compresses stériles, 3 boîtes')).toBeTruthy();
  });

  it('enregistre les quatre conditionnements et les garde après redémarrage', async () => {
    await openMedical();
    const cases = [
      ['Boîte', '2', 'boîtes'],
      ['Pièce', '4', 'pièces'],
      ['Flacon', '2', 'flacons'],
      ['Paquet', '5', 'paquets'],
    ] as const;
    for (const [i, [packaging, n]] of cases.entries()) {
      if (i > 0) {
        await fireEvent.press(
          await screen.findByLabelText('+ Ajouter : Médical'),
        );
      }
      await fireEvent.changeText(
        await screen.findByLabelText('Nom du produit, obligatoire'),
        `Produit ${packaging}`,
      );
      await pick('Catégorie', 'Autre');
      await pick('Conditionnement', packaging);
      await count(n);
      if (i === 0) {
        // Péremption et emplacement facultatifs : renseignés une seule fois.
        await fireEvent.changeText(
          screen.getByLabelText('Date de péremption'),
          '31/03/2028',
        );
        await fireEvent.changeText(
          screen.getByLabelText('Emplacement'),
          'Trousse principale',
        );
      }
      await save();
      expect(
        await screen.findByText(`« Produit ${packaging} » enregistré.`),
      ).toBeTruthy();
    }

    // Verrouillage puis réouverture du coffre : tout est relu de la base.
    await fireEvent.press(screen.getByLabelText('Verrouiller'));
    await unlockWith(MASTER);
    await screen.findByText('Autonomie du foyer');
    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Médical' }),
    );
    for (const [packaging, n, unitLabel] of cases) {
      expect(
        await screen.findByLabelText(`Produit ${packaging}, ${n} ${unitLabel}`),
      ).toBeTruthy();
    }
    await fireEvent.press(screen.getByLabelText('Produit Boîte, 2 boîtes'));
    expect(await screen.findByText('jusqu’au 31/03/2028')).toBeTruthy();
    expect(screen.getByText('Trousse principale')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Produit Boîte, 2 boîtes'));
    await fireEvent.press(screen.getByLabelText('Produit Pièce, 4 pièces'));
    expect(screen.queryByText('Trousse principale')).toBeNull();

    // La fiche rouverte garde son conditionnement.
    await fireEvent.press(screen.getByText('Modifier la fiche'));
    expect(
      await screen.findByLabelText('Conditionnement : Pièce'),
    ).toBeTruthy();
  });

  it('garde la saisie et prévient en français si l’enregistrement échoue', async () => {
    await openMedical();
    jest
      .spyOn(InventoryRepository.prototype, 'createItem')
      .mockRejectedValueOnce(new Error('espace de stockage plein'));
    await fireEvent.changeText(
      screen.getByLabelText('Nom du produit, obligatoire'),
      'Gants nitrile',
    );
    await pick('Catégorie', 'Protection');
    await pick('Conditionnement', 'Boîte');
    await count('2');
    await save();
    expect(
      await screen.findByText(
        'Enregistrement impossible : espace de stockage plein',
      ),
    ).toBeTruthy();
    expect(
      screen.getByLabelText('Nom du produit, obligatoire').props.value,
    ).toBe('Gants nitrile');
    expect(screen.getByLabelText('Conditionnement : Boîte')).toBeTruthy();
    expect(screen.getByLabelText('Nombre, obligatoire').props.value).toBe('2');
    // Nouvel essai : la vraie sauvegarde aboutit.
    await save();
    expect(
      await screen.findByText('« Gants nitrile » enregistré.'),
    ).toBeTruthy();
  });

  it('lit les anciens articles médicaux sans conditionnement', async () => {
    const ctx = makeManager();
    const db = await createVault(ctx.manager, content, { masterPin: MASTER });
    const repo = new InventoryRepository(db);
    await repo.createItem(
      { name: 'Ancien paracétamol', category: 'medical', unit: 'unit' },
      { quantity: 3 },
    );
    await repo.createItem(
      {
        name: 'Ancien sérum',
        category: 'medical',
        unit: 'unit',
        attributes: { countUnit: 'dose', dosage: '5 mL' },
      },
      { quantity: 10 },
    );
    db.close();
    await render(<AppRoot manager={ctx.manager} content={content} />);
    await unlockWith(MASTER);
    await screen.findByText('Autonomie du foyer');
    await fireEvent.press(screen.getByRole('tab', { name: 'Stocks' }));
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Médical' }),
    );
    // Sans conditionnement enregistré : « pièce » par défaut.
    await fireEvent.press(
      await screen.findByLabelText('Ancien paracétamol, 3 pièces'),
    );
    await fireEvent.press(screen.getByText('Modifier la fiche'));
    expect(
      await screen.findByLabelText('Conditionnement : Pièce'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Retour'));
    // Unité retirée (dose) : toujours lisible, ancien dosage conservé.
    await fireEvent.press(
      await screen.findByLabelText('Ancien sérum, 10 doses'),
    );
    expect(await screen.findByText('5 mL')).toBeTruthy();
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
        'Ajoutez vos vivres dans Stocks › Nourriture. L’eau seule couvre 10 j.',
      ),
    ).toBeTruthy();
    await fireEvent.press(
      screen.getByLabelText('Aucun vivre compté. Ajouter des vivres'),
    );
    expect(await screen.findByLabelText('Rechercher un article')).toBeTruthy();
    expect(screen.getByLabelText('+ Ajouter : Nourriture')).toBeTruthy();
  });
});
