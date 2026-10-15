/**
 * Bandeau « nouvelle version disponible ». La vérification a lieu au
 * démarrage puis, au plus une fois par heure, au retour dans l'application.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

import type { AvailableUpdate, Updater } from '../../update/updater';
import { colors, radius, space, tint } from '../theme';
import { Button } from './controls';

const RECHECK_MS = 60 * 60 * 1000;

export function UpdateBanner({ updater }: { updater: Updater }) {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [status, setStatus] = useState<'idle' | 'downloading' | 'error'>(
    'idle',
  );
  const [error, setError] = useState('');
  const lastCheck = useRef(0);

  const check = useCallback(async () => {
    if (Date.now() - lastCheck.current < RECHECK_MS) {
      return;
    }
    lastCheck.current = Date.now();
    setUpdate(await updater.check());
  }, [updater]);

  useEffect(() => {
    void check();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        void check();
      }
    });
    return () => subscription.remove();
  }, [check]);

  if (update === null) {
    return null;
  }

  const install = async () => {
    setStatus('downloading');
    setError('');
    try {
      await updater.install(update);
      setStatus('idle');
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <View style={styles.banner} accessibilityLiveRegion="polite">
      <View style={styles.grow}>
        <Text style={styles.title}>
          Version {update.versionName} disponible
        </Text>
        <Text style={styles.detail} numberOfLines={2}>
          {status === 'downloading'
            ? 'Téléchargement… Android va demander de confirmer.'
            : status === 'error'
            ? `Échec : ${error}`
            : update.notes || 'Tes données sont conservées.'}
        </Text>
      </View>
      <Button
        compact
        variant="primary"
        label={status === 'downloading' ? '…' : 'Installer'}
        accessibilityLabel="Installer la mise à jour"
        disabled={status === 'downloading'}
        onPress={() => {
          void install();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    marginHorizontal: space.l,
    marginTop: space.s,
    padding: space.m,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.amber,
    backgroundColor: tint(colors.amber, '14'),
  },
  grow: { flex: 1, minWidth: 0 },
  title: { color: colors.amber, fontSize: 15, fontWeight: '700' },
  detail: { color: colors.dim, fontSize: 13, lineHeight: 18 },
});
