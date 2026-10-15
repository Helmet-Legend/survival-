/**
 * Aperçu web de la VRAIE interface mobile (src/ui) via react-native-web,
 * branchée sur les adaptateurs navigateur de la démo (SQLite WebAssembly).
 */
import React from 'react';
import { AppRegistry, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { systemRandom } from '../../src/crypto/native/random';
import { VaultKeyManager } from '../../src/crypto/VaultKeyManager';
import { seedDecoyInventory } from '../../src/inventory';
import { AppRoot } from '../../src/ui/AppRoot';
import { colors } from '../../src/ui/theme';
import { createVault, type VaultContent } from '../../src/vault';
import {
  BrowserVaultDb,
  DEMO_ARGON2_PARAMS,
  jsArgon2,
  loadSqlite,
  MemoryDriver,
  MemoryStore,
} from '../web/adapters';
import {
  DURESS_PIN,
  MASTER_PIN,
  SAMPLE_GUIDES,
  seedRealVault,
} from '../web/sampleData';

declare global {
  interface Window {
    __RESILIOS_WASM__: string;
  }
}

const content: VaultContent = {
  guides: SAMPLE_GUIDES,
  seedDecoy: db => seedDecoyInventory(db),
};

async function start() {
  const sqlite3 = await loadSqlite(window.__RESILIOS_WASM__);
  const manager = new VaultKeyManager<BrowserVaultDb>({
    argon2: jsArgon2,
    random: systemRandom,
    store: new MemoryStore(),
    driver: new MemoryDriver(sqlite3),
    argon2Params: DEMO_ARGON2_PARAMS,
  });
  const primary = await createVault(manager, content, {
    masterPin: MASTER_PIN,
    duressPin: DURESS_PIN,
  });
  await seedRealVault(primary);
  primary.close();

  function App() {
    return (
      <SafeAreaProvider style={styles.root}>
        <AppRoot manager={manager} content={content} />
      </SafeAreaProvider>
    );
  }
  AppRegistry.registerComponent('ResiliOS', () => App);
  AppRegistry.runApplication('ResiliOS', {
    // react-native-web attend un élément DOM ; les types de React Native, un RootTag.
    rootTag: document.getElementById('root') as never,
    initialProps: {},
  });
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});

void start();
