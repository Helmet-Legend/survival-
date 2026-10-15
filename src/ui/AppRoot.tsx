/**
 * Racine de l'application : premier lancement, verrouillage, coffre ouvert.
 *
 * Sécurité et sobriété (cahier des charges §4.6) :
 * - le coffre se verrouille dès que l'application passe en arrière-plan :
 *   la base est fermée, aucun calcul ni minuterie ne continue ;
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
  DocumentRepository,
  InventoryRepository,
  PhotoRepository,
} from '../inventory';
import {
  isAwayForPhoto,
  nativePhotoSource,
  type PhotoSource,
} from '../photo/photoSource';
import type { Updater } from '../update/updater';
import {
  createVault,
  openVault,
  type VaultContent,
  type VaultDatabase,
} from '../vault';
import { BottomNav } from './components/BottomNav';
import { Brand, Button, IconButton } from './components/controls';
import { UpdateBanner } from './components/UpdateBanner';
import {
  NavigationContext,
  type Navigation,
  type Overlay,
  type Tab,
} from './navigation';
import { GuidesScreen } from './screens/GuidesScreen';
import { HomeScreen } from './screens/HomeScreen';
import { LockScreen } from './screens/LockScreen';
import { MapScreen } from './screens/MapScreen';
import { PlanScreen } from './screens/PlanScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SetupScreen } from './screens/SetupScreen';
import { StockScreen } from './screens/StockScreen';
import { SessionContext, type Session } from './session';
import { colors, sizes, space, text } from './theme';

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
}) {
  const { manager, content, updater } = props;
  const [photoSource] = useState(
    () => props.photoSource ?? nativePhotoSource(),
  );
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [tab, setTab] = useState<Tab>('home');
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [covered, setCovered] = useState(false);
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
      photoSource,
    };
    sessionRef.current = session;
    setTab('home');
    setOverlay(null);
    setPhase({ kind: 'open', session });
  };

  const lock = useCallback((message?: string) => {
    sessionRef.current?.db.close();
    sessionRef.current = null;
    setPhase({ kind: 'locked', message });
  }, []);

  const navigation = useMemo<Navigation>(
    () => ({
      goTo: next => {
        setTab(next);
        setOverlay(null);
      },
      open: setOverlay,
      close: () => setOverlay(null),
    }),
    [],
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
        <NavigationContext.Provider value={navigation}>
          <View style={styles.bar}>
            <IconButton
              icon={Lock}
              label="Verrouiller"
              onPress={() => lock()}
            />
            <Brand size={26} tagline />
            <IconButton
              icon={Settings}
              label="Réglages"
              color={overlay === 'settings' ? colors.primary : colors.text}
              onPress={() =>
                setOverlay(overlay === 'settings' ? null : 'settings')
              }
            />
          </View>
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            {overlay === 'settings' ? (
              <SettingsScreen onLock={() => lock()} />
            ) : overlay === 'plan' ? (
              <PlanScreen />
            ) : (
              <>
                {tab === 'home' ? <HomeScreen /> : null}
                {tab === 'stock' ? <StockScreen /> : null}
                {tab === 'map' ? <MapScreen /> : null}
                {tab === 'guides' ? <GuidesScreen /> : null}
              </>
            )}
          </KeyboardAvoidingView>
          <BottomNav
            current={overlay === null ? tab : null}
            onSelect={navigation.goTo}
            bottomInset={insets.bottom}
          />
        </NavigationContext.Provider>
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
      {updater && phase.kind !== 'loading' ? (
        <UpdateBanner updater={updater} />
      ) : null}
      {body}
      {covered && phase.kind === 'open' ? (
        <View style={styles.cover} testID="privacy-cover">
          <Brand size={30} tagline />
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
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
  fatal: { flex: 1, justifyContent: 'center', padding: space.xl, gap: space.l },
});
