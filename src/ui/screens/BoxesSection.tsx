/**
 * Dossier « Boîtes » de l'écran Stocks : l'inventaire de chaque boîte de
 * rangement fermée, fait à partir du stock. Une boîte n'a qu'un numéro et
 * une étiquette QR ; la scanner ouvre son contenu et sa prochaine
 * péremption. L'étiquette ne porte que le numéro et un identifiant, jamais
 * le contenu.
 */
import {
  ArrowLeft,
  Box as BoxIcon,
  Plus,
  Printer,
  QrCode as QrIcon,
  Save,
  ScanQrCode,
  Square,
  SquareCheck,
  Trash2,
} from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  boxQr,
  parseBoxQr,
  type Box,
  type BoxCandidate,
  type BoxSummary,
} from '../../inventory';
import {
  Button,
  EmptyState,
  Notice,
  Panel,
  SearchField,
  StatusChip,
} from '../components/controls';
import { QrCode, qrSvg } from '../components/QrCode';
import { formatDate, formatNumber, parseDecimal, UNIT_LABELS } from '../format';
import { useSession } from '../session';
import { colors, radius, space, text } from '../theme';
import { useBack } from '../useBackHandler';
import { useLoader } from '../useLoader';
import { useProgressive } from '../useProgressive';

type Feedback = { message: string; tone: 'ok' | 'error' } | null;

export const BOX_COLOR = colors.cyan;

function articles(count: number): string {
  return `${count} article${count > 1 ? 's' : ''}`;
}

function failure(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** État d'une boîte : périmés d'abord, puis péremptions proches. */
export function boxStatus(
  box: BoxSummary,
): { tone: 'danger' | 'warn'; label: string } | null {
  if (box.expiredLots > 0) {
    return {
      tone: 'danger',
      label: `${box.expiredLots} périmé${box.expiredLots > 1 ? 's' : ''}`,
    };
  }
  if (box.soonLots > 0) {
    return { tone: 'warn', label: `${box.soonLots} sous 30 j` };
  }
  return null;
}

/** « 3 articles · prochaine péremption 14/03/2027 », ou « Vide ». */
function boxDetail(box: BoxSummary): string {
  if (box.itemCount === 0) {
    return 'Vide';
  }
  return [
    articles(box.itemCount),
    box.nextExpiration
      ? `prochaine péremption ${formatDate(box.nextExpiration)}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Page de l'étiquette : le QR et le numéro, rien d'autre. */
export function labelHtml(box: Box): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Boîte N° ${
    box.labelNo
  }</title>
<style>
  @page { margin: 12mm; }
  body { font-family: sans-serif; margin: 0; }
  .label { width: 60mm; box-sizing: border-box; border: 0.3mm dashed #999;
    padding: 4mm; text-align: center; }
  .no { font-size: 22pt; font-weight: bold; margin-top: 2mm; }
</style></head><body>
<div class="label">${qrSvg(boxQr(box.id), '50mm')}
<div class="no">N° ${box.labelNo}</div></div>
</body></html>`;
}

/** Étiquette d'une boîte : à enregistrer (Drive, Téléchargements…) ou imprimer. */
function LabelPanel(props: { box: Box }) {
  const { files } = useSession();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const { box } = props;
  return (
    <Panel accent={BOX_COLOR} style={styles.form}>
      <View style={styles.qr}>
        <QrCode
          text={boxQr(box.id)}
          size={200}
          accessibilityLabel={`Étiquette QR de la boîte N° ${box.labelNo}`}
        />
      </View>
      <Text style={[text.h2, styles.center]}>N° {box.labelNo}</Text>
      <Text style={[text.muted, styles.center]}>
        Seulement le numéro : le contenu reste dans Fenrir.
      </Text>
      {feedback ? <Notice {...feedback} /> : null}
      <View style={styles.row}>
        {files.available ? (
          <Button
            compact
            variant="primary"
            icon={Save}
            label="Enregistrer l’étiquette"
            onPress={() => {
              setFeedback(null);
              files
                .saveText(
                  `etiquette-boite-${box.labelNo}.html`,
                  'text/html',
                  labelHtml(box),
                )
                .then(saved =>
                  setFeedback(
                    saved
                      ? {
                          tone: 'ok',
                          message:
                            'Étiquette enregistrée : ouvrez-la sur l’ordinateur pour l’imprimer.',
                        }
                      : { tone: 'error', message: 'Enregistrement annulé.' },
                  ),
                )
                .catch((e: unknown) =>
                  setFeedback({ tone: 'error', message: failure(e) }),
                );
            }}
          />
        ) : null}
        {files.printHtml ? (
          <Button
            compact
            variant="secondary"
            icon={Printer}
            label="Imprimer"
            onPress={() => {
              setFeedback(null);
              files
                .printHtml?.(`Boîte N° ${box.labelNo}`, labelHtml(box))
                .catch((e: unknown) =>
                  setFeedback({ tone: 'error', message: failure(e) }),
                );
            }}
          />
        ) : null}
      </View>
    </Panel>
  );
}

/** Quantité saisie : − / champ / +, bornée entre 0 et `max`. */
function QuantityField(props: {
  name: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const clamp = (v: number) =>
    Math.min(props.max, Math.max(0, Number.isFinite(v) ? v : 0));
  return (
    <View style={styles.qty}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${props.name} : un de moins`}
        onPress={() => props.onChange(clamp(props.value - 1))}
        style={styles.step}
      >
        <Text style={styles.stepText}>−</Text>
      </Pressable>
      <TextInput
        accessibilityLabel={`${props.name} : quantité dans la boîte`}
        keyboardType="decimal-pad"
        value={typed ?? formatNumber(props.value)}
        onChangeText={setTyped}
        onEndEditing={() => {
          if (typed !== null) {
            props.onChange(clamp(parseDecimal(typed)));
            setTyped(null);
          }
        }}
        style={styles.qtyInput}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${props.name} : un de plus`}
        onPress={() => props.onChange(clamp(props.value + 1))}
        style={styles.step}
      >
        <Text style={styles.stepText}>+</Text>
      </Pressable>
    </View>
  );
}

/** Une ligne de « Qu'y a-t-il dedans ? » ; redessinée seulement si elle change. */
const PickRow = React.memo(function PickRow(props: {
  candidate: BoxCandidate;
  value: number;
  onSet: (c: BoxCandidate, value: number) => void;
}) {
  const { candidate: c, value, onSet } = props;
  const max = c.loose + c.inBox;
  const checked = value > 0;
  const Icon = checked ? SquareCheck : Square;
  return (
    <View style={[styles.pick, checked && styles.pickOn]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={`${c.name} dans la boîte`}
        onPress={() => onSet(c, checked ? 0 : max)}
        style={styles.pickMain}
      >
        <Icon color={checked ? BOX_COLOR : colors.textMuted} size={24} />
        <View style={styles.grow}>
          <Text style={text.body}>{c.name}</Text>
          <Text style={text.subtle}>
            {formatNumber(max - value)} {UNIT_LABELS[c.unit]} hors de cette
            boîte
          </Text>
        </View>
      </Pressable>
      {checked ? (
        <QuantityField
          name={c.name}
          value={value}
          max={max}
          onChange={v => onSet(c, v)}
        />
      ) : null}
    </View>
  );
},
samePick);

function samePick(
  a: { candidate: BoxCandidate; value: number },
  b: { candidate: BoxCandidate; value: number },
): boolean {
  return (
    a.value === b.value &&
    a.candidate.itemId === b.candidate.itemId &&
    a.candidate.name === b.candidate.name &&
    a.candidate.loose === b.candidate.loose &&
    a.candidate.inBox === b.candidate.inBox
  );
}

/**
 * « Qu'y a-t-il dedans ? » : on coche les articles du stock rangés dans la
 * boîte (tout ce qui est disponible par défaut), et on règle la quantité
 * si l'article est réparti entre plusieurs boîtes.
 */
function FillPanel(props: {
  box: Box;
  onSaved: (message: string) => Promise<void>;
}) {
  const { boxes } = useSession();
  const [query, setQuery] = useState('');
  const [targets, setTargets] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const { box } = props;
  const { data } = useLoader(
    () => boxes.candidates(box.id, query),
    [box.id, query],
  );
  const target = (c: BoxCandidate) => targets[c.itemId] ?? c.inBox;
  const changed = (data ?? []).filter(c => target(c) !== c.inBox);
  // Stable : une case cochée ne redessine que sa ligne.
  const set = useCallback(
    (c: BoxCandidate, value: number) =>
      setTargets(t => ({ ...t, [c.itemId]: value })),
    [],
  );
  const progressive = useProgressive(data?.length ?? 0, query);

  const save = async () => {
    setError(null);
    try {
      for (const c of changed) {
        const delta = target(c) - c.inBox;
        if (delta > 0) {
          await boxes.put(box.id, c.itemId, delta);
        } else {
          await boxes.take(box.id, c.itemId, -delta);
        }
      }
      setTargets({});
      await props.onSaved(`Contenu de la boîte N° ${box.labelNo} enregistré.`);
    } catch (e) {
      setError(failure(e));
    }
  };

  return (
    <Panel accent={BOX_COLOR} style={styles.form}>
      <Text style={text.h3}>Qu’y a-t-il dedans ?</Text>
      <Text style={text.muted}>
        Cochez ce qui est dans la boîte. Si un article est réparti entre
        plusieurs boîtes, réglez la quantité : le reste reste disponible pour
        les autres.
      </Text>
      <SearchField
        label="Rechercher dans le stock"
        value={query}
        onChangeText={setQuery}
        placeholder="Rechercher un article…"
      />
      {error ? <Notice tone="error" message={error} /> : null}
      {data?.length === 0 ? (
        <Text style={text.subtle}>Aucun article disponible dans le stock.</Text>
      ) : null}
      {(data ?? []).slice(0, progressive.visible).map(c => (
        <PickRow key={c.itemId} candidate={c} value={target(c)} onSet={set} />
      ))}
      {progressive.rest > 0 ? (
        <Button
          variant="ghost"
          label={`Afficher la suite (${progressive.rest})`}
          onPress={progressive.more}
        />
      ) : null}
      <Button
        variant="primary"
        label="Valider"
        disabled={changed.length === 0}
        onPress={() => void save()}
      />
    </Panel>
  );
}

/** Une boîte ouverte : contenu, prochaine péremption, contenu, étiquette. */
function BoxView(props: {
  id: string;
  scanned: boolean;
  onBack: () => void;
  onFeedback: (feedback: Feedback) => void;
}) {
  const { boxes } = useSession();
  const [panel, setPanel] = useState<'label' | 'fill' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const { data, error, reload } = useLoader(async () => {
    const [box, lines] = await Promise.all([
      boxes.summary(props.id),
      boxes.contents(props.id),
    ]);
    return { box, lines };
  }, [props.id]);

  const back = (
    <View style={styles.back}>
      <Button
        variant="ghost"
        compact
        icon={ArrowLeft}
        label="Toutes les boîtes"
        onPress={props.onBack}
      />
    </View>
  );
  if (error) {
    return (
      <>
        {back}
        <Notice tone="error" message={error} />
      </>
    );
  }
  if (data === null) {
    return back;
  }
  const { box, lines } = data;
  const status = boxStatus(box);
  return (
    <>
      {back}
      {props.scanned ? <Notice tone="ok" message="Étiquette lue." /> : null}
      {saved ? <Notice tone="ok" message={saved} /> : null}
      <View style={styles.head}>
        <View style={styles.grow}>
          <Text accessibilityRole="header" style={text.h2}>
            Boîte N° {box.labelNo}
          </Text>
          <Text style={text.muted}>{boxDetail(box)}</Text>
        </View>
        {status ? <StatusChip tone={status.tone} label={status.label} /> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Supprimer la boîte N° ${box.labelNo}`}
          onPress={() => setConfirming(true)}
          hitSlop={8}
          style={styles.iconButton}
        >
          <Trash2 color={colors.danger} size={18} />
        </Pressable>
      </View>
      {confirming ? (
        <Panel accent={colors.danger} style={styles.form}>
          <Text style={text.body}>
            Supprimer la boîte N° {box.labelNo} ? Son contenu reste dans le
            stock.
          </Text>
          <View style={styles.row}>
            <Button
              variant="danger"
              label="Oui, supprimer"
              onPress={() => {
                boxes
                  .delete(box.id)
                  .then(() => {
                    props.onFeedback({
                      message: `Boîte N° ${box.labelNo} supprimée.`,
                      tone: 'ok',
                    });
                    props.onBack();
                  })
                  .catch((e: unknown) =>
                    props.onFeedback({ message: failure(e), tone: 'error' }),
                  );
              }}
            />
            <Button
              variant="ghost"
              label="Annuler"
              onPress={() => setConfirming(false)}
            />
          </View>
        </Panel>
      ) : null}
      <View style={styles.row}>
        <Button
          compact
          variant={panel === 'fill' ? 'primary' : 'secondary'}
          icon={BoxIcon}
          label="Choisir le contenu"
          onPress={() => setPanel(panel === 'fill' ? null : 'fill')}
        />
        <Button
          compact
          variant={panel === 'label' ? 'primary' : 'secondary'}
          icon={QrIcon}
          label="Étiquette"
          onPress={() => setPanel(panel === 'label' ? null : 'label')}
        />
      </View>
      {panel === 'label' ? <LabelPanel box={box} /> : null}
      {panel === 'fill' ? (
        <FillPanel
          box={box}
          onSaved={async message => {
            setSaved(message);
            setPanel(null);
            await reload();
          }}
        />
      ) : null}
      {lines.length === 0 && panel !== 'fill' ? (
        <EmptyState
          icon={BoxIcon}
          title="Cette boîte est vide."
          message="Touchez « Choisir le contenu »."
        />
      ) : null}
      {lines.map(line => {
        const unit = UNIT_LABELS[line.unit];
        return (
          <View
            key={line.itemId}
            accessible
            accessibilityLabel={`${line.name}, ${formatNumber(
              line.quantity,
            )} ${unit}`}
            style={[styles.card, line.expired > 0 && styles.cardDanger]}
          >
            <Text style={text.h3}>{line.name}</Text>
            <Text style={text.muted}>
              {formatNumber(line.quantity)} {unit}
              {line.nextExpiration
                ? ` · péremption ${formatDate(line.nextExpiration)}`
                : line.expired > 0
                ? ''
                : ' · sans péremption'}
            </Text>
            {line.expired > 0 ? (
              <Text style={styles.danger}>
                {formatNumber(line.expired)} {unit} périmé(s)
              </Text>
            ) : null}
          </View>
        );
      })}
    </>
  );
}

/** Liste des boîtes, création et scan d'une étiquette. */
export function BoxesSection(props: {
  /** Boîte à ouvrir d'emblée : lue par le scanner, ou touchée sur un lot. */
  initial?: { id: string; scanned: boolean } | null;
}) {
  const { boxes, scanSource } = useSession();
  const [open, setOpen] = useState<{ id: string; scanned: boolean } | null>(
    props.initial ?? null,
  );
  const [feedback, setFeedback] = useState<Feedback>(null);
  useBack(open !== null, () => setOpen(null));
  const { data, error } = useLoader(() => boxes.list(), [open]);

  const scan = async () => {
    setFeedback(null);
    try {
      const read = await scanSource.scanQr?.();
      if (!read) {
        return;
      }
      const id = parseBoxQr(read);
      const known = id !== null && (await boxes.list()).some(b => b.id === id);
      if (id === null) {
        setFeedback({
          tone: 'error',
          message: 'Ce QR code n’est pas une étiquette de boîte Fenrir.',
        });
      } else if (!known) {
        setFeedback({
          tone: 'error',
          message: 'Cette étiquette ne correspond à aucune boîte du coffre.',
        });
      } else {
        setOpen({ id, scanned: true });
      }
    } catch (e) {
      setFeedback({ tone: 'error', message: failure(e) });
    }
  };

  if (open !== null) {
    return (
      <>
        {feedback ? <Notice {...feedback} /> : null}
        <BoxView
          key={open.id}
          id={open.id}
          scanned={open.scanned}
          onBack={() => setOpen(null)}
          onFeedback={setFeedback}
        />
      </>
    );
  }

  const list = data ?? [];
  return (
    <>
      <Text style={text.muted}>
        Collez l’étiquette sur la boîte fermée : en la scannant, Fenrir affiche
        son contenu.
      </Text>
      {feedback ? <Notice {...feedback} /> : null}
      {error ? <Notice tone="error" message={error} /> : null}
      <View style={styles.row}>
        <Button
          compact
          variant="primary"
          icon={Plus}
          label="Nouvelle boîte"
          onPress={() => {
            setFeedback(null);
            boxes
              .create()
              .then(box => setOpen({ id: box.id, scanned: false }))
              .catch((e: unknown) =>
                setFeedback({ tone: 'error', message: failure(e) }),
              );
          }}
        />
        {scanSource.scanQr ? (
          <Button
            compact
            variant="secondary"
            icon={ScanQrCode}
            label="Scanner une boîte"
            onPress={() => void scan()}
          />
        ) : null}
      </View>
      {data !== null && list.length === 0 ? (
        <EmptyState
          icon={BoxIcon}
          title="Aucune boîte."
          message="Touchez « Nouvelle boîte »."
        />
      ) : null}
      {list.map(box => {
        const status = boxStatus(box);
        return (
          <Pressable
            key={box.id}
            accessibilityRole="button"
            accessibilityLabel={`Boîte N° ${box.labelNo} : ${boxDetail(box)}${
              status ? `, ${status.label}` : ''
            }`}
            onPress={() => setOpen({ id: box.id, scanned: false })}
            style={({ pressed }) => [styles.boxRow, pressed && styles.pressed]}
          >
            <View style={styles.badge}>
              <Text style={styles.badgeText}>N° {box.labelNo}</Text>
            </View>
            <View style={styles.grow}>
              <Text style={text.h3}>Boîte N° {box.labelNo}</Text>
              <Text style={text.subtle}>{boxDetail(box)}</Text>
            </View>
            {status ? (
              <StatusChip tone={status.tone} label={status.label} />
            ) : null}
          </Pressable>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.m },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.82 },
  back: { alignItems: 'flex-start' },
  center: { textAlign: 'center' },
  qr: {
    alignSelf: 'center',
    padding: space.s,
    backgroundColor: '#FFFFFF',
    borderRadius: radius.card,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pick: {
    gap: space.s,
    padding: space.m,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickOn: { borderColor: BOX_COLOR },
  pickMain: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  qty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    alignSelf: 'flex-end',
  },
  step: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { color: colors.text, fontSize: 20 },
  qtyInput: {
    minWidth: 64,
    height: 44,
    paddingHorizontal: space.s,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderActive,
    color: colors.text,
    fontSize: 16,
    textAlign: 'center',
  },
  card: {
    gap: space.xs,
    padding: space.m,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
  },
  cardDanger: { borderColor: colors.danger },
  danger: { color: colors.danger, fontSize: 14 },
  boxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    padding: space.m,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
  },
  badge: {
    minWidth: 56,
    height: 44,
    paddingHorizontal: space.s,
    borderRadius: 12,
    backgroundColor: `${BOX_COLOR}26`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: BOX_COLOR, fontWeight: '800', fontSize: 16 },
});
