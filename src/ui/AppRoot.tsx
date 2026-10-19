/**
 * Racine de l'application : premier lancement, verrouillage, coffre ouvert.
 *
 * Sécurité et sobriété (cahier des charges §4.6) :
 * - le coffre se verrouille dès que l'application passe en arrière-plan :
 *   la base est fermée, aucun calcul ni minuterie ne continue ;
 * - pendant la transition (sélecteur d'applications iOS), un écran noir
 *   masque le contenu pour que l'aperçu système ne le capture pas.
 */
import { Lock, Settings, TriangleAlert } from 'lucide-react-native';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { VaultKeyManager } from '../crypto/VaultKeyManager';
import {
  ArmoryRepository,
  BagRepository,
  DocumentRepository,
  InventoryRepository,
  PhotoRepository,
} from '../inventory';
import { nativeFiles, type FileAccess } from '../device/files';
import { nativeCompass, type CompassSource } from '../device/compass';
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
import { defaultProductFetch } from '../scanner/fetch';
import type { ProductFetch } from '../scanner/products';
import { nativeScanSource, type ScanSource } from '../scanner/scanSource';
import type { Updater } from '../update/updater';
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
import { PrepareScreen } from './screens/PrepareScreen';
import { PurchasePlanScreen } from './screens/PurchasePlanScreen';
import { ReadinessScreen } from './screens/ReadinessScreen';
import { CrisisScreen } from './screens/CrisisScreen';
import { ScanScreen } from './screens/ScanScreen';
import { EmergencyScreen } from './screens/EmergencyScreen';
import { FamilyPlanScreen } from './screens/FamilyPlanScreen';
import { PreparationScreen } from './screens/PreparationScreen';
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
import { StockFormScreen } from './stockForms/StockFormScreen';
import { SessionContext, type BackupCrypto, type Session } from './session';
import { colors, fonts, radius, sizes, space, text } from './theme';

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
  const [tileFetch] = useState<TileFetch>(
    () => props.tileFetch ?? nativeTileFetch(),
  );
  const [scanSource] = useState(() => props.scanSource ?? nativeScanSource());
  const [productFetch] = useState<ProductFetch>(
    () => props.productFetch ?? defaultProductFetch,
  );
  const backupCrypto = props.backupCrypto ?? null;
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [tab, setTab] = useState<Tab>('home');
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  // Écrans secondaires ouverts avant l'écran courant : le retour y revient.
  const [overlayStack, setOverlayStack] = useState<Overlay[]>([]);
  const [formTarget, setFormTarget] = useState<StockFormTarget | null>(null);
  const [stockFocus, setStockFocus] = useState<StockFocus | undefined>();
  const [covered, setCovered] = useState(false);
  const [redLightOn, setRedLightOn] = useState(false);
  const sessionRef = useRef<Session | null>(null);

  useEffect(() => {
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

  const open = (db: VaultDatabase) => {
    const session = {
      db,
      repo: new InventoryRepository(db),
      armory: new ArmoryRepository(db),
      documents: new DocumentRepository(db),
      photos: new PhotoRepository(db),
      bags: new BagRepository(db),
      photoSource,
      screenCapture,
      reminders,
      files,
      location,
      compass,
      waypoints: new WaypointRepository(db),
      tiles: new MapTileStore(db),
      tileFetch,
      backupCrypto,
      scanSource,
      productFetch,
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
    setPhase({ kind: 'open', session });
  };

  const lock = useCallback((message?: string) => {
    const session = sessionRef.current;
    sessionRef.current = null;
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
        setOverlay(next);
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
    }),
    [stockFocus, overlay, overlayStack, tab],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      setCovered(next !== 'active');
      // Sauf pendant une photo : l'appareil photo est une autre application.
      if (
        next === 'background' &&
        sessionRef.current !== null &&
        !isAwayForPhoto()
      ) {
        lock('Coffre verrouillé à la sortie de l’application.');
      }
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
  } else if (phase.kind === 'locked') {
    body = (
      <LockScreen
        lockedUntil={phase.lockedUntil}
        initialMessage={phase.message}
        onUnlock={async pin => open(await openVault(manager, content, pin))}
      />
    );
  } else if (phase.kind === 'fatal') {
    body = (
      <FatalScreen
        message={phase.message}
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
              <View style={styles.bar}>
                <IconButton
                  icon={Lock}
                  label="Verrouiller"
                  onPress={() => lock()}
                />
                <View style={styles.brandBox}>
                  <Brand size={24} />
                  <Text style={styles.vaultBadge}>Coffre chiffré</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Ouvrir l’écran Urgence"
                  onPress={() => navigation.open('emergency')}
                  hitSlop={4}
                  style={({ pressed }) => [
                    styles.sos,
                    overlay === 'emergency' && styles.sosOn,
                    pressed && styles.pressed,
                  ]}
                >
                  <TriangleAlert color={SOS_TEXT} size={18} strokeWidth={2.4} />
                  <Text style={styles.sosText}>SOS</Text>
                </Pressable>
                <IconButton
                  icon={Settings}
                  label="Réglages"
                  color={overlay === 'settings' ? colors.primary : colors.text}
                  onPress={() =>
                    overlay === 'settings'
                      ? navigation.close()
                      : navigation.open('settings')
                  }
                />
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
              ) : overlay === 'preparation' ? (
                <PreparationScreen />
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

function FatalScreen(props: { message: string; onReset: () => Promise<void> }) {
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
        <Button
          label="Effacer le coffre…"
          onPress={() => setConfirming(true)}
        />
      )}
    </View>
  );
}

/** Rouge clair lisible sur le fond rouge sombre du bouton SOS. */
const SOS_TEXT = '#FF8A96';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  brandBox: { flex: 1, alignItems: 'center', gap: 2 },
  vaultBadge: { color: colors.success, fontSize: 11, fontWeight: '600' },
  sos: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: sizes.touch - 4,
    paddingHorizontal: space.m,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSurface,
    marginRight: space.xs,
  },
  sosOn: { backgroundColor: '#4A121D' },
  sosText: {
    color: SOS_TEXT,
    fontFamily: fonts.display,
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 1,
  },
  pressed: { opacity: 0.8 },
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: sizes.screenPadding - 4,
    paddingTop: space.s,
    paddingBottom: space.m,
  },
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
