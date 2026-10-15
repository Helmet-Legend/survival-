/** Saisie du code. Le même écran sert au code maître et au code de contrainte. */
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { isCryptoError } from '../../crypto/errors';
import { Brand } from '../components/controls';
import { PinDots, PinPad } from '../components/PinPad';
import { colors, space, text } from '../theme';

export function LockScreen(props: {
  onUnlock: (pin: string) => Promise<void>;
  /** Blocage déjà en cours au démarrage (ms epoch). */
  lockedUntil?: number;
  initialMessage?: string;
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
      <View style={styles.head}>
        <Brand size={24} />
        <Text style={text.dim}>Saisissez votre code</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 48,
    paddingHorizontal: space.xl,
  },
  head: { alignItems: 'center', gap: space.s },
  message: {
    color: colors.dim,
    fontSize: 14,
    minHeight: 20,
    textAlign: 'center',
  },
  error: { color: colors.danger },
});
