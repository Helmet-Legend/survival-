/**
 * Premier lancement : choix du code maître, puis, facultativement, du code
 * de contrainte. Chaque code est saisi deux fois.
 */
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { isCryptoError } from '../../crypto/errors';
import { assertPinAcceptable, pinsAreEqual } from '../../crypto/pinPolicy';
import { TOPOGRAPHIC_SVG } from '../assets/backgrounds';
import { AppIcon } from '../components/AppIcon';
import { Backdrop, Button } from '../components/controls';
import { PinDots, PinPad } from '../components/PinPad';
import { colors, space, text } from '../theme';

type Step =
  | 'intro'
  | 'master'
  | 'masterConfirm'
  | 'duressAsk'
  | 'duress'
  | 'duressConfirm'
  | 'creating';

const PROMPTS: Partial<Record<Step, string>> = {
  master: 'Choisissez votre code maître (6 chiffres ou plus)',
  masterConfirm: 'Saisissez à nouveau le code maître',
  duress: 'Choisissez le code de contrainte',
  duressConfirm: 'Saisissez à nouveau le code de contrainte',
};

export function SetupScreen(props: {
  onCreate: (pins: { masterPin: string; duressPin?: string }) => Promise<void>;
}) {
  const [step, setStep] = useState<Step>('intro');
  const [pin, setPin] = useState('');
  const [master, setMaster] = useState('');
  const [duress, setDuress] = useState('');
  const [error, setError] = useState('');

  const create = async (duressPin?: string) => {
    setStep('creating');
    setError('');
    try {
      await props.onCreate({ masterPin: master, duressPin });
    } catch (e) {
      setError(
        isCryptoError(e) || e instanceof Error
          ? e.message
          : 'La création du coffre a échoué',
      );
      setStep('duressAsk');
    }
  };

  const submit = () => {
    setError('');
    try {
      if (step === 'master' || step === 'duress') {
        assertPinAcceptable(pin);
        if (step === 'duress' && pinsAreEqual(pin, master)) {
          throw new Error('Le code de contrainte doit différer du code maître');
        }
        (step === 'master' ? setMaster : setDuress)(pin);
        setStep(step === 'master' ? 'masterConfirm' : 'duressConfirm');
      } else if (step === 'masterConfirm') {
        if (!pinsAreEqual(pin, master)) {
          setStep('master');
          throw new Error(
            'Les deux saisies ne correspondent pas. Recommencez.',
          );
        }
        setStep('duressAsk');
      } else if (step === 'duressConfirm') {
        if (!pinsAreEqual(pin, duress)) {
          setStep('duress');
          throw new Error(
            'Les deux saisies ne correspondent pas. Recommencez.',
          );
        }
        void create(duress);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setPin('');
  };

  if (step === 'intro' || step === 'duressAsk' || step === 'creating') {
    return (
      <View style={styles.flex}>
        <Backdrop svg={TOPOGRAPHIC_SVG} opacity={0.35} />
        <ScrollView contentContainerStyle={styles.page}>
          <View style={styles.iconRow}>
            <AppIcon size={112} />
          </View>
          {step === 'intro' ? (
            <>
              <Text style={styles.heading}>Créer votre coffre</Text>
              <Text style={text.body}>
                Vos stocks, points d’intérêt et checklists sont chiffrés sur ce
                téléphone. Rien n’est envoyé en ligne.
              </Text>
              <Text style={text.body}>
                Le code maître est la seule façon d’ouvrir le coffre. S’il est
                oublié, les données sont perdues : aucune récupération n’est
                possible.
              </Text>
              <Button
                variant="primary"
                label="Choisir mon code"
                onPress={() => setStep('master')}
              />
            </>
          ) : step === 'duressAsk' ? (
            <>
              <Text style={styles.heading}>Code de contrainte</Text>
              <Text style={text.body}>
                Si l’on vous force à ouvrir l’application, ce second code ouvre
                un inventaire ordinaire et crédible, sans aucun signe à l’écran.
                Vos vraies données restent invisibles.
              </Text>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Button
                variant="primary"
                label="Définir un code de contrainte"
                onPress={() => setStep('duress')}
              />
              <Button
                variant="ghost"
                label="Plus tard"
                onPress={() => {
                  void create();
                }}
              />
            </>
          ) : (
            <Text accessibilityLiveRegion="polite" style={text.body}>
              Création du coffre…
            </Text>
          )}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.pinPage}>
      <Backdrop svg={TOPOGRAPHIC_SVG} opacity={0.45} />
      <View style={styles.pinHead}>
        <AppIcon size={96} />
        <Text style={[text.body, styles.center]}>{PROMPTS[step]}</Text>
      </View>
      <PinDots length={pin.length} />
      <Text accessibilityLiveRegion="polite" style={styles.error}>
        {error}
      </Text>
      <PinPad value={pin} onChange={setPin} onSubmit={submit} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: space.xl,
    gap: space.l,
  },
  heading: { ...text.h1, fontSize: 30, marginTop: space.l },
  pinPage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 48,
    paddingHorizontal: space.xl,
  },
  pinHead: { alignItems: 'center', gap: space.s },
  center: { textAlign: 'center' },
  iconRow: { alignItems: 'center' },
  error: {
    color: colors.danger,
    fontSize: 14,
    minHeight: 20,
    textAlign: 'center',
  },
});
