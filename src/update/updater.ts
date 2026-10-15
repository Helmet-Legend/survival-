/**
 * Mises à jour de l'application depuis les versions publiées sur GitHub.
 *
 * Chaque fusion dans `main` publie une Release `v0.1.<n>` contenant l'APK,
 * où `<n>` est aussi le `versionCode` Android. Au démarrage (et au retour
 * dans l'application), on compare ce numéro à celui de la version installée.
 * L'installation passe par l'installateur Android, qui demande confirmation
 * et refuse tout APK signé avec une autre clé.
 *
 * Sans réseau, la vérification échoue en silence : l'application reste
 * pleinement utilisable hors-ligne.
 */
import { NativeModules, Platform } from 'react-native';

export const LATEST_RELEASE_URL =
  'https://api.github.com/repos/Helmet-Legend/survival-/releases/latest';

const CHECK_TIMEOUT_MS = 10_000;

export interface AvailableUpdate {
  versionCode: number;
  versionName: string;
  apkUrl: string;
  notes: string;
}

export interface Updater {
  /** Mise à jour plus récente que la version installée, ou null. */
  check(): Promise<AvailableUpdate | null>;
  /** Télécharge l'APK et ouvre l'installateur Android. */
  install(update: AvailableUpdate): Promise<void>;
}

const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;

/** Lit la réponse de l'API GitHub « latest release ». */
export function parseRelease(json: unknown): AvailableUpdate | null {
  if (typeof json !== 'object' || json === null) {
    return null;
  }
  const release = json as {
    tag_name?: unknown;
    body?: unknown;
    assets?: Array<{ name?: unknown; browser_download_url?: unknown }>;
  };
  const tag = typeof release.tag_name === 'string' ? release.tag_name : '';
  const match = TAG_RE.exec(tag);
  if (match === null) {
    return null;
  }
  const apk = (release.assets ?? []).find(
    asset =>
      typeof asset.name === 'string' &&
      asset.name.endsWith('.apk') &&
      typeof asset.browser_download_url === 'string',
  );
  if (apk === undefined) {
    return null;
  }
  return {
    // Convention de publication : le dernier nombre est le versionCode.
    versionCode: Number(match[3]),
    versionName: tag.slice(1),
    apkUrl: apk.browser_download_url as string,
    notes: typeof release.body === 'string' ? release.body : '',
  };
}

interface NativeUpdateModule {
  getVersionCode(): Promise<number>;
  downloadAndInstall(url: string): Promise<boolean>;
}

/** Module natif Android (absent sur iOS, dans les tests et l'aperçu web). */
function nativeModule(): NativeUpdateModule | null {
  if (Platform.OS !== 'android') {
    return null;
  }
  return (
    (NativeModules.ResiliosUpdate as NativeUpdateModule | undefined) ?? null
  );
}

async function fetchLatestRelease(): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('Délai dépassé')),
      CHECK_TIMEOUT_MS,
    );
  });
  try {
    const response = await Promise.race([
      fetch(LATEST_RELEASE_URL, {
        headers: { Accept: 'application/vnd.github+json' },
      }),
      timeout,
    ]);
    return response.ok ? await response.json() : null;
  } finally {
    clearTimeout(timer);
  }
}

export function createGithubUpdater(
  deps: {
    native?: NativeUpdateModule | null;
    fetchRelease?: () => Promise<unknown>;
  } = {},
): Updater {
  const native = deps.native === undefined ? nativeModule() : deps.native;
  const fetchRelease = deps.fetchRelease ?? fetchLatestRelease;
  return {
    async check() {
      if (native === null) {
        return null;
      }
      try {
        const [installed, latest] = await Promise.all([
          native.getVersionCode(),
          fetchRelease().then(parseRelease),
        ]);
        return latest !== null && latest.versionCode > installed
          ? latest
          : null;
      } catch {
        // Hors-ligne ou GitHub injoignable : on réessaiera plus tard.
        return null;
      }
    },
    async install(update) {
      if (native === null) {
        throw new Error('Mise à jour impossible sur cet appareil');
      }
      await native.downloadAndInstall(update.apkUrl);
    },
  };
}
