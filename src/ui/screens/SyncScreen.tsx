/**
 * MAQUETTE — Partage du foyer avec un autre téléphone.
 *
 * Écrans seulement : rien n'est encore envoyé ni reçu. Association par QR
 * code, puis synchronisation directe entre les deux téléphones (même Wi-Fi
 * ou point d'accès de l'un d'eux), sans internet, sans compte, sans serveur.
 */
import {
  ArrowLeftRight,
  Camera,
  Check,
  Crosshair,
  QrCode,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Smartphone,
  Unlink,
  Wifi,
} from 'lucide-react-native';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { Button, Panel, ScreenTitle, StatusChip } from '../components/controls';
import { useNavigation } from '../navigation';
import { colors, radius, sizes, space, text, tint } from '../theme';

type Step = 'intro' | 'qr' | 'join' | 'paired';

const SHARED = [
  'Stocks : eau, vivres, santé, outils, équipement, énergie',
  'Sacs d’évacuation et documents',
  'Plan familial, points de regroupement, carte',
  'Mon foyer, kit et matériel, plan d’achats',
];

/** Derniers changements reçus (exemple de maquette). */
const RECENT = [
  { who: 'Partenaire', what: 'Eau en bidons : −3 L', when: '08:41' },
  { who: 'Partenaire', what: 'Riz 1 kg ajouté (DDM 03/2028)', when: '08:40' },
  { who: 'Vous', what: 'Piles AA : −4', when: 'hier' },
  { who: 'Partenaire', what: 'Point « École » ajouté', when: 'hier' },
];

export function SyncScreen() {
  const navigation = useNavigation();
  const [step, setStep] = useState<Step>('intro');
  const [weapons, setWeapons] = useState(false);
  const [photos, setPhotos] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);
  const [merge, setMerge] = useState(true);

  const options = (
    <Panel title="Partage en option">
      <OptionRow
        icon={Crosshair}
        color={colors.weapons}
        label="Armement et munitions"
        hint="Fiches des armes et munitions, transférées chiffrées. Jamais montrées dans les notifications."
        value={weapons}
        onChange={setWeapons}
      />
      <OptionRow
        icon={Camera}
        color={colors.cyan}
        label="Photos"
        hint="Photos des articles et des documents. Plus long à transférer."
        value={photos}
        onChange={setPhotos}
      />
      <Text style={text.subtle}>
        Désactiver une option plus tard retire ces fiches de l’autre téléphone à
        la synchronisation suivante.
      </Text>
    </Panel>
  );

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScreenTitle
        title="Partage du foyer"
        onBack={navigation.close}
        backLabel={navigation.backLabel}
      />
      <Text style={styles.mock}>
        Maquette : rien n’est encore envoyé ni reçu.
      </Text>

      {step === 'intro' ? (
        <>
          <Panel>
            <View style={styles.row}>
              <Smartphone color={colors.cyan} size={22} />
              <ArrowLeftRight color={colors.textMuted} size={18} />
              <Smartphone color={colors.primary} size={22} />
              <Text style={[styles.headline, styles.grow]}>
                Un stock, deux téléphones
              </Text>
            </View>
            <Text style={text.body}>
              Les deux téléphones se parlent directement, chiffré, sur le même
              Wi-Fi ou par le point d’accès de l’un d’eux. Sans internet, sans
              compte, sans serveur. Chacun peut ajouter, consommer et modifier.
            </Text>
          </Panel>

          <Panel title="Toujours partagé">
            {SHARED.map(s => (
              <View key={s} style={styles.row}>
                <Check color={colors.success} size={18} strokeWidth={2.4} />
                <Text style={[text.body, styles.grow]}>{s}</Text>
              </View>
            ))}
          </Panel>

          {options}

          <Panel title="Jamais partagé">
            <View style={styles.row}>
              <ShieldCheck color={colors.textMuted} size={18} />
              <Text style={[text.subtle, styles.grow]}>
                Codes PIN, code de contrainte et réglages de chaque téléphone.
                Ouvert avec le code de contrainte, Fenrir ne synchronise rien.
              </Text>
            </View>
          </Panel>

          <Button
            variant="primary"
            icon={QrCode}
            label="Afficher mon code d’association"
            onPress={() => setStep('qr')}
          />
          <Button
            icon={ScanLine}
            label="Scanner le code de l’autre téléphone"
            onPress={() => setStep('join')}
          />
        </>
      ) : null}

      {step === 'qr' ? (
        <>
          <Panel>
            <Text style={styles.headline}>
              Montrez ce code à l’autre téléphone
            </Text>
            <View style={styles.qrBox}>
              <MockQr size={232} />
            </View>
            <Text style={text.body}>
              Sur l’autre téléphone : Réglages › Partage du foyer › « Scanner le
              code de l’autre téléphone ».
            </Text>
            <View style={styles.verify}>
              <Text style={text.subtle}>Code de vérification</Text>
              <Text style={styles.verifyCode}>4827 · 1935</Text>
              <Text style={text.subtle}>
                Il doit s’afficher à l’identique sur les deux écrans.
              </Text>
            </View>
          </Panel>
          <Panel title="Partagé avec ce code">
            <Summary weapons={weapons} photos={photos} />
            <Text style={text.subtle}>Code valable 5 minutes.</Text>
          </Panel>
          <Button
            variant="primary"
            icon={Check}
            label="Maquette : simuler l’association"
            onPress={() => setStep('paired')}
          />
          <Button label="Annuler" onPress={() => setStep('intro')} />
        </>
      ) : null}

      {step === 'join' ? (
        <>
          <Panel accent={colors.borderActive}>
            <View style={styles.row}>
              <Wifi color={colors.cyan} size={22} />
              <Text style={[styles.headline, styles.grow]}>
                Associer ce téléphone ?
              </Text>
            </View>
            <Text style={text.body}>
              Code lu. Vérifiez que l’autre écran affiche bien :
            </Text>
            <Text style={styles.verifyCode}>4827 · 1935</Text>
          </Panel>
          <Panel title="L’autre téléphone partage">
            <Summary weapons={weapons} photos={photos} />
          </Panel>
          <Panel title="Le stock déjà présent ici">
            <Choice
              selected={merge}
              label="Fusionner avec le stock partagé"
              hint="Rien n’est perdu : les articles des deux téléphones sont réunis."
              onPress={() => setMerge(true)}
            />
            <Choice
              selected={!merge}
              label="Remplacer par le stock partagé"
              hint="Ce téléphone était vide ou ne servait qu’à essayer Fenrir."
              onPress={() => setMerge(false)}
            />
          </Panel>
          <Button
            variant="primary"
            icon={Check}
            label="Associer"
            onPress={() => setStep('paired')}
          />
          <Button label="Annuler" onPress={() => setStep('intro')} />
        </>
      ) : null}

      {step === 'paired' ? (
        <>
          <Panel>
            <View style={styles.row}>
              <Smartphone color={colors.success} size={24} />
              <View style={styles.grow}>
                <Text style={styles.headline}>Téléphone partenaire</Text>
                <Text style={text.subtle}>
                  {synced
                    ? 'Synchronisé à l’instant'
                    : 'Dernière synchronisation : aujourd’hui 08:42'}
                </Text>
              </View>
              <StatusChip
                tone={synced ? 'ok' : 'info'}
                label={synced ? 'À jour' : 'Associé'}
              />
            </View>
            <Button
              variant="primary"
              icon={RefreshCw}
              label={
                syncing ? 'Recherche du téléphone…' : 'Synchroniser maintenant'
              }
              disabled={syncing}
              onPress={() => {
                setSyncing(true);
                setTimeout(() => {
                  setSyncing(false);
                  setSynced(true);
                }, 900);
              }}
            />
            {synced ? (
              <Text style={styles.result}>
                Reçu : 4 changements · Envoyé : 1
              </Text>
            ) : (
              <Text style={text.subtle}>
                Les deux téléphones doivent avoir Fenrir ouvert, sur le même
                Wi-Fi ou par le point d’accès de l’un d’eux.
              </Text>
            )}
          </Panel>

          <Panel title="Derniers changements">
            {RECENT.map(r => (
              <View key={r.what} style={styles.change}>
                <Text
                  style={[
                    styles.who,
                    {
                      color: r.who === 'Vous' ? colors.primary : colors.cyan,
                      borderColor: tint(
                        r.who === 'Vous' ? colors.primary : colors.cyan,
                        '66',
                      ),
                    },
                  ]}
                >
                  {r.who}
                </Text>
                <Text style={[text.body, styles.grow]}>{r.what}</Text>
                <Text style={text.subtle}>{r.when}</Text>
              </View>
            ))}
          </Panel>

          {options}

          <Panel title="Automatique">
            <OptionRow
              icon={Wifi}
              color={colors.success}
              label="À l’ouverture de Fenrir"
              hint="Synchronise dès que l’autre téléphone est à portée."
              value
              onChange={() => undefined}
            />
          </Panel>

          <Button
            variant="danger"
            icon={Unlink}
            label="Dissocier ce téléphone"
            onPress={() => {
              setSynced(false);
              setStep('intro');
            }}
          />
          <Text style={text.subtle}>
            Après dissociation, chaque téléphone garde sa copie du stock et plus
            rien n’est échangé.
          </Text>
        </>
      ) : null}
    </ScrollView>
  );
}

function OptionRow(props: {
  icon: typeof Camera;
  color: string;
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const Icon = props.icon;
  return (
    <View style={styles.option}>
      <Icon color={props.color} size={20} />
      <View style={styles.grow}>
        <Text style={text.body}>{props.label}</Text>
        <Text style={text.subtle}>{props.hint}</Text>
      </View>
      <Switch
        accessibilityLabel={`Partager : ${props.label}`}
        value={props.value}
        onValueChange={props.onChange}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor={colors.text}
      />
    </View>
  );
}

function Summary(props: { weapons: boolean; photos: boolean }) {
  const line = (on: boolean, label: string) => (
    <View style={styles.row}>
      {on ? (
        <Check color={colors.success} size={18} strokeWidth={2.4} />
      ) : (
        <Text style={styles.off}>—</Text>
      )}
      <Text style={[on ? text.body : text.subtle, styles.grow]}>
        {label}
        {on ? '' : ' : non partagé'}
      </Text>
    </View>
  );
  return (
    <>
      {line(true, 'Stocks, sacs, plan familial, carte, foyer')}
      {line(props.weapons, 'Armement et munitions')}
      {line(props.photos, 'Photos')}
    </>
  );
}

function Choice(props: {
  selected: boolean;
  label: string;
  hint: string;
  onPress: () => void;
}) {
  return (
    <Panel
      onPress={props.onPress}
      accessibilityLabel={props.label}
      accent={props.selected ? colors.primary : undefined}
    >
      <View style={styles.row}>
        <View style={[styles.radio, props.selected && styles.radioOn]} />
        <View style={styles.grow}>
          <Text style={text.body}>{props.label}</Text>
          <Text style={text.subtle}>{props.hint}</Text>
        </View>
      </View>
    </Panel>
  );
}

/** Faux QR code (maquette) : motifs de repérage et modules pseudo-aléatoires. */
function MockQr(props: { size: number }) {
  const n = 29;
  const cell = props.size / (n + 2);
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const finder = (x: number, y: number) =>
    x < 8 && y < 8
      ? [x, y]
      : x >= n - 8 && y < 8
      ? [x - (n - 7), y]
      : x < 8 && y >= n - 8
      ? [x, y - (n - 7)]
      : null;
  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const f = finder(x, y);
      let on: boolean;
      if (f) {
        const [fx, fy] = f;
        const ring = Math.max(Math.abs(fx - 3), Math.abs(fy - 3));
        on = fx < 7 && fy < 7 && ring !== 2;
      } else {
        on = rand() > 0.52;
      }
      if (on) {
        const px = (x + 1) * cell;
        const py = (y + 1) * cell;
        d += `M${px} ${py}h${cell}v${cell}h${-cell}z`;
      }
    }
  }
  return (
    <Svg width={props.size} height={props.size}>
      <Rect width={props.size} height={props.size} fill="#FFFFFF" rx={8} />
      <Path d={d} fill="#071018" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: sizes.screenPadding,
    paddingBottom: space.xl,
    gap: space.m,
  },
  mock: {
    color: colors.warning,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  grow: { flex: 1, minWidth: 0 },
  headline: { color: colors.text, fontSize: 17, fontWeight: '700' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    paddingVertical: space.xs,
  },
  qrBox: { alignItems: 'center', paddingVertical: space.s },
  verify: {
    alignItems: 'center',
    gap: 2,
    padding: space.m,
    borderRadius: radius.card,
    backgroundColor: colors.surfaceRaised,
  },
  verifyCode: {
    color: colors.primary,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 2,
    textAlign: 'center',
  },
  result: { color: colors.success, fontSize: 15, fontWeight: '700' },
  change: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    paddingVertical: space.xs,
  },
  who: {
    fontSize: 11,
    fontWeight: '800',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.s,
    paddingVertical: 2,
  },
  off: { color: colors.textSubtle, width: 18, textAlign: 'center' },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.textMuted,
  },
  radioOn: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
});
