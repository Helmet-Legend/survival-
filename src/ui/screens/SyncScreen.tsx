/**
 * MAQUETTE — Partage du foyer avec un autre téléphone.
 *
 * Écrans seulement : rien n'est encore envoyé ni reçu. Association par QR
 * code, puis synchronisation directe entre les deux téléphones (même Wi-Fi
 * ou partage de connexion de l'un d'eux), sans internet, sans compte, sans
 * serveur.
 */
import {
  ArrowLeftRight,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Crosshair,
  Home,
  QrCode,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Smartphone,
  Unlink,
  UserPlus,
  Wifi,
} from 'lucide-react-native';
import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { Button, Panel, ScreenTitle, StatusChip } from '../components/controls';
import { useNavigation } from '../navigation';
import { colors, radius, sizes, space, text, tint } from '../theme';

type Step =
  | 'intro'
  | 'share'
  | 'qr'
  | 'ownerDone'
  | 'scan'
  | 'merge'
  | 'joinDone'
  | 'paired';

const ALWAYS =
  'Stocks, sacs, documents, plan familial, carte, foyer, kit et plan d’achats';

/** Derniers changements reçus (exemple de maquette). */
const RECENT = [
  { who: 'Partenaire', what: 'Eau en bidons : −3 L', when: '08:41' },
  { who: 'Partenaire', what: 'Riz 1 kg ajouté (DDM 03/2028)', when: '08:40' },
  { who: 'Vous', what: 'Piles AA : −4', when: 'hier' },
  { who: 'Partenaire', what: 'Point « École » ajouté', when: 'hier' },
];

const NETWORK_TIP =
  'Pas de Wi-Fi ? Activez le partage de connexion sur l’un des téléphones et connectez-y l’autre. Aucune donnée mobile n’est utilisée.';

export function SyncScreen() {
  const navigation = useNavigation();
  const [step, setStep] = useState<Step>('intro');
  const [details, setDetails] = useState(false);
  const [weapons, setWeapons] = useState(false);
  const [photos, setPhotos] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);
  const [merge, setMerge] = useState(true);

  const options = (
    <>
      <OptionRow
        icon={Crosshair}
        color={colors.weapons}
        label="Armement et munitions"
        hint="Transférés chiffrés. Jamais montrés dans les notifications."
        value={weapons}
        onChange={setWeapons}
      />
      <OptionRow
        icon={Camera}
        color={colors.cyan}
        label="Photos"
        hint="Articles et documents. Plus long à transférer."
        value={photos}
        onChange={setPhotos}
      />
    </>
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
          <View style={styles.row}>
            <Smartphone color={colors.primary} size={22} />
            <ArrowLeftRight color={colors.textMuted} size={18} />
            <Smartphone color={colors.cyan} size={22} />
            <Text style={[text.body, styles.grow]}>
              Un stock, deux téléphones. Sans internet ni compte : chacun peut
              ajouter, consommer et modifier.
            </Text>
          </View>

          <Text style={text.label}>Sur ce téléphone…</Text>
          <BigChoice
            icon={Home}
            color={colors.primary}
            title="J’ai déjà le stock ici"
            hint="Ce téléphone affichera un code à scanner."
            onPress={() => setStep('share')}
          />
          <BigChoice
            icon={UserPlus}
            color={colors.cyan}
            title="Je rejoins un foyer"
            hint="Scannez le code affiché par l’autre téléphone."
            onPress={() => setStep('scan')}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: details }}
            accessibilityLabel="Ce qui est partagé"
            onPress={() => setDetails(!details)}
            style={styles.disclosure}
          >
            <Text style={[styles.link, styles.grow]}>Ce qui est partagé</Text>
            {details ? (
              <ChevronUp color={colors.cyan} size={20} />
            ) : (
              <ChevronDown color={colors.cyan} size={20} />
            )}
          </Pressable>
          {details ? (
            <Panel>
              <Line on label={ALWAYS} />
              <Line
                on={false}
                label="Armement, munitions et photos : au choix, au moment de partager"
              />
              <View style={styles.row}>
                <ShieldCheck color={colors.textMuted} size={18} />
                <Text style={[text.subtle, styles.grow]}>
                  Jamais : codes PIN, code de contrainte, réglages du téléphone.
                  Ouvert avec le code de contrainte, Fenrir ne synchronise rien.
                </Text>
              </View>
            </Panel>
          ) : null}
        </>
      ) : null}

      {step === 'share' ? (
        <>
          <Text style={styles.headline}>Que partager ?</Text>
          <Panel>
            <Line on label={ALWAYS} />
            <View style={styles.divider} />
            {options}
            <Text style={text.subtle}>Modifiable plus tard à tout moment.</Text>
          </Panel>
          <Button
            variant="primary"
            icon={QrCode}
            label="Afficher le code"
            onPress={() => setStep('qr')}
          />
          <Button label="Annuler" onPress={() => setStep('intro')} />
        </>
      ) : null}

      {step === 'qr' ? (
        <>
          <Panel>
            <Text style={[styles.headline, styles.center]}>
              Scannez ce code avec l’autre téléphone
            </Text>
            <View style={styles.qrBox}>
              <MockQr size={240} />
            </View>
            <Text style={[text.body, styles.center]}>
              Sur l’autre téléphone : Réglages › Partage du foyer › « Je rejoins
              un foyer ».
            </Text>
            <Text style={[styles.waiting, styles.center]}>
              En attente de l’autre téléphone…
            </Text>
          </Panel>
          <Text style={text.subtle}>
            {[
              'Partagé : stocks',
              weapons ? 'armement' : null,
              photos ? 'photos' : null,
            ]
              .filter(Boolean)
              .join(', ')}
            . Code valable 5 minutes. {NETWORK_TIP}
          </Text>
          <Button
            variant="primary"
            icon={Check}
            label="Maquette : simuler le scan"
            onPress={() => setStep('ownerDone')}
          />
          <Button label="Annuler" onPress={() => setStep('intro')} />
        </>
      ) : null}

      {step === 'scan' ? (
        <>
          <View style={styles.camera}>
            <View style={styles.frame}>
              <ScanLine color={colors.cyan} size={64} strokeWidth={1.2} />
            </View>
            <Text style={styles.cameraText}>
              Visez le code affiché sur l’autre téléphone
            </Text>
          </View>
          <Text style={text.subtle}>{NETWORK_TIP}</Text>
          <Button
            variant="primary"
            icon={Check}
            label="Maquette : simuler le scan"
            onPress={() => setStep('merge')}
          />
          <Button label="Annuler" onPress={() => setStep('intro')} />
        </>
      ) : null}

      {step === 'merge' ? (
        <>
          <Text style={styles.headline}>
            Ce téléphone contient déjà 23 articles
          </Text>
          <Text style={text.subtle}>
            Cette question n’apparaît que si ce téléphone a déjà un stock.
          </Text>
          <Choice
            selected={merge}
            label="Les réunir"
            hint="Recommandé. Rien n’est perdu : les articles des deux téléphones sont réunis."
            onPress={() => setMerge(true)}
          />
          <Choice
            selected={!merge}
            label="Les effacer"
            hint="Ce téléphone ne servait qu’à essayer Fenrir. Il ne garde que le stock partagé."
            onPress={() => setMerge(false)}
          />
          <Button
            variant="primary"
            icon={Check}
            label="Continuer"
            onPress={() => setStep('joinDone')}
          />
        </>
      ) : null}

      {step === 'ownerDone' || step === 'joinDone' ? (
        <>
          <View style={styles.done}>
            <CircleCheck color={colors.success} size={72} strokeWidth={1.6} />
            <Text style={styles.doneTitle}>Téléphones associés</Text>
            <Text style={[text.body, styles.center]}>
              {step === 'joinDone'
                ? 'Le stock partagé est arrivé : 148 articles, 3 sacs, plan familial.'
                : 'Le stock a été envoyé à l’autre téléphone.'}
            </Text>
            <Text style={[text.subtle, styles.center]}>
              Ensuite, tout se met à jour dès que les deux téléphones ont Fenrir
              ouvert à proximité.
            </Text>
          </View>
          <Button
            variant="primary"
            label="Terminé"
            onPress={() => setStep('paired')}
          />
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
                Fenrir ouvert sur les deux téléphones, sur le même Wi-Fi.{' '}
                {NETWORK_TIP}
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

          <Panel title="Partagé en plus des stocks">
            {options}
            <Text style={text.subtle}>
              Désactiver une option retire ces fiches de l’autre téléphone à la
              synchronisation suivante.
            </Text>
          </Panel>

          <Panel>
            <OptionRow
              icon={Wifi}
              color={colors.success}
              label="Synchroniser à l’ouverture"
              hint="Dès que l’autre téléphone est à portée."
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

function BigChoice(props: {
  icon: typeof Camera;
  color: string;
  title: string;
  hint: string;
  onPress: () => void;
}) {
  const Icon = props.icon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.title}. ${props.hint}`}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.big,
        { borderColor: tint(props.color, '88') },
        pressed && styles.pressed,
      ]}
    >
      <View
        style={[styles.bigIcon, { backgroundColor: tint(props.color, '22') }]}
      >
        <Icon color={props.color} size={28} strokeWidth={2} />
      </View>
      <View style={styles.grow}>
        <Text style={styles.bigTitle}>{props.title}</Text>
        <Text style={text.subtle}>{props.hint}</Text>
      </View>
    </Pressable>
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

function Line(props: { on: boolean; label: string }) {
  return (
    <View style={styles.row}>
      {props.on ? (
        <Check color={colors.success} size={18} strokeWidth={2.4} />
      ) : (
        <Text style={styles.off}>±</Text>
      )}
      <Text style={[props.on ? text.body : text.subtle, styles.grow]}>
        {props.label}
      </Text>
    </View>
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
  center: { textAlign: 'center' },
  headline: { color: colors.text, fontSize: 18, fontWeight: '700' },
  pressed: { opacity: 0.85 },
  big: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    padding: space.m,
    minHeight: 92,
    borderWidth: 1.5,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
  },
  bigIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  disclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.s,
  },
  link: { color: colors.cyan, fontSize: 15, fontWeight: '600' },
  divider: { height: 1, backgroundColor: colors.border },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    paddingVertical: space.xs,
  },
  qrBox: { alignItems: 'center', paddingVertical: space.s },
  waiting: { color: colors.cyan, fontSize: 15, fontWeight: '600' },
  camera: {
    height: 360,
    borderRadius: radius.card,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.l,
  },
  frame: {
    width: 220,
    height: 220,
    borderWidth: 3,
    borderColor: colors.cyan,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  done: {
    alignItems: 'center',
    gap: space.m,
    paddingVertical: space.xl,
  },
  doneTitle: { color: colors.text, fontSize: 24, fontWeight: '800' },
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
