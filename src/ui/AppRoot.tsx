/**
 * Racine de l'application : premier lancement, verrouillage, coffre ouvert.
 *
 * Sécurité et sobriété (cahier des charges §4.6) :
 * - le coffre se verrouille dès que l'application passe en arrière-plan :
 *   la base est fermée, aucun calcul ni minuterie ne continue ;
 * - pendant la transition (sélecteur d'applications iOS), un écran noir
 *   masque le contenu pour que l'aperçu système ne le capture pas.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { InventoryRepository } from '../inventory';
import {
  createVault,
  openVault,
  type VaultContent,
  type VaultDatabase,
} from '../vault';
import { Brand, Button } from './components/controls';
import { Icon, type IconName } from './components/Icon';
import { UpdateBanner } from './components/UpdateBanner';
import type { Updater } from '../update/updater';
import { AutonomyScreen } from './screens/AutonomyScreen';
import { CoordsScreen } from './screens/CoordsScreen';
import { GuidesScreen } from './screens/GuidesScreen';
import { LockScreen } from './screens/LockScreen';
import { SetupScreen } from './screens/SetupScreen';
import { StockScreen } from './screens/StockScreen';
import { SessionContext, type Session } from './session';
import { colors, fonts, space, text } from './theme';

type Tab = 'autonomy' | 'stock' | 'coords' | 'guides';

const TABS: Array<[Tab, string, IconName]> = [
  ['autonomy', 'Autonomie', 'gauge'],
  ['stock', 'Stock', 'stock'],
  ['coords', 'Coordonnées', 'nav'],
  ['guides', 'Fiches', 'book'],
];

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
}) {
  const { manager, content, updater } = props;
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [tab, setTab] = useState<Tab>('autonomy');
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
    const session = { db, repo: new InventoryRepository(db) };
    sessionRef.current = session;
    setTab('autonomy');
    setPhase({ kind: 'open', session });
  };

  const lock = useCallback((message?: string) => {
    sessionRef.current?.db.close();
    sessionRef.current = null;
    setPhase({ kind: 'locked', message });
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      setCovered(next !== 'active');
      if (next === 'background' && sessionRef.current !== null) {
        lock('Coffre verrouillé à la sortie de l’application.');
      }
    });
    return () => subscription.remove();
  }, [lock]);

  let body: React.ReactNode = null;
  if (phase.kind === 'setup') {
    body = (
      <SetupScreen
        onCreate={async pins => open(await createVault(manager, content, pins))}
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
        <View style={styles.bar}>
          <Brand />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Verrouiller"
            onPress={() => lock()}
            hitSlop={8}
            style={({ pressed }) => [
              styles.lockButton,
              pressed && styles.pressed,
            ]}
          >
            <Icon name="lock" color={colors.text} size={16} />
            <Text style={styles.lockText}>Verrouiller</Text>
          </Pressable>
        </View>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {tab === 'autonomy' ? <AutonomyScreen /> : null}
          {tab === 'stock' ? <StockScreen /> : null}
          {tab === 'coords' ? <CoordsScreen /> : null}
          {tab === 'guides' ? <GuidesScreen /> : null}
        </KeyboardAvoidingView>
        <View
          style={[styles.tabs, { paddingBottom: insets.bottom }]}
          accessibilityRole="tablist"
        >
          {TABS.map(([id, label, icon]) => (
            <Pressable
              key={id}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === id }}
              onPress={() => setTab(id)}
              style={[styles.tab, tab === id && styles.tabOn]}
            >
              <Icon
                name={icon}
                color={tab === id ? colors.amber : colors.faint}
                size={20}
              />
              <Text style={[styles.tabText, tab === id && styles.tabTextOn]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
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
          <Brand />
        </View>
      ) : null}
    </View>
  );
}

function FatalScreen(props: { message: string; onReset: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <View style={styles.fatal}>
      <Brand />
      <Text style={text.title}>Le coffre ne peut pas être ouvert</Text>
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
          <Button label="Annuler" onPress={() => setConfirming(false)} />
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
    paddingHorizontal: space.l,
    paddingVertical: space.m,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  lockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.panelHi,
  },
  lockText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  tabs: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
    paddingTop: space.s,
    paddingBottom: space.m,
    borderTopWidth: 2,
    borderTopColor: 'transparent',
  },
  tabOn: { borderTopColor: colors.amber },
  tabText: {
    color: colors.faint,
    fontFamily: fonts.display,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  tabTextOn: { color: colors.amber },
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
