/**
 * Partage du foyer avec un autre téléphone : association par QR code, puis
 * synchronisation directe sur le Wi-Fi local (ou le partage de connexion de
 * l'un des deux), sans internet, sans compte, sans serveur. Tout ce qui
 * circule est chiffré de bout en bout.
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
  QrCode as QrIcon,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Smartphone,
  Unlink,
  UserPlus,
  Wifi,
} from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import {
  forgetPeer,
  hostInvite,
  joinFromInvite,
  lastSyncedAt,
  listPeers,
  loadAutoSync,
  saveAutoSync,
  syncWithPeer,
  updatePeerOptions,
  type ExchangeResult,
  type Hosting,
  type SyncOptions,
} from '../../sync';
import { countPendingChanges } from '../../sync/store';
import {
  Button,
  Field,
  Notice,
  Panel,
  ScreenTitle,
  StatusChip,
} from '../components/controls';
import { QrCode } from '../components/QrCode';
import { formatSince } from '../format';
import { useNavigation } from '../navigation';
import { useSession } from '../session';
import { colors, radius, sizes, space, text, tint } from '../theme';
import { useLoader } from '../useLoader';

type Step = 'intro' | 'share' | 'qr' | 'scan' | 'working' | 'done';

const ALWAYS =
  'Stocks, sacs, documents, plan familial, carte, foyer, kit et plan d’achats';

const NETWORK_TIP =
  'Pas de Wi-Fi ? Activez le partage de connexion sur l’un des téléphones et connectez-y l’autre. Aucune donnée mobile n’est utilisée.';

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summary(result: ExchangeResult): string {
  const r = result.received;
  const changes = r.written + r.removed;
  return `Reçu : ${changes} modification${changes > 1 ? 's' : ''} · Envoyé : ${
    result.sent
  }`;
}

export function SyncScreen() {
  const session = useSession();
  const { db, network, scanSource, random } = session;
  const navigation = useNavigation();
  const ctx = { db, random };

  const { data, reload } = useLoader(async () => {
    const [peer] = await listPeers(db);
    return {
      peer: peer ?? null,
      last: peer ? await lastSyncedAt(db, peer.device) : null,
      auto: await loadAutoSync(db),
      pending: await countPendingChanges(db),
    };
  });

  const [step, setStep] = useState<Step>('intro');
  const [details, setDetails] = useState(false);
  const [options, setOptions] = useState<SyncOptions>({
    weapons: false,
    photos: false,
  });
  const [invite, setInvite] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExchangeResult | null>(null);
  const [confirmForget, setConfirmForget] = useState(false);
  const hosting = useRef<Hosting | null>(null);
  const autoStarted = useRef(false);
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
      hosting.current?.cancel();
    },
    [],
  );

  const run = async (work: () => Promise<ExchangeResult>) => {
    setError(null);
    setBusy(true);
    try {
      const r = await work();
      if (mounted.current) {
        setResult(r);
        setStep('done');
      }
    } catch (e) {
      if (mounted.current) {
        setError(message(e));
      }
    } finally {
      if (mounted.current) {
        setBusy(false);
        void reload();
      }
    }
  };

  const syncNow = () => {
    const peer = data?.peer;
    if (peer) {
      void run(() => syncWithPeer(ctx, network, peer));
    }
  };

  // Synchronisation dès l'ouverture de l'écran, si elle est activée.
  useEffect(() => {
    if (data?.peer && data.auto && network.available && !autoStarted.current) {
      autoStarted.current = true;
      syncNow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une fois, au premier chargement
  }, [data]);

  const showCode = async () => {
    setError(null);
    try {
      const h = await hostInvite(ctx, network, options);
      hosting.current = h;
      setInvite(h.text);
      setStep('qr');
      h.done.then(
        r => {
          hosting.current = null;
          if (mounted.current) {
            setResult(r);
            setStep('done');
            void reload();
          }
        },
        () => undefined,
      );
    } catch (e) {
      setError(message(e));
    }
  };

  const join = (pasted: string) =>
    run(() => joinFromInvite(ctx, network, pasted.trim()));

  const scan = async () => {
    setError(null);
    if (!scanSource.scanQr) {
      return;
    }
    try {
      const scanned = await scanSource.scanQr();
      if (scanned) {
        setStep('working');
        await join(scanned);
      }
    } catch (e) {
      setError(message(e));
    }
  };

  const title = (
    <ScreenTitle
      title="Partage du foyer"
      onBack={navigation.close}
      backLabel={navigation.backLabel}
    />
  );

  if (data === null) {
    return <View style={styles.page}>{title}</View>;
  }

  const unavailable = !network.available ? (
    <Notice
      tone="error"
      message="Partage indisponible sur cet appareil : il faut l’application Android sur les deux téléphones."
    />
  ) : null;
  const errorNotice = error ? <Notice tone="error" message={error} /> : null;

  const optionRows = (
    value: SyncOptions,
    onChange: (next: SyncOptions) => void,
  ) => (
    <>
      <OptionRow
        icon={Crosshair}
        color={colors.weapons}
        label="Armement et munitions"
        hint="Transférés chiffrés. Jamais montrés dans les notifications."
        value={value.weapons}
        onChange={v => onChange({ ...value, weapons: v })}
      />
      <OptionRow
        icon={Camera}
        color={colors.cyan}
        label="Photos"
        hint="Articles et documents. Plus long à transférer."
        value={value.photos}
        onChange={v => onChange({ ...value, photos: v })}
      />
    </>
  );

  // --- Résultat d'un échange -------------------------------------------------
  if (step === 'done' && result) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        {title}
        <View style={styles.done}>
          <CircleCheck color={colors.success} size={72} strokeWidth={1.6} />
          <Text style={styles.doneTitle}>
            {result.paired ? 'Téléphones associés' : 'Synchronisé'}
          </Text>
          <Text style={[text.body, styles.center]}>{summary(result)}</Text>
          <Text style={[text.subtle, styles.center]}>
            Ensuite, ouvrez le partage du foyer sur les deux téléphones pour
            vous mettre à jour.
          </Text>
        </View>
        <Button
          variant="primary"
          label="Terminé"
          onPress={() => {
            setResult(null);
            setStep('intro');
          }}
        />
      </ScrollView>
    );
  }

  // --- Téléphone déjà associé -------------------------------------------------
  if (data.peer) {
    const peer = data.peer;
    return (
      <ScrollView contentContainerStyle={styles.page}>
        {title}
        {unavailable}
        <Panel>
          <View style={styles.row}>
            <Smartphone color={colors.success} size={24} />
            <View style={styles.grow}>
              <Text style={styles.headline}>Téléphone associé</Text>
              <Text style={text.subtle}>
                {data.last
                  ? `Synchronisé ${formatSince(data.last)}`
                  : 'Pas encore synchronisé'}
              </Text>
            </View>
            <StatusChip
              tone={data.pending > 0 ? 'warn' : 'ok'}
              label={data.pending > 0 ? 'À synchroniser' : 'À jour'}
            />
          </View>
          {data.pending > 0 ? (
            <Text style={text.subtle}>
              {data.pending} modification{data.pending > 1 ? 's' : ''} à
              envoyer.
            </Text>
          ) : null}
          <Button
            variant="primary"
            icon={RefreshCw}
            label={busy ? 'Recherche de l’autre téléphone…' : 'Synchroniser'}
            disabled={busy || !network.available}
            onPress={syncNow}
          />
          <Text style={text.subtle}>
            Ouvrez le partage du foyer sur l’autre téléphone, sur le même Wi-Fi.{' '}
            {NETWORK_TIP}
          </Text>
        </Panel>
        {errorNotice}

        <Panel title="Partagé en plus des stocks">
          {optionRows(peer.options, next => {
            void updatePeerOptions(db, peer.device, next).then(reload);
          })}
          <Text style={text.subtle}>
            L’autre téléphone doit aussi l’activer. Désactiver une option arrête
            l’envoi de ces fiches.
          </Text>
        </Panel>

        <Panel>
          <OptionRow
            icon={Wifi}
            color={colors.success}
            label="Synchroniser à l’ouverture"
            hint="Dès que cet écran s’ouvre, si l’autre téléphone est à portée."
            value={data.auto}
            onChange={v => {
              void saveAutoSync(db, v).then(reload);
            }}
          />
        </Panel>

        <Button
          variant="danger"
          icon={Unlink}
          label={
            confirmForget
              ? 'Confirmer : dissocier ce téléphone'
              : 'Dissocier ce téléphone'
          }
          onPress={() => {
            if (!confirmForget) {
              setConfirmForget(true);
              return;
            }
            setConfirmForget(false);
            void forgetPeer(db, peer.device).then(reload);
          }}
        />
        <Text style={text.subtle}>
          Après dissociation, chaque téléphone garde sa copie du stock et plus
          rien n’est échangé.
        </Text>
      </ScrollView>
    );
  }

  // --- Association -------------------------------------------------------------
  return (
    <ScrollView contentContainerStyle={styles.page}>
      {title}
      {unavailable}

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
            disabled={!network.available}
            onPress={() => setStep('share')}
          />
          <BigChoice
            icon={UserPlus}
            color={colors.cyan}
            title="Je rejoins un foyer"
            hint="Scannez le code affiché par l’autre téléphone."
            disabled={!network.available}
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
                  Tout ce qui circule est chiffré.
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
            {optionRows(options, setOptions)}
            <Text style={text.subtle}>Modifiable plus tard à tout moment.</Text>
          </Panel>
          {errorNotice}
          <Button
            variant="primary"
            icon={QrIcon}
            label="Afficher le code"
            onPress={() => {
              void showCode();
            }}
          />
          <Button label="Annuler" onPress={() => setStep('intro')} />
        </>
      ) : null}

      {step === 'qr' && invite ? (
        <>
          <Panel>
            <Text style={[styles.headline, styles.center]}>
              Scannez ce code avec l’autre téléphone
            </Text>
            <View style={styles.qrBox}>
              <QrCode text={invite} size={260} />
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
            Code valable 5 minutes, une seule fois. Les deux téléphones doivent
            être sur le même Wi-Fi. {NETWORK_TIP}
          </Text>
          <Button
            label="Annuler"
            onPress={() => {
              hosting.current?.cancel();
              hosting.current = null;
              setInvite(null);
              setStep('intro');
            }}
          />
        </>
      ) : null}

      {step === 'scan' || step === 'working' ? (
        <>
          {scanSource.scanQr ? (
            <Button
              variant="primary"
              icon={ScanLine}
              label={
                busy ? 'Connexion à l’autre téléphone…' : 'Scanner le code'
              }
              disabled={busy}
              onPress={() => {
                void scan();
              }}
            />
          ) : null}
          <Field
            label="Ou collez le code"
            value={code}
            onChangeText={setCode}
            placeholder="FENRIR1.…"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Button
            icon={Check}
            label="Rejoindre"
            disabled={busy || code.trim() === ''}
            onPress={() => {
              void join(code);
            }}
          />
          {errorNotice}
          <Text style={text.subtle}>{NETWORK_TIP}</Text>
          <Text style={text.subtle}>
            Le stock déjà présent sur ce téléphone est réuni avec celui du foyer
            : rien n’est perdu.
          </Text>
          <Button
            label="Annuler"
            disabled={busy}
            onPress={() => {
              setError(null);
              setStep('intro');
            }}
          />
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
  disabled?: boolean;
  onPress: () => void;
}) {
  const Icon = props.icon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.title}. ${props.hint}`}
      accessibilityState={{ disabled: props.disabled === true }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.big,
        { borderColor: tint(props.color, '88') },
        pressed && styles.pressed,
        props.disabled && styles.disabled,
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

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: sizes.screenPadding,
    paddingBottom: space.xl,
    gap: space.m,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  grow: { flex: 1, minWidth: 0 },
  center: { textAlign: 'center' },
  headline: { color: colors.text, fontSize: 18, fontWeight: '700' },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.45 },
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
  qrBox: {
    alignItems: 'center',
    paddingVertical: space.s,
  },
  waiting: { color: colors.cyan, fontSize: 15, fontWeight: '600' },
  done: {
    alignItems: 'center',
    gap: space.m,
    paddingVertical: space.xl,
  },
  doneTitle: { color: colors.text, fontSize: 24, fontWeight: '800' },
  off: { color: colors.textSubtle, width: 18, textAlign: 'center' },
});
