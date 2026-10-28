/** Saisie du code. Le même écran sert au code maître et au code de contrainte. */
import { TriangleAlert } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { isCryptoError } from '../../crypto/errors';
import { TOPOGRAPHIC_SVG } from '../assets/backgrounds';
import { AppIcon } from '../components/AppIcon';
import { Backdrop, Button } from '../components/controls';
import { PinDots, PinPad } from '../components/PinPad';
import { colors, space, text } from '../theme';

export function LockScreen(props: {
  onUnlock: (pin: string) => Promise<void>;
  /** Blocage déjà en cours au démarrage (ms epoch). */
  lockedUntil?: number;
  initialMessage?: string;
  /** Urgence sans code : numéros, signal, position, fiches réflexes. */
  onEmergency?: () => void;
}) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(props.initialMessage ?? '');
  const [isError, setIsError] = useState(false);
  const [retryAt, setRetryAt] = useState<number | null>(
    props.lockedUntil ?? null,
  );
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  // Compte à rebours, actif seulement pendant un blocage.
  useEffect(() => {
    if (retryAt === null) {
      return;
    }
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= retryAt) {
        setRetryAt(null);
        setMessage('Vous pouvez réessayer.');
        setIsError(false);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  const locked = retryAt !== null && now < retryAt;

  const submit = async () => {
    if (pin.length === 0 || busy || locked) {
      return;
    }
    const entered = pin;
    setBusy(true);
    setMessage('Déverrouillage…');
    setIsError(false);
    try {
      await props.onUnlock(entered);
    } catch (error) {
      if (!mounted.current) {
        return;
      }
      setIsError(true);
      if (isCryptoError(error) && error.code === 'INVALID_PIN') {
        setMessage('Code incorrect');
        if (error.retryAt !== undefined) {
          setNow(Date.now());
          setRetryAt(error.retryAt);
        }
      } else if (isCryptoError(error) && error.code === 'LOCKED_OUT') {
        setNow(Date.now());
        setRetryAt(error.retryAt ?? Date.now());
        setMessage('');
      } else {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (mounted.current) {
        setBusy(false);
        setPin('');
      }
    }
  };

  const secondsLeft = locked ? Math.ceil(((retryAt ?? 0) - now) / 1000) : 0;
  const shown = locked
    ? `Trop d’essais. Réessayez dans ${secondsLeft} s.`
    : message;

  return (
    <View style={styles.page}>
      <Backdrop svg={TOPOGRAPHIC_SVG} opacity={0.45} />
      <View style={styles.head}>
        <AppIcon size={112} />
        <Text style={text.muted}>Saisissez votre code</Text>
      </View>
      <PinDots length={pin.length} />
      <Text
        accessibilityLiveRegion="polite"
        style={[styles.message, (isError || locked) && styles.error]}
      >
        {shown}
      </Text>
      <PinPad
        value={pin}
        onChange={setPin}
        onSubmit={() => {
          void submit();
        }}
        disabled={busy || locked}
      />
      {props.onEmergency ? (
        <View style={styles.emergency}>
          <Button
            variant="danger"
            icon={TriangleAlert}
            label="Urgence sans code"
            accessibilityLabel="Urgence sans code : numéros, signal lumineux, position et fiches réflexes"
            onPress={props.onEmergency}
          />
          <Text style={styles.emergencyHint}>
            Aucune donnée du coffre n’est affichée.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.xxxl,
    paddingHorizontal: space.xl,
  },
  head: { alignItems: 'center', gap: space.m },
  message: {
    color: colors.textMuted,
    fontSize: 14,
    minHeight: 20,
    textAlign: 'center',
  },
  error: { color: colors.danger },
  emergency: { alignSelf: 'stretch', gap: space.xs },
  emergencyHint: {
    ...text.subtle,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
