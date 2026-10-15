/**
 * Point d'entrée de l'application : branche l'interface sur les modules
 * natifs (Argon2id, SQLCipher, Keychain/Keystore).
 */
import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BUNDLED_GUIDES } from './src/content/guides';
import { createVaultKeyManager } from './src/crypto';
import { seedDecoyInventory } from './src/inventory';
import { AppRoot } from './src/ui/AppRoot';
import { colors } from './src/ui/theme';
import type { VaultContent } from './src/vault';

const manager = createVaultKeyManager();

const content: VaultContent = {
  guides: BUNDLED_GUIDES,
  seedDecoy: db => seedDecoyInventory(db),
};

export default function App() {
  return (
    <SafeAreaProvider style={{ backgroundColor: colors.bg }}>
      <StatusBar barStyle="light-content" />
      <AppRoot manager={manager} content={content} />
    </SafeAreaProvider>
  );
}
