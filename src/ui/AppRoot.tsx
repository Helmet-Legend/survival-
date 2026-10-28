/**
 * Racine de l'application : premier lancement, verrouillage, coffre ouvert.
 *
 * Sécurité et sobriété (cahier des charges §4.6) :
 * - le coffre se verrouille dès que l'application passe en arrière-plan :
 *   la base est fermée, aucun calcul ni minuterie ne continue. Seules
 *   exceptions : une photo, et un appel ou un SMS lancé depuis l'Urgence
 *   (le coffre se verrouille alors après 2 minutes hors de l'application) ;
 * - l'écran de verrouillage ouvre une « Urgence sans code » qui n'affiche
 *   aucune donnée du coffre ;
 * - pendant la transition (sélecteur d'applications iOS), un écran noir
 *   masque le contenu pour que l'aperçu système ne le capture pas.
 */
import { Lock, Settings } from 'lucide-react-native';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AppState,
  Image,
  type ImageSourcePropType,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { VaultKeyManager } from '../crypto/VaultKeyManager';
import {
  ArmoryRepository,
  BagRepository,
  BoxRepository,
  DocumentRepository,
  InventoryRepository,
  PhotoRepository,
} from '../inventory';
import { nativeFiles, type FileAccess } from '../device/files';
import { nativeCompass, type CompassSource } from '../device/compass';
import { nativeTorch, type TorchSignal } from '../device/torch';
import { nativeLocation, type LocationSource } from '../device/location';
import { nativeTileFetch } from '../device/tileFetch';
import { MapTileStore, type TileFetch } from '../geo/tiles';
import { WaypointRepository } from '../geo/waypoints';
import { nativeReminders } from '../device/reminders';
import {
  nativeScreenCapture,
  type ScreenCaptureSetting,
} from '../device/screenCapture';
import { syncReminders, type ReminderScheduler } from '../resilience/reminders';
import {
  isAwayForPhoto,
  nativePhotoSource,
  type PhotoSource,
} from '../photo/photoSource';
import { defaultAlertFetch, type AlertFetch } from '../alerts/types';
import { defaultProductFetch } from '../scanner/fetch';
import type { ProductFetch } from '../scanner/products';
import { nativeScanSource, type ScanSource } from '../scanner/scanSource';
import { nativeNetwork, type LocalNetwork } from '../device/net';
import { systemRandom } from '../crypto/native/random';
import type { Updater } from '../update/updater';
import type { CrisisId } from '../plan/crisis';
import {
  createVault,
  openVault,
  type VaultContent,
  type VaultDatabase,
} from '../vault';
import { AppIcon } from './components/AppIcon';
import { BottomNav } from './components/BottomNav';
import { HomeBackdrop } from './components/HomeBackdrop';
import { Brand, Button, IconButton } from './components/controls';
import { UpdateBanner } from './components/UpdateBanner';
import {
  NavigationContext,
  type Navigation,
  type Overlay,
  type StockFocus,
  type StockFormTarget,
  type Tab,
  backLabelFor,
} from './navigation';
import { CalculatorsScreen } from './screens/CalculatorsScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { HouseholdScreen } from './screens/HouseholdScreen';
import { PharmacyListScreen } from './screens/PharmacyListScreen';
import { PrepareScreen } from './screens/PrepareScreen';
import { PurchasePlanScreen } from './screens/PurchasePlanScreen';
import { ReadinessScreen } from './screens/ReadinessScreen';
import { CrisisScreen } from './screens/CrisisScreen';
import { ScanScreen } from './screens/ScanScreen';
import { EmergencyScreen, EmergencyView } from './screens/EmergencyScreen';
import { CALL_GRACE_MS, takeLeavingForCall } from './callGrace';
import { FamilyPlanScreen } from './screens/FamilyPlanScreen';
import { AlertsScreen } from './screens/AlertsScreen';
import { KitScreen } from './screens/KitScreen';
import {
  loadRedLight,
  RED_LIGHT_SUPPORTED,
  RedLightContext,
  saveRedLight,
  type RedLight,
} from './redLight';
import { GuidesScreen } from './screens/GuidesScreen';
import { HomeScreen } from './screens/HomeScreen';
import { LockScreen } from './screens/LockScreen';
import { MapScreen } from './screens/MapScreen';
import { PlanScreen } from './screens/PlanScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SetupScreen } from './screens/SetupScreen';
import { StockScreen } from './screens/StockScreen';
import { PrivacyScreen } from './screens/PrivacyScreen';
import { SyncScreen } from './screens/SyncScreen';
import { StockFormScreen } from './stockForms/StockFormScreen';
import { SessionContext, type BackupCrypto, type Session } from './session';
import { colors, sizes, space, text } from './theme';
import { useBackHandler } from './useBackHandler';

type Phase =
  | { kind: 'loading' }
  | { kind: 'setup' }
  | { kind: 'locked'; lockedUntil?: number; message?: string }
  | { kind: 'open'; session: Session }
  | { kind: 'fatal'; message: string };

export function AppRoot<TDb extends VaultDatabase>(props: {
  manager: VaultKeyManager<TDb>;
  content: VaultContent;
  /** Vérification des mises à jour (absente dans les tests et l'aperçu web). */
  updater?: Updater;
  /** Appareil photo ; le module natif Android par défaut. */
  photoSource?: PhotoSource;
  /** Réglage des captures d'écran ; le module natif Android par défaut. */
  screenCapture?: ScreenCaptureSetting;
  /** Rappels de péremption ; le module natif Android par défaut. */
  reminders?: ReminderScheduler;
  /** Position GPS ; le module natif Android par défaut. */
  location?: LocationSource;
  /** Boussole ; le module natif Android par défaut. */
  compass?: CompassSource;
  /** Lampe du flash (signal SOS) ; le module natif par défaut. */
  torch?: TorchSignal;
  /** Téléchargement des tuiles de carte ; `fetch` par défaut. */
  tileFetch?: TileFetch;
  /** Fichiers (sauvegarde, export) ; le module natif Android par défaut. */
  files?: FileAccess;
  /** Chiffrement des sauvegardes ; sans lui, la sauvegarde est masquée. */
  backupCrypto?: BackupCrypto;
  /** Lecteur de codes-barres ; le module natif Android par défaut. */
  scanSource?: ScanSource;
  /** Recherche en ligne des produits ; `fetch` par défaut. */
  productFetch?: ProductFetch;
  /** Téléchargement des alertes ; `fetch` par défaut. */
  alertFetch?: AlertFetch;
  /** Réseau local (partage du foyer) ; le module natif Android par défaut. */
  network?: LocalNetwork;
}) {
  const { manager, content, updater } = props;
  const [photoSource] = useState(
    () => props.photoSource ?? nativePhotoSource(),
  );
  const [screenCapture] = useState(
    () => props.screenCapture ?? nativeScreenCapture(),
  );
  const [reminders] = useState(() => props.reminders ?? nativeReminders());
  const [files] = useState(() => props.files ?? nativeFiles());
  const [location] = useState(() => props.location ?? nativeLocation());
  const [compass] = useState(() => props.compass ?? nativeCompass());
  const [torch] = useState(() => props.torch ?? nativeTorch());
  const [tileFetch] = useState<TileFetch>(
    () => props.tileFetch ?? nativeTileFetch(),
  );
  const [scanSource] = useState(() => props.scanSource ?? nativeScanSource());
  const [productFetch] = useState<ProductFetch>(
    () => props.productFetch ?? defaultProductFetch,
  );
  const [alertFetch] = useState<AlertFetch>(
    () => props.alertFetch ?? defaultAlertFetch,
  );
  const [network] = useState(() => props.network ?? nativeNetwork());
  const backupCrypto = props.backupCrypto ?? null;
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [tab, setTab] = useState<Tab>('home');
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  // Écrans secondaires ouverts avant l'écran courant : le retour y revient.
  const [overlayStack, setOverlayStack] = useState<Overlay[]>([]);
  const [formTarget, setFormTarget] = useState<StockFormTarget | null>(null);
  const [stockFocus, setStockFocus] = useState<StockFocus | undefined>();
  const [crisisScenario, setCrisisScenario] = useState<CrisisId | undefined>();
  const [covered, setCovered] = useState(false);
  const [redLightOn, setRedLightOn] = useState(false);
  // Écran de verrouillage : « Urgence sans code » ouverte.
  const [lockedEmergency, setLockedEmergency] = useState(false);
  const sessionRef = useRef<Session | null>(null);
  // Sortie pour un appel ou un SMS de l'Urgence : heure et minuterie.
  const callAway = useRef<{
    since: number;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  const loadStatus = useCallback(() => {
    manager
      .getStatus()
      .then(status =>
        setPhase(
          status.kind === 'uninitialized'
            ? { kind: 'setup' }
            : status.kind === 'locked'
            ? { kind: 'locked', lockedUntil: status.retryAt }
            : { kind: 'locked' },
        ),
      )
      .catch((e: unknown) =>
        setPhase({
          kind: 'fatal',
          message: e instanceof Error ? e.message : String(e),
        }),
      );
  }, [manager]);
  useEffect(loadStatus, [loadStatus]);

  const open = (db: VaultDatabase) => {
    const session = {
      db,
      repo: new InventoryRepository(db),
      armory: new ArmoryRepository(db),
      documents: new DocumentRepository(db),
      photos: new PhotoRepository(db),
      bags: new BagRepository(db),
      boxes: new BoxRepository(db),
      photoSource,
      screenCapture,
      reminders,
      files,
      location,
      compass,
      torch,
      waypoints: new WaypointRepository(db),
      tiles: new MapTileStore(db),
      tileFetch,
      backupCrypto,
      scanSource,
      productFetch,
      alertFetch,
      network,
      random: systemRandom,
    };
    sessionRef.current = session;
    loadRedLight(db)
      .then(setRedLightOn)
      .catch(() => undefined);
    // Les rappels suivent le coffre ouvert (stock modifié ailleurs, date…).
    syncReminders(db, reminders).catch(() => undefined);
    setTab('home');
    setOverlay(null);
    setOverlayStack([]);
    setLockedEmergency(false);
    setPhase({ kind: 'open', session });
  };

  const lock = useCallback((message?: string) => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (callAway.current !== null) {
      clearTimeout(callAway.current.timer);
      callAway.current = null;
    }
    setLockedEmergency(false);
    setPhase({ kind: 'locked', message });
    if (session !== null) {
      // Dernière mise à jour des rappels avant de refermer la base.
      syncReminders(session.db, session.reminders)
        .catch(() => undefined)
        .finally(() => session.db.close());
    }
  }, []);

  const redLight = useMemo<RedLight>(
    () => ({
      on: redLightOn,
      set: async on => {
        const session = sessionRef.current;
        if (session !== null) {
          await saveRedLight(session.db, on);
        }
        setRedLightOn(on);
      },
    }),
    [redLightOn],
  );

  const navigation = useMemo<Navigation>(
    () => ({
      goTo: (next, focus) => {
        setStockFocus(focus);
        setTab(next);
        setOverlay(null);
        setOverlayStack([]);
      },
      open: next => {
        // La fiche d'ajout se referme par sa propre navigation.
        if (overlay !== null && overlay !== 'stockForm' && overlay !== next) {
          setOverlayStack(stack => [...stack, overlay]);
        }
        if (next === 'crisis') {
          setCrisisScenario(undefined);
        }
        setOverlay(next);
      },
      openCrisis: scenario => {
        if (
          overlay !== null &&
          overlay !== 'stockForm' &&
          overlay !== 'crisis'
        ) {
          setOverlayStack(stack => [...stack, overlay]);
        }
        setCrisisScenario(scenario);
        setOverlay('crisis');
      },
      openStockForm: target => {
        setFormTarget(target);
        setOverlay('stockForm');
      },
      close: () => {
        setOverlay(
          overlayStack.length > 0
            ? overlayStack[overlayStack.length - 1]
            : null,
        );
        setOverlayStack(stack => stack.slice(0, -1));
      },
      backLabel: backLabelFor(overlayStack[overlayStack.length - 1], tab),
      stockFocus,
      crisisScenario,
    }),
    [stockFocus, crisisScenario, overlay, overlayStack, tab],
  );

  // « Retour » d'Android : fiche d'ajout, écran secondaire, puis section.
  useBackHandler(
    phase.kind === 'open'
      ? () => {
          if (overlay === 'stockForm' && formTarget !== null) {
            if (formTarget.barcode !== undefined) {
              navigation.open('scan');
            } else {
              navigation.goTo(
                'stock',
                formTarget.bagId
                  ? { category: 'bags', bagId: formTarget.bagId }
                  : { category: formTarget.category },
              );
            }
            return true;
          }
          if (overlay !== null) {
            navigation.close();
            return true;
          }
          if (tab !== 'home') {
            navigation.goTo('home');
            return true;
          }
          return false;
        }
      : null,
  );

  // « Retour » d'Android dans l'Urgence sans code : revenir au code.
  useBackHandler(
    phase.kind === 'locked' && lockedEmergency
      ? () => {
          setLockedEmergency(false);
          return true;
        }
      : null,
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      setCovered(next !== 'active');
      const away = callAway.current;
      if (next === 'active' && away !== null) {
        // Retour d'un appel ou d'un SMS : verrouillé si l'absence a duré.
        clearTimeout(away.timer);
        callAway.current = null;
        if (Date.now() - away.since >= CALL_GRACE_MS) {
          lock(GRACE_MESSAGE);
        }
        return;
      }
      if (
        next !== 'background' ||
        sessionRef.current === null ||
        callAway.current !== null ||
        // Sauf pendant une photo : l'appareil photo est une autre application.
        isAwayForPhoto()
      ) {
        return;
      }
      if (takeLeavingForCall()) {
        // Appel ou SMS lancé depuis l'Urgence : 2 minutes avant de verrouiller.
        callAway.current = {
          since: Date.now(),
          timer: setTimeout(() => lock(GRACE_MESSAGE), CALL_GRACE_MS),
        };
        return;
      }
      lock('Coffre verrouillé à la sortie de l’application.');
    });
    return () => subscription.remove();
  }, [lock]);

  let body: React.ReactNode = null;
  if (phase.kind === 'setup') {
    body = (
      <SetupScreen
        onCreate={async pins => {
          try {
            open(await createVault(manager, content, pins));
          } catch (error) {
            // Coffre à moitié créé : on l'efface pour permettre de réessayer.
            await manager.destroy().catch(() => undefined);
            throw error;
          }
        }}
      />
    );
  } else if (phase.kind === 'locked' && lockedEmergency) {
    body = (
      <EmergencyView
        location={location}
        torch={torch}
        guides={content.guides}
        onBack={() => setLockedEmergency(false)}
        backLabel="Retour au code"
      />
    );
  } else if (phase.kind === 'locked') {
    body = (
      <LockScreen
        lockedUntil={phase.lockedUntil}
        initialMessage={phase.message}
        onUnlock={async pin => open(await openVault(manager, content, pin))}
        onEmergency={() => setLockedEmergency(true)}
      />
    );
  } else if (phase.kind === 'fatal') {
    body = (
      <FatalScreen
        message={phase.message}
        onRetry={() => {
          setPhase({ kind: 'loading' });
          loadStatus();
        }}
        onReset={async () => {
          await manager.destroy();
          setPhase({ kind: 'setup' });
        }}
      />
    );
  } else if (phase.kind === 'open') {
    body = (
      <SessionContext.Provider value={phase.session}>
        <RedLightContext.Provider value={redLight}>
          <NavigationContext.Provider value={navigation}>
            {overlay === 'stockForm' ? null : (
              <View style={[styles.bar, overlay !== null && styles.barCompact]}>
                {/* Sous-écrans : en-tête compact, le titre de l'écran suit. */}
                <View style={styles.brandBox}>
                  <Image
                    source={LOGO}
                    style={overlay === null ? styles.logo : styles.logoSmall}
                    accessibilityIgnoresInvertColors
                  />
                  <View style={styles.brandText}>
                    <Brand size={overlay === null ? 20 : 18} />
                    {overlay === null ? (
                      <Text style={styles.vaultBadge}>Coffre chiffré</Text>
                    ) : null}
                  </View>
                </View>
                <View style={styles.tools}>
                  <IconButton
                    icon={Lock}
                    label="Verrouiller"
                    onPress={() => lock()}
                  />
                  <IconButton
                    icon={Settings}
                    label="Réglages"
                    color={
                      overlay === 'settings' ? colors.primary : colors.text
                    }
                    onPress={() =>
                      overlay === 'settings'
                        ? navigation.close()
                        : navigation.open('settings')
                    }
                  />
                </View>
              </View>
            )}
            <KeyboardAvoidingView
              style={styles.flex}
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
              {overlay === 'settings' ? (
                <SettingsScreen onLock={() => lock()} />
              ) : overlay === 'plan' ? (
                <PlanScreen />
              ) : overlay === 'emergency' ? (
                <EmergencyScreen />
              ) : overlay === 'familyPlan' ? (
                <FamilyPlanScreen />
              ) : overlay === 'alerts' ? (
                <AlertsScreen />
              ) : overlay === 'sync' ? (
                <SyncScreen />
              ) : overlay === 'privacy' ? (
                <PrivacyScreen />
              ) : overlay === 'preparation' ? (
                <KitScreen />
              ) : overlay === 'calculators' ? (
                <CalculatorsScreen />
              ) : overlay === 'scan' ? (
                <ScanScreen />
              ) : overlay === 'history' ? (
                <HistoryScreen />
              ) : overlay === 'readiness' ? (
                <ReadinessScreen />
              ) : overlay === 'purchases' ? (
                <PurchasePlanScreen />
              ) : overlay === 'crisis' ? (
                <CrisisScreen />
              ) : overlay === 'household' ? (
                <HouseholdScreen />
              ) : overlay === 'pharmacy' ? (
                <PharmacyListScreen />
              ) : overlay === 'stockForm' && formTarget !== null ? (
                <StockFormScreen target={formTarget} />
              ) : (
                <>
                  {tab === 'home' ? <HomeScreen /> : null}
                  {tab === 'stock' ? <StockScreen /> : null}
                  {tab === 'prepare' ? <PrepareScreen /> : null}
                  {tab === 'map' ? <MapScreen /> : null}
                  {tab === 'guides' ? <GuidesScreen /> : null}
                </>
              )}
            </KeyboardAvoidingView>
            {overlay === 'stockForm' ? (
              <View style={{ height: insets.bottom }} />
            ) : (
              <BottomNav
                current={overlay === null ? tab : null}
                onSelect={navigation.goTo}
                onSos={() => navigation.open('emergency')}
                sosActive={overlay === 'emergency'}
                bottomInset={insets.bottom}
              />
            )}
          </NavigationContext.Provider>
        </RedLightContext.Provider>
      </SessionContext.Provider>
    );
  }

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
        phase.kind !== 'open' && { paddingBottom: insets.bottom },
      ]}
    >
      {phase.kind === 'open' && tab === 'home' && overlay === null ? (
        <HomeBackdrop />
      ) : null}
      {updater && phase.kind !== 'loading' ? (
        <UpdateBanner updater={updater} />
      ) : null}
      {body}
      {redLightOn && RED_LIGHT_SUPPORTED ? (
        <>
          <View pointerEvents="none" style={styles.grayLayer} />
          <View
            pointerEvents="none"
            style={styles.redLight}
            testID="red-light"
          />
        </>
      ) : null}
      {covered && phase.kind === 'open' ? (
        <View style={styles.cover} testID="privacy-cover">
          <AppIcon size={140} />
        </View>
      ) : null}
    </View>
  );
}

function FatalScreen(props: {
  message: string;
  /** Erreur souvent passagère (trousseau du téléphone) : réessayer d'abord. */
  onRetry: () => void;
  onReset: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <View style={styles.fatal}>
      <Brand size={30} tagline />
      <Text style={text.h2}>Le coffre ne peut pas être ouvert</Text>
      <Text style={text.body}>{props.message}</Text>
      {confirming ? (
        <>
          <Text style={text.body}>
            Toutes les données du coffre seront effacées définitivement.
          </Text>
          <Button
            variant="danger"
            label="Effacer et recommencer"
            onPress={() => {
              void props.onReset();
            }}
          />
          <Button
            variant="ghost"
            label="Annuler"
            onPress={() => setConfirming(false)}
          />
        </>
      ) : (
        <>
          <Button variant="primary" label="Réessayer" onPress={props.onRetry} />
          <Text style={text.body}>
            Si l’erreur persiste après un redémarrage du téléphone :
          </Text>
          <Button
            label="Effacer le coffre…"
            onPress={() => setConfirming(true)}
          />
        </>
      )}
    </View>
  );
}

/** Tête de loup du logo, détourée en rond. */
const LOGO_FILE: number | string = require('./assets/fenrir-logo.png');
// Aperçu web : `require` donne une URL de données.
const LOGO: ImageSourcePropType =
  typeof LOGO_FILE === 'string' ? { uri: LOGO_FILE } : LOGO_FILE;

const GRACE_MESSAGE = 'Coffre verrouillé : plus de 2 minutes hors de Fenrir.';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  brandBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: space.s,
  },
  brandText: { alignItems: 'flex-start', gap: 2 },
  logo: { width: 42, height: 42, borderRadius: 21 },
  logoSmall: { width: 32, height: 32, borderRadius: 16 },
  vaultBadge: { color: colors.success, fontSize: 11, fontWeight: '600' },
  tools: { flexDirection: 'row', alignItems: 'center', marginLeft: space.m },
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: sizes.screenPadding - 4,
    paddingTop: space.s,
    paddingBottom: space.m,
  },
  // Assez d’espace sous le SOS pour ne pas toucher le bouton Retour.
  barCompact: { paddingTop: space.xs, paddingBottom: space.m },
  cover: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Deux calques : le gris retire les couleurs (garde la luminosité), puis
  // le rouge ne garde que la composante rouge. Le blanc devient rouge, le
  // noir reste noir, et un texte cyan reste lisible.
  grayLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: '#808080',
    mixBlendMode: 'saturation',
  },
  redLight: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: '#FF0000',
    mixBlendMode: 'multiply',
  },
  fatal: { flex: 1, justifyContent: 'center', padding: space.xl, gap: space.l },
});
