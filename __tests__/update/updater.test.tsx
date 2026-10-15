import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { UpdateBanner } from '../../src/ui/components/UpdateBanner';
import {
  createGithubUpdater,
  parseRelease,
  type AvailableUpdate,
  type Updater,
} from '../../src/update/updater';

const release = (
  tag: string,
  assets = [{ name: `ResiliOS-${tag.slice(1)}.apk` }],
) => ({
  tag_name: tag,
  body: 'Liste de rachat et nouveau design',
  assets: assets.map(a => ({
    ...a,
    browser_download_url: `https://github.com/x/y/releases/download/${tag}/${a.name}`,
  })),
});

describe('parseRelease', () => {
  it('lit la version et l’APK', () => {
    expect(parseRelease(release('v0.1.12'))).toEqual({
      versionCode: 12,
      versionName: '0.1.12',
      apkUrl:
        'https://github.com/x/y/releases/download/v0.1.12/ResiliOS-0.1.12.apk',
      notes: 'Liste de rachat et nouveau design',
    });
  });

  it.each([
    ['sans APK', release('v0.1.3', [{ name: 'notes.txt' }])],
    ['étiquette inattendue', release('nightly')],
    ['réponse vide', null],
    ['texte', 'oops'],
  ])('ignore une version inexploitable (%s)', (_, json) => {
    expect(parseRelease(json)).toBeNull();
  });
});

describe('createGithubUpdater', () => {
  const native = (installed: number) => ({
    getVersionCode: jest.fn(async () => installed),
    downloadAndInstall: jest.fn(async () => true),
  });

  it('propose une version plus récente que celle installée', async () => {
    const updater = createGithubUpdater({
      native: native(5),
      fetchRelease: async () => release('v0.1.7'),
    });
    expect(await updater.check()).toMatchObject({ versionCode: 7 });
  });

  it('ne propose rien si la version installée est à jour', async () => {
    const updater = createGithubUpdater({
      native: native(7),
      fetchRelease: async () => release('v0.1.7'),
    });
    expect(await updater.check()).toBeNull();
  });

  it('reste silencieux hors-ligne', async () => {
    const updater = createGithubUpdater({
      native: native(5),
      fetchRelease: async () => {
        throw new TypeError('Network request failed');
      },
    });
    expect(await updater.check()).toBeNull();
  });

  it('ne fait rien sans module natif (iOS, tests, web)', async () => {
    const fetchRelease = jest.fn();
    const updater = createGithubUpdater({ native: null, fetchRelease });
    expect(await updater.check()).toBeNull();
    expect(fetchRelease).not.toHaveBeenCalled();
  });

  it('télécharge l’APK de la version choisie', async () => {
    const mod = native(5);
    const updater = createGithubUpdater({
      native: mod,
      fetchRelease: async () => release('v0.1.7'),
    });
    const update = (await updater.check()) as AvailableUpdate;
    await updater.install(update);
    expect(mod.downloadAndInstall).toHaveBeenCalledWith(update.apkUrl);
  });
});

describe('UpdateBanner', () => {
  const update: AvailableUpdate = {
    versionCode: 9,
    versionName: '0.1.9',
    apkUrl: 'https://example.invalid/app.apk',
    notes: 'Corrections',
  };

  it('n’affiche rien sans mise à jour', async () => {
    const updater: Updater = { check: async () => null, install: jest.fn() };
    await render(<UpdateBanner updater={updater} />);
    expect(screen.queryByText(/disponible/)).toBeNull();
  });

  it('affiche la version et lance l’installation', async () => {
    const install = jest.fn(async () => undefined);
    await render(
      <UpdateBanner updater={{ check: async () => update, install }} />,
    );
    expect(await screen.findByText('Version 0.1.9 disponible')).toBeTruthy();
    expect(screen.getByText('Corrections')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Installer la mise à jour'));
    expect(install).toHaveBeenCalledWith(update);
  });

  it('affiche l’échec du téléchargement', async () => {
    const install = jest.fn(async () => {
      throw new Error('Réponse HTTP 404');
    });
    await render(
      <UpdateBanner updater={{ check: async () => update, install }} />,
    );
    await fireEvent.press(
      await screen.findByLabelText('Installer la mise à jour'),
    );
    expect(await screen.findByText('Échec : Réponse HTTP 404')).toBeTruthy();
  });
});
