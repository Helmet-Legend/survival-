/**
 * Démo web jouable de ResiliOS. L'interface est propre à la démo ; tout le
 * reste (coffre, mode sous contrainte, schéma, inventaire, calculs,
 * conversions, recherche) est le code de `src/`, exécuté tel quel.
 */
import { CryptoError } from '../../src/crypto/errors';
import { systemRandom } from '../../src/crypto/native/random';
import { SLOT_FILE_NAMES } from '../../src/crypto/params';
import { VaultKeyManager } from '../../src/crypto/VaultKeyManager';
import { searchGuides } from '../../src/db/guides';
import {
  distanceAndBearing,
  formatLatLon,
  formatMgrs,
  formatUtm,
  GeoError,
  latLonToMgrs,
  latLonToUtm,
  mgrsToLatLon,
  trueToGrid,
  trueToMagnetic,
  type MgrsDigits,
} from '../../src/geo/geoConverter';
import {
  InventoryError,
  InventoryRepository,
  ITEM_CATEGORIES,
  ITEM_UNITS,
  seedDecoyInventory,
  type ItemCategory,
  type ItemUnit,
} from '../../src/inventory';
import { addDays, daysBetween, localToday } from '../../src/lib/dates';
import {
  getExpiryAlerts,
  getResilienceReport,
  loadHousehold,
  saveHousehold,
  type ExpiryBucket,
} from '../../src/resilience/resilienceCalculator';
import { createVault, openVault, type VaultContent } from '../../src/vault';
import {
  BrowserVaultDb,
  DEMO_ARGON2_PARAMS,
  jsArgon2,
  loadSqlite,
  MemoryDriver,
  MemoryStore,
} from './adapters';
import {
  DURESS_PIN,
  MASTER_PIN,
  SAMPLE_GUIDES,
  seedRealVault,
} from './sampleData';

declare global {
  interface Window {
    __RESILIOS_WASM__: string;
  }
}

// --- Libellés ---------------------------------------------------------------

const CATEGORY_LABELS: Record<ItemCategory, string> = {
  water: 'Eau',
  food: 'Vivres',
  medical: 'Santé',
  energy: 'Énergie',
  tool: 'Outils',
};
const UNIT_LABELS: Record<ItemUnit, string> = {
  L: 'L',
  mL: 'mL',
  kg: 'kg',
  g: 'g',
  unit: 'pièce(s)',
};
const BUCKET_LABELS: Record<ExpiryBucket, string> = {
  expired: 'Périmé',
  within30: '≤ 30 j',
  within60: '≤ 60 j',
  within90: '≤ 90 j',
  watch: 'Seuil perso',
};

const num = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const int = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function frDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function relDays(days: number): string {
  if (days < 0) {
    return `périmé depuis ${-days} j`;
  }
  if (days === 0) {
    return 'dernier jour';
  }
  return `dans ${days} j`;
}

// --- État -------------------------------------------------------------------

type Tab = 'autonomy' | 'stock' | 'coords' | 'guides';

interface UiState {
  phase: 'boot' | 'locked' | 'unlocking' | 'open';
  pin: string;
  lockMessage: string;
  lockTone: 'info' | 'error';
  tab: Tab;
  db: BrowserVaultDb | null;
  repo: InventoryRepository | null;
  flash: string;
  flashTone: 'ok' | 'error';
  stockFilter: ItemCategory | 'all';
  expanded: string | null;
  showAddForm: boolean;
  confirmDiscard: boolean;
  guideSlug: string | null;
}

const state: UiState = {
  phase: 'boot',
  pin: '',
  lockMessage: '',
  lockTone: 'info',
  tab: 'autonomy',
  db: null,
  repo: null,
  flash: '',
  flashTone: 'ok',
  stockFilter: 'all',
  expanded: null,
  showAddForm: false,
  confirmDiscard: false,
  guideSlug: null,
};

const coords = {
  lat: '45.83265',
  lon: '6.86518',
  digits: 5 as MgrsDigits,
  target: '',
  declination: '2.5',
};

const app = document.getElementById('app') as HTMLElement;
const backstage = document.getElementById('backstage') as HTMLElement;

const content: VaultContent = {
  guides: SAMPLE_GUIDES,
  seedDecoy: db => seedDecoyInventory(db),
};

let manager: VaultKeyManager<BrowserVaultDb>;
let driver: MemoryDriver;
let store: MemoryStore;
let realFile = '';
let lockTimer: number | undefined;

const backstageLog: string[] = [];

// --- Démarrage --------------------------------------------------------------

async function boot(): Promise<void> {
  render();
  const sqlite3 = await loadSqlite(window.__RESILIOS_WASM__);
  driver = new MemoryDriver(sqlite3);
  store = new MemoryStore();
  manager = new VaultKeyManager<BrowserVaultDb>({
    argon2: jsArgon2,
    random: systemRandom,
    store,
    driver,
    argon2Params: DEMO_ARGON2_PARAMS,
  });

  const primary = await createVault(manager, content, {
    masterPin: MASTER_PIN,
    duressPin: DURESS_PIN,
  });
  realFile = primary.fileName;
  await seedRealVault(primary);
  primary.close();

  coords.target = formatMgrs(
    latLonToMgrs({ latitude: 45.92375, longitude: 6.86933 }),
  );
  backstageLog.push(
    `Coffre créé : deux bases (${SLOT_FILE_NAMES.join(
      ', ',
    )}). Le vrai coffre a été tiré au sort : ${realFile}.`,
  );
  state.phase = 'locked';
  render();
}

// --- Verrouillage -----------------------------------------------------------

function pressKey(key: string): void {
  if (state.phase !== 'locked') {
    return;
  }
  if (key === 'back') {
    state.pin = state.pin.slice(0, -1);
  } else if (key === 'ok') {
    void unlock();
    return;
  } else if (state.pin.length < 12) {
    state.pin += key;
  }
  if (state.lockTone === 'error' && lockTimer === undefined) {
    state.lockMessage = '';
  }
  render();
}

async function unlock(): Promise<void> {
  if (state.pin.length === 0) {
    return;
  }
  const pin = state.pin;
  state.phase = 'unlocking';
  state.lockMessage = 'Dérivation des clés…';
  state.lockTone = 'info';
  render();
  await new Promise(r => setTimeout(r, 30)); // laisse le navigateur peindre

  const started = performance.now();
  driver.lastOpened = null;
  try {
    const db = await openVault(manager, content, pin);
    const ms = Math.round(performance.now() - started);
    const which = db.fileName === realFile ? 'vrai coffre' : 'leurre';
    backstageLog.push(
      `Code accepté en ${ms} ms → ${db.fileName} (${which}). Deux clés dérivées, deux ouvertures tentées.`,
    );
    state.db = db;
    state.repo = new InventoryRepository(db);
    state.phase = 'open';
    state.pin = '';
    state.lockMessage = '';
    state.tab = 'autonomy';
    state.flash = '';
    state.expanded = null;
    state.guideSlug = null;
    render();
  } catch (error) {
    const ms = Math.round(performance.now() - started);
    state.phase = 'locked';
    state.pin = '';
    state.lockTone = 'error';
    if (error instanceof CryptoError && error.code === 'INVALID_PIN') {
      backstageLog.push(
        `Code refusé en ${ms} ms (même travail qu'un code valide).`,
      );
      state.lockMessage = 'Code incorrect';
      if (error.retryAt !== undefined) {
        startLockCountdown(error.retryAt);
      }
    } else if (error instanceof CryptoError && error.code === 'LOCKED_OUT') {
      startLockCountdown(error.retryAt ?? Date.now());
    } else {
      state.lockMessage =
        error instanceof Error ? error.message : String(error);
    }
    render();
  }
}

function startLockCountdown(retryAt: number): void {
  window.clearInterval(lockTimer);
  const tick = () => {
    const left = Math.ceil((retryAt - Date.now()) / 1000);
    if (left <= 0) {
      window.clearInterval(lockTimer);
      lockTimer = undefined;
      state.lockMessage = 'Vous pouvez réessayer.';
      state.lockTone = 'info';
    } else {
      state.lockMessage = `Trop d'essais. Réessayez dans ${left} s.`;
      state.lockTone = 'error';
    }
    if (state.phase === 'locked') {
      renderLock();
    }
  };
  lockTimer = window.setInterval(tick, 1000);
  tick();
}

function lock(): void {
  state.db?.close();
  state.db = null;
  state.repo = null;
  state.phase = 'locked';
  state.lockMessage = 'Coffre verrouillé.';
  state.lockTone = 'info';
  render();
}

// --- Rendu ------------------------------------------------------------------

function render(): void {
  renderBackstage();
  if (state.phase === 'boot') {
    app.innerHTML = `<div class="boot" role="status"><span class="brand">ResiliOS</span><span>Préparation du coffre…</span></div>`;
    return;
  }
  if (state.phase !== 'open') {
    renderLock();
    return;
  }
  void renderOpen();
}

function renderLock(): void {
  const slots = Math.max(6, state.pin.length);
  const dots = Array.from(
    { length: slots },
    (_, i) => `<span class="dot${i < state.pin.length ? ' on' : ''}"></span>`,
  ).join('');
  const busy = state.phase === 'unlocking';
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'];
  app.innerHTML = `
    <div class="lock">
      <div class="lock-head">
        <span class="brand">ResiliOS</span>
        <span class="lock-sub">Saisissez votre code</span>
      </div>
      <div class="dots" aria-label="${
        state.pin.length
      } chiffres saisis">${dots}</div>
      <p class="lock-msg ${
        state.lockTone
      }" role="status" aria-live="polite">${esc(state.lockMessage)}</p>
      <div class="keypad">
        ${keys
          .map(k => {
            const label = k === 'back' ? '⌫' : k === 'ok' ? 'OK' : k;
            const aria =
              k === 'back'
                ? 'Effacer'
                : k === 'ok'
                ? 'Valider'
                : `Chiffre ${k}`;
            return `<button class="key${k === 'ok' ? ' key-ok' : ''}${
              k === 'back' ? ' key-fn' : ''
            }" data-key="${k}" aria-label="${aria}" ${
              busy ? 'disabled' : ''
            }>${label}</button>`;
          })
          .join('')}
      </div>
    </div>`;
}

async function renderOpen(): Promise<void> {
  const tabs: Array<[Tab, string]> = [
    ['autonomy', 'Autonomie'],
    ['stock', 'Stock'],
    ['coords', 'Coordonnées'],
    ['guides', 'Fiches'],
  ];
  let body = '';
  try {
    if (state.tab === 'autonomy') {
      body = await autonomyView();
    } else if (state.tab === 'stock') {
      body = await stockView();
    } else if (state.tab === 'coords') {
      body = coordsView();
    } else {
      body = await guidesView();
    }
  } catch (error) {
    body = `<p class="error-box">${esc(
      error instanceof Error ? error.message : error,
    )}</p>`;
  }
  const flashHtml = state.flash
    ? `<p class="flash ${state.flashTone}" role="status">${esc(
        state.flash,
      )}</p>`
    : '';
  app.innerHTML = `
    <div class="shell">
      <header class="bar">
        <span class="brand">ResiliOS</span>
        <button class="ghost" data-action="lock">Verrouiller</button>
      </header>
      <main class="screen" id="screen">${flashHtml}${body}</main>
      <nav class="tabs" aria-label="Sections">
        ${tabs
          .map(
            ([id, label]) =>
              `<button class="tab${
                state.tab === id ? ' active' : ''
              }" data-tab="${id}" ${
                state.tab === id ? 'aria-current="page"' : ''
              }>${label}</button>`,
          )
          .join('')}
      </nav>
    </div>`;
  if (state.tab === 'coords') {
    updateCoords();
  }
}

// --- Autonomie --------------------------------------------------------------

async function autonomyView(): Promise<string> {
  const db = state.db as BrowserVaultDb;
  const today = localToday();
  const [report, alerts] = await Promise.all([
    getResilienceReport(db, today),
    getExpiryAlerts(db, today),
  ]);
  const limiting = report.limitingFactor === 'water' ? "l'eau" : 'les vivres';
  const scale = Math.max(report.water.naiveDays, report.food.naiveDays, 1);
  const resource = (
    label: string,
    r: typeof report.water,
    unit: string,
    fmt: (n: number) => string,
  ) => `
    <div class="res">
      <div class="res-head"><span class="label">${label}</span><span class="res-days">${
    r.days
  } j</span></div>
      <div class="gauge" aria-hidden="true">
        <span class="gauge-naive" style="width:${
          (r.naiveDays / scale) * 100
        }%"></span>
        <span class="gauge-real" style="width:${
          (r.days / scale) * 100
        }%"></span>
      </div>
      <dl class="facts">
        <div><dt>Disponible</dt><dd>${fmt(r.available)} ${unit}</dd></div>
        <div><dt>Besoin du foyer</dt><dd>${fmt(
          r.dailyNeed,
        )} ${unit}/j</dd></div>
        <div><dt>Formule simple</dt><dd>${num.format(r.naiveDays)} j</dd></div>
        <div><dt>Perdu (péremption)</dt><dd>${fmt(r.wasted)} ${unit}</dd></div>
      </dl>
    </div>`;

  const alertRows = alerts.length
    ? alerts
        .map(
          a => `<li class="alert">
            <span class="chip ${a.bucket}">${BUCKET_LABELS[a.bucket]}</span>
            <span class="alert-name">${esc(a.itemName)}${
            a.isCritical
              ? ' <span class="crit" title="Article critique">●</span>'
              : ''
          }</span>
            <span class="alert-meta">${num.format(a.quantity)} ${
            UNIT_LABELS[a.unit]
          } · ${relDays(a.daysLeft)}</span>
          </li>`,
        )
        .join('')
    : '<li class="empty">Aucune péremption dans les 90 prochains jours.</li>';

  return `
    <section class="readout">
      <p class="label">Autonomie du foyer</p>
      <p class="big"><span class="big-n">${
        report.days
      }</span><span class="big-u">jours</span></p>
      <p class="readout-sub">Limitée par ${limiting}. Stock épuisé le ${frDate(
    addDays(today, report.days),
  )}.</p>
    </section>
    <div class="household">
      <span class="label">Foyer</span>
      <div class="stepper">
        <button class="step" data-action="members" data-delta="-1" aria-label="Retirer une personne" ${
          report.household.members <= 1 ? 'disabled' : ''
        }>−</button>
        <span class="step-v">${report.household.members} pers.</span>
        <button class="step" data-action="members" data-delta="1" aria-label="Ajouter une personne" ${
          report.household.members >= 12 ? 'disabled' : ''
        }>+</button>
      </div>
    </div>
    ${resource('Eau', report.water, 'L', n => num.format(n))}
    ${resource('Vivres', report.food, 'kcal', n => int.format(n))}
    <p class="legend"><span class="sw sw-real"></span>autonomie réelle <span class="sw sw-naive"></span>formule simple (sans les péremptions)</p>
    <section>
      <h2 class="h">Péremptions</h2>
      <ul class="alerts">${alertRows}</ul>
    </section>`;
}

// --- Stock ------------------------------------------------------------------

async function stockView(): Promise<string> {
  const repo = state.repo as InventoryRepository;
  const items = await repo.listItems(
    state.stockFilter === 'all' ? {} : { category: state.stockFilter },
  );
  const today = localToday();
  const all = await repo.listItems();
  const expiredLots = all.reduce(
    (n, i) => n + (i.totalQuantity > i.usableQuantity ? 1 : 0),
    0,
  );

  const filters: Array<[ItemCategory | 'all', string]> = [
    ['all', 'Tout'],
    ...ITEM_CATEGORIES.map(
      c => [c, CATEGORY_LABELS[c]] as [ItemCategory, string],
    ),
  ];

  let detail = '';
  if (state.expanded !== null) {
    const { item, lots } = await repo.getItem(state.expanded);
    detail = `
      <div class="detail">
        <ul class="lots">
          ${
            lots
              .map(
                l => `<li class="${l.isExpired ? 'lot expired' : 'lot'}">
                <span>${num.format(l.quantity)} ${UNIT_LABELS[item.unit]}</span>
                <span class="lot-exp">${
                  l.expirationDate
                    ? `${l.isExpired ? 'périmé le' : 'jusqu’au'} ${frDate(
                        l.expirationDate,
                      )}`
                    : 'non périssable'
                }</span>
              </li>`,
              )
              .join('') || '<li class="empty">Aucun lot.</li>'
          }
        </ul>
        <form class="consume" data-form="consume" data-item="${esc(item.id)}">
          <label for="consume-qty">Consommer</label>
          <input id="consume-qty" name="qty" type="number" inputmode="decimal" step="any" min="0" placeholder="Quantité" required>
          <span class="unit">${UNIT_LABELS[item.unit]}</span>
          <button class="primary" type="submit">Retirer</button>
        </form>
        <p class="hint">Le lot qui périme le plus tôt est entamé en premier.</p>
      </div>`;
  }

  const rows = items
    .map(i => {
      const open = state.expanded === i.id;
      const exp =
        i.nextExpiration === null
          ? ''
          : `<span class="row-exp">${relDays(
              daysBetween(today, i.nextExpiration),
            )}</span>`;
      return `<li class="row${open ? ' open' : ''}">
        <button class="row-btn" data-item="${esc(
          i.id,
        )}" aria-expanded="${open}">
          <span class="row-main">
            <span class="row-name">${esc(i.name)}${
        i.isCritical
          ? ' <span class="crit" title="Article critique">●</span>'
          : ''
      }</span>
            <span class="row-sub">${CATEGORY_LABELS[i.category]}${
        i.location ? ` · ${esc(i.location)}` : ''
      }</span>
          </span>
          <span class="row-side">
            <span class="row-qty">${num.format(i.usableQuantity)} <small>${
        UNIT_LABELS[i.unit]
      }</small></span>
            ${exp}
          </span>
        </button>
        ${open ? detail : ''}
      </li>`;
    })
    .join('');

  const discard = state.confirmDiscard
    ? `<div class="confirm" role="alert">
         <span>Supprimer définitivement les lots périmés ?</span>
         <button class="danger" data-action="discard-yes">Jeter</button>
         <button class="ghost" data-action="discard-no">Annuler</button>
       </div>`
    : '';

  return `
    <div class="chips" role="group" aria-label="Filtrer par catégorie">
      ${filters
        .map(
          ([id, label]) =>
            `<button class="filter${
              state.stockFilter === id ? ' active' : ''
            }" data-filter="${id}" aria-pressed="${
              state.stockFilter === id
            }">${label}</button>`,
        )
        .join('')}
    </div>
    <div class="actions">
      <button class="ghost" data-action="toggle-add">${
        state.showAddForm ? 'Fermer' : '+ Ajouter un article'
      }</button>
      <button class="ghost" data-action="discard" ${
        expiredLots === 0 ? 'disabled' : ''
      }>Jeter les périmés</button>
    </div>
    ${discard}
    ${state.showAddForm ? addFormView() : ''}
    <ul class="rows">${
      rows || '<li class="empty">Aucun article dans cette catégorie.</li>'
    }</ul>`;
}

function addFormView(): string {
  return `
    <form class="add" data-form="add">
      <div class="field wide"><label for="add-name">Nom</label><input id="add-name" name="name" required maxlength="120" placeholder="Ex. Flocons d’avoine"></div>
      <div class="field"><label for="add-category">Catégorie</label><select id="add-category" name="category">${ITEM_CATEGORIES.map(
        c =>
          `<option value="${c}"${c === 'food' ? ' selected' : ''}>${
            CATEGORY_LABELS[c]
          }</option>`,
      ).join('')}</select></div>
      <div class="field"><label for="add-unit">Unité</label><select id="add-unit" name="unit">${ITEM_UNITS.map(
        u =>
          `<option value="${u}"${u === 'kg' ? ' selected' : ''}>${
            UNIT_LABELS[u]
          }</option>`,
      ).join('')}</select></div>
      <div class="field"><label for="add-qty">Quantité</label><input id="add-qty" name="qty" type="number" inputmode="decimal" step="any" min="0" required placeholder="2"></div>
      <div class="field"><label for="add-kcal">kcal par unité</label><input id="add-kcal" name="kcal" type="number" inputmode="numeric" step="1" min="0" placeholder="3700"></div>
      <div class="field wide"><label for="add-exp">À consommer avant le</label><input id="add-exp" name="exp" type="date"></div>
      <button class="primary wide" type="submit">Ajouter au stock</button>
    </form>`;
}

// --- Coordonnées -------------------------------------------------------------

function coordsView(): string {
  return `
    <section class="panel">
      <h2 class="h">Position</h2>
      <div class="grid2">
        <div class="field"><label for="c-lat">Latitude</label><input id="c-lat" data-coord="lat" inputmode="decimal" value="${esc(
          coords.lat,
        )}"></div>
        <div class="field"><label for="c-lon">Longitude</label><input id="c-lon" data-coord="lon" inputmode="decimal" value="${esc(
          coords.lon,
        )}"></div>
      </div>
      <div class="field"><label for="c-digits">Précision MGRS</label>
        <select id="c-digits" data-coord="digits">${[5, 4, 3, 2, 1]
          .map(
            d =>
              `<option value="${d}"${coords.digits === d ? ' selected' : ''}>${
                ['', '10 km', '1 km', '100 m', '10 m', '1 m'][d]
              }</option>`,
          )
          .join('')}</select>
      </div>
      <div id="c-out" class="readings" aria-live="polite"></div>
    </section>
    <section class="panel">
      <h2 class="h">Aller vers</h2>
      <div class="field"><label for="c-target">Point d’arrivée (MGRS)</label><input id="c-target" data-coord="target" autocapitalize="characters" spellcheck="false" value="${esc(
        coords.target,
      )}"></div>
      <div class="field"><label for="c-decl">Déclinaison magnétique (° Est, lue sur la carte)</label><input id="c-decl" data-coord="declination" inputmode="decimal" value="${esc(
        coords.declination,
      )}"></div>
      <div id="c-nav" class="readings" aria-live="polite"></div>
    </section>`;
}

function parseNumber(text: string): number {
  return Number(text.trim().replace(',', '.'));
}

function reading(label: string, value: string, mono = true): string {
  return `<div class="reading"><span class="label">${label}</span><span class="${
    mono ? 'mono' : ''
  }">${value}</span></div>`;
}

function updateCoords(): void {
  const out = document.getElementById('c-out');
  const nav = document.getElementById('c-nav');
  if (!out || !nav) {
    return;
  }
  const lat = parseNumber(coords.lat);
  const lon = parseNumber(coords.lon);
  let here: { latitude: number; longitude: number } | null = null;
  try {
    if (coords.lat.trim() === '' || coords.lon.trim() === '') {
      throw new Error('Saisissez une latitude et une longitude.');
    }
    here = { latitude: lat, longitude: lon };
    const utm = latLonToUtm(here);
    out.innerHTML = [
      reading('MGRS', esc(formatMgrs(latLonToMgrs(here, coords.digits)))),
      reading('UTM', esc(formatUtm(utm))),
      reading('DMS', esc(formatLatLon(here, 'dms'))),
      reading('Deg. min.', esc(formatLatLon(here, 'dm'))),
      reading(
        'Convergence',
        `${num.format(
          utm.convergence,
        )}° <small>(nord carte / nord vrai)</small>`,
      ),
    ].join('');
  } catch (error) {
    here = null;
    out.innerHTML = `<p class="error-box">${esc(geoMessage(error))}</p>`;
  }

  try {
    if (here === null) {
      throw new Error('Position de départ invalide.');
    }
    const target = mgrsToLatLon(coords.target);
    const { distance, bearing } = distanceAndBearing(here, target);
    const decl = parseNumber(coords.declination || '0');
    if (!Number.isFinite(decl)) {
      throw new Error('Déclinaison invalide.');
    }
    const utm = latLonToUtm(here);
    nav.innerHTML = [
      reading('Arrivée', esc(formatLatLon(target, 'dms'))),
      reading(
        'Distance',
        distance >= 1000
          ? `${num.format(distance / 1000)} km`
          : `${int.format(distance)} m`,
      ),
      reading('Azimut vrai', `${int.format(bearing)}°`),
      reading(
        'Gisement carte',
        `${int.format(trueToGrid(bearing, utm.convergence))}°`,
      ),
      reading(
        'Cap boussole',
        `<strong>${int.format(trueToMagnetic(bearing, decl))}°</strong>`,
      ),
    ].join('');
  } catch (error) {
    nav.innerHTML = `<p class="error-box">${esc(geoMessage(error))}</p>`;
  }
}

function geoMessage(error: unknown): string {
  if (error instanceof GeoError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

// --- Fiches -----------------------------------------------------------------

async function guidesView(): Promise<string> {
  const db = state.db as BrowserVaultDb;
  if (state.guideSlug !== null) {
    const { rows } = await db.execute(
      'SELECT title, category, body FROM survival_guides WHERE slug = ?',
      [state.guideSlug],
    );
    const g = rows[0];
    const lines = String(g.body).split('\n');
    let html = '';
    let inList = false;
    for (const line of lines) {
      if (line.startsWith('- ')) {
        html += `${inList ? '' : '<ul>'}<li>${esc(line.slice(2))}</li>`;
        inList = true;
      } else {
        html += `${inList ? '</ul>' : ''}<p>${esc(line)}</p>`;
        inList = false;
      }
    }
    html += inList ? '</ul>' : '';
    return `
      <button class="ghost back" data-action="guide-back">← Toutes les fiches</button>
      <article class="guide">
        <p class="label">${esc(g.category)}</p>
        <h2 class="guide-title">${esc(g.title)}</h2>
        ${html}
      </article>`;
  }
  return `
    <div class="field"><label for="g-search">Rechercher</label>
      <input id="g-search" type="search" placeholder="garrot, eau, hypothermie…" autocomplete="off">
    </div>
    <ul id="g-results" class="guide-list">${await guideResults('')}</ul>
    <p class="hint">Fiches d’exemple, non validées par un professionnel de santé.</p>`;
}

async function guideResults(query: string): Promise<string> {
  const db = state.db as BrowserVaultDb;
  if (query.trim() === '') {
    const { rows } = await db.execute(
      'SELECT slug, title, category FROM survival_guides ORDER BY title',
    );
    return rows
      .map(
        r =>
          `<li><button class="guide-btn" data-guide="${esc(
            r.slug,
          )}"><span class="label">${esc(r.category)}</span><span>${esc(
            r.title,
          )}</span></button></li>`,
      )
      .join('');
  }
  const hits = await searchGuides(db, query);
  if (hits.length === 0) {
    return '<li class="empty">Aucune fiche ne correspond.</li>';
  }
  return hits
    .map(h => {
      const snippet = esc(h.snippet)
        .replace(/\[/g, '<mark>')
        .replace(/\]/g, '</mark>');
      return `<li><button class="guide-btn" data-guide="${esc(
        h.slug,
      )}"><span class="label">${esc(h.category)}</span><span>${esc(
        h.title,
      )}</span><span class="snippet">${snippet}</span></button></li>`;
    })
    .join('');
}

// --- Coulisses --------------------------------------------------------------

function renderBackstage(): void {
  let vault = '';
  try {
    const raw = store?.value;
    if (raw) {
      const s = JSON.parse(raw) as {
        failedAttempts: number;
        lockedUntil: number;
      };
      vault = `<p class="bs-state">Essais ratés consécutifs : <b>${
        s.failedAttempts
      }</b>${
        s.lockedUntil > Date.now()
          ? ` · bloqué jusqu’à ${new Date(s.lockedUntil).toLocaleTimeString(
              'fr-FR',
            )}`
          : ''
      }</p>`;
    }
  } catch {
    vault = '';
  }
  backstage.innerHTML = `${vault}<ol class="bs-log">${backstageLog
    .slice(-6)
    .map(l => `<li>${esc(l)}</li>`)
    .join('')}</ol>`;
}

// --- Événements -------------------------------------------------------------

function flash(message: string, tone: 'ok' | 'error' = 'ok'): void {
  state.flash = message;
  state.flashTone = tone;
}

app.addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest('button');
  if (!target || target.disabled) {
    return;
  }
  const { key, tab, action, item, filter, guide } = target.dataset;
  if (key) {
    pressKey(key);
    return;
  }
  if (tab) {
    state.tab = tab as Tab;
    state.flash = '';
    state.guideSlug = null;
    render();
    return;
  }
  if (filter) {
    state.stockFilter = filter as UiState['stockFilter'];
    state.expanded = null;
    render();
    return;
  }
  if (item) {
    state.expanded = state.expanded === item ? null : item;
    state.flash = '';
    render();
    return;
  }
  if (guide) {
    state.guideSlug = guide;
    render();
    return;
  }
  void handleAction(action, target);
});

async function handleAction(
  action: string | undefined,
  button: HTMLButtonElement,
): Promise<void> {
  const db = state.db;
  const repo = state.repo;
  switch (action) {
    case 'lock':
      lock();
      return;
    case 'members': {
      if (!db) {
        return;
      }
      const household = await loadHousehold(db);
      household.members += Number(button.dataset.delta);
      await saveHousehold(db, household);
      render();
      return;
    }
    case 'toggle-add':
      state.showAddForm = !state.showAddForm;
      state.flash = '';
      render();
      return;
    case 'discard':
      state.confirmDiscard = true;
      render();
      return;
    case 'discard-no':
      state.confirmDiscard = false;
      render();
      return;
    case 'discard-yes': {
      const removed = await (repo as InventoryRepository).discardExpired();
      state.confirmDiscard = false;
      flash(`${removed.length} lot(s) périmé(s) jeté(s).`);
      render();
      return;
    }
    case 'guide-back':
      state.guideSlug = null;
      render();
      return;
  }
}

app.addEventListener('submit', event => {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  void handleSubmit(form);
});

async function handleSubmit(form: HTMLFormElement): Promise<void> {
  const repo = state.repo as InventoryRepository;
  const data = new FormData(form);
  try {
    if (form.dataset.form === 'consume') {
      const itemId = form.dataset.item as string;
      const qty = parseNumber(String(data.get('qty') ?? ''));
      const { item } = await repo.getItem(itemId);
      const result = await repo.consume(itemId, qty);
      const parts = result.taken.map(
        t =>
          `${num.format(t.quantity)} ${UNIT_LABELS[item.unit]} ${
            t.expirationDate
              ? `du lot du ${frDate(t.expirationDate)}`
              : 'du lot non périssable'
          }`,
      );
      flash(
        `Retiré : ${parts.join(', ')}. Reste ${num.format(result.remaining)} ${
          UNIT_LABELS[item.unit]
        }.`,
      );
    } else if (form.dataset.form === 'add') {
      const kcal = String(data.get('kcal') ?? '').trim();
      const exp = String(data.get('exp') ?? '').trim();
      const created = await repo.createItem(
        {
          name: String(data.get('name') ?? ''),
          category: String(data.get('category')) as ItemCategory,
          unit: String(data.get('unit')) as ItemUnit,
          caloriesPerUnit: kcal === '' ? null : Number(kcal),
        },
        {
          quantity: parseNumber(String(data.get('qty') ?? '')),
          expirationDate: exp === '' ? null : exp,
        },
      );
      state.showAddForm = false;
      state.stockFilter = 'all';
      state.expanded = created.id;
      flash(`« ${created.name} » ajouté au stock.`);
    }
  } catch (error) {
    if (error instanceof InventoryError) {
      flash(error.message, 'error');
    } else {
      flash(error instanceof Error ? error.message : String(error), 'error');
    }
  }
  render();
}

app.addEventListener('input', event => {
  const el = event.target as HTMLInputElement | HTMLSelectElement;
  const field = el.dataset.coord as keyof typeof coords | undefined;
  if (field) {
    if (field === 'digits') {
      coords.digits = Number(el.value) as MgrsDigits;
    } else {
      coords[field] = el.value;
    }
    updateCoords();
    return;
  }
  if (el.id === 'g-search') {
    const query = el.value;
    void guideResults(query).then(html => {
      const list = document.getElementById('g-results');
      if (
        list &&
        (document.getElementById('g-search') as HTMLInputElement)?.value ===
          query
      ) {
        list.innerHTML = html;
      }
    });
  }
});

document.querySelectorAll<HTMLButtonElement>('[data-fill]').forEach(button => {
  button.addEventListener('click', () => {
    if (state.phase !== 'locked' || lockTimer !== undefined) {
      return;
    }
    state.pin = button.dataset.fill ?? '';
    state.lockMessage = '';
    render();
  });
});

document.addEventListener('keydown', event => {
  if (state.phase !== 'locked') {
    return;
  }
  if (/^[0-9]$/.test(event.key)) {
    pressKey(event.key);
  } else if (event.key === 'Backspace') {
    pressKey('back');
  } else if (event.key === 'Enter') {
    pressKey('ok');
  }
});

boot().catch(error => {
  app.innerHTML = `<p class="error-box">Impossible de démarrer la démo : ${esc(
    error instanceof Error ? error.message : error,
  )}</p>`;
});
