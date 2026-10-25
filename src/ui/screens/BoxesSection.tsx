/**
 * Dossier « Boîtes » de l'écran Stocks : l'inventaire de chaque boîte de
 * rangement fermée, fait à partir du stock. Chaque boîte a un numéro et une
 * étiquette QR ; la scanner ouvre son contenu et sa prochaine péremption.
 * L'étiquette ne porte que le numéro et un identifiant, jamais le contenu.
 */
import {
  ArrowLeft,
  Box as BoxIcon,
  Pencil,
  Plus,
  Printer,
  QrCode as QrIcon,
  ScanQrCode,
  Trash2,
} from 'lucide-react-native';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  boxQr,
  boxTitle,
  parseBoxQr,
  type Box,
  type BoxCandidate,
  type BoxSummary,
} from '../../inventory';
import {
  Button,
  EmptyState,
  Field,
  Notice,
  Panel,
  SearchField,
  StatusChip,
  Stepper,
} from '../components/controls';
import { QrCode, qrSvg } from '../components/QrCode';
import { formatDate, formatNumber, UNIT_LABELS } from '../format';
import { useSession } from '../session';
import { colors, radius, space, text } from '../theme';
import { useLoader } from '../useLoader';

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

/** Une ligne d'état sous le titre : emplacement, contenu, péremption. */
function boxDetail(box: BoxSummary): string {
  return [
    box.location,
    box.itemCount === 0 ? 'Vide' : articles(box.itemCount),
    box.nextExpiration ? `péremption ${formatDate(box.nextExpiration)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Page imprimée : une étiquette par boîte (QR et numéro seulement), trois
 * par ligne, sans couper une étiquette entre deux pages.
 */
export function labelsHtml(boxes: readonly Box[]): string {
  const labels = boxes
    .map(
      b => `<div class="label">${qrSvg(boxQr(b.id), '45mm')}
<div class="no">N° ${b.labelNo}</div></div>`,
    )
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Étiquettes Fenrir</title>
<style>
  @page { margin: 10mm; }
  body { font-family: sans-serif; margin: 0; }
  .sheet { display: flex; flex-wrap: wrap; gap: 4mm; }
  .label { width: 58mm; box-sizing: border-box; border: 0.3mm dashed #999;
    padding: 3mm; text-align: center; break-inside: avoid; page-break-inside: avoid; }
  .no { font-size: 20pt; font-weight: bold; margin-top: 1mm; }
</style></head><body><div class="sheet">
${labels}
</div></body></html>`;
}

function BoxForm(props: {
  initial?: Box;
  nextNo?: number;
  onSubmit: (name: string, location: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(props.initial?.name ?? '');
  const [location, setLocation] = useState(props.initial?.location ?? '');
  const [error, setError] = useState<string | null>(null);
  return (
    <Panel accent={BOX_COLOR} style={styles.form}>
      {props.initial ? null : (
        <>
          <Text style={text.h3}>Nouvelle boîte : N° {props.nextNo}</Text>
          <Text style={text.muted}>
            Le numéro est donné automatiquement, à la suite des autres boîtes.
          </Text>
        </>
      )}
      <Field
        label="Nom (facultatif)"
        value={name}
        onChangeText={setName}
        placeholder="Ex : Conserves, pharmacie"
        maxLength={60}
        error={error}
      />
      <Field
        label="Emplacement (facultatif)"
        value={location}
        onChangeText={setLocation}
        placeholder="Ex : garage, étagère du haut"
        maxLength={60}
      />
      <View style={styles.row}>
        <Button
          variant="primary"
          label={props.initial ? 'Enregistrer' : 'Créer la boîte'}
          onPress={() => {
            props.onSubmit(name, location).catch((e: unknown) => {
              setError(failure(e));
            });
          }}
        />
        <Button variant="ghost" label="Annuler" onPress={props.onCancel} />
      </View>
    </Panel>
  );
}

/** Étiquette d'une boîte : QR et numéro, à afficher ou imprimer. */
function LabelPanel(props: { box: Box }) {
  const { files } = useSession();
  const [error, setError] = useState<string | null>(null);
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
      <Text style={text.muted}>
        L’étiquette ne porte que ce numéro : le contenu reste dans le coffre
        chiffré et ne s’affiche qu’après déverrouillage de Fenrir.
      </Text>
      {error ? <Notice tone="error" message={error} /> : null}
      {files.printHtml ? (
        <Button
          compact
          variant="primary"
          icon={Printer}
          label="Imprimer l’étiquette"
          onPress={() => {
            setError(null);
            files
              .printHtml?.(`Étiquette N° ${box.labelNo}`, labelsHtml([box]))
              .catch((e: unknown) => setError(failure(e)));
          }}
        />
      ) : null}
    </Panel>
  );
}

/** Pas du réglage : 1 pour les pièces, kilos et litres ; 100 en g et mL. */
function stepOf(candidate: BoxCandidate): number {
  return candidate.unit === 'g' || candidate.unit === 'mL' ? 100 : 1;
}

/**
 * Contenu de la boîte choisi dans le stock : pour chaque article, la
 * quantité voulue dans la boîte. Le total du stock ne change pas.
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
  const { data, reload } = useLoader(
    () => boxes.candidates(box.id, query),
    [box.id, query],
  );
  const target = (c: BoxCandidate) => targets[c.itemId] ?? c.inBox;
  const changed = (data ?? []).filter(c => target(c) !== c.inBox);

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
      await reload();
      await props.onSaved(`Contenu de la boîte N° ${box.labelNo} enregistré.`);
    } catch (e) {
      setError(failure(e));
    }
  };

  return (
    <Panel accent={BOX_COLOR} style={styles.form}>
      <Text style={text.muted}>
        Choisissez dans le stock ce qui est dans cette boîte, et combien. Le
        total du stock ne change pas : les lots qui périment le plus tard
        partent dans la boîte fermée, les plus proches restent à portée de main.
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
      {data?.map(c => {
        const value = target(c);
        const step = stepOf(c);
        const max = c.loose + c.inBox;
        const unit = UNIT_LABELS[c.unit];
        return (
          <View key={c.itemId} style={styles.candidate}>
            <View style={styles.grow}>
              <Text style={text.body}>{c.name}</Text>
              <Text style={text.subtle}>
                {formatNumber(max - value)} {unit} hors boîte
              </Text>
            </View>
            <Stepper
              value={formatNumber(value)}
              canDecrease={value > 0}
              canIncrease={value < max}
              decreaseLabel={`${c.name} : un de moins dans la boîte`}
              increaseLabel={`${c.name} : un de plus dans la boîte`}
              onDecrease={() =>
                setTargets(t => ({
                  ...t,
                  [c.itemId]: Math.max(0, value - step),
                }))
              }
              onIncrease={() =>
                setTargets(t => ({
                  ...t,
                  [c.itemId]: Math.min(max, value + step),
                }))
              }
            />
          </View>
        );
      })}
      <Button
        variant="primary"
        label="Enregistrer le contenu"
        disabled={changed.length === 0}
        onPress={() => void save()}
      />
    </Panel>
  );
}

/** Une boîte ouverte : contenu, étiquette, remplissage, modification. */
function BoxView(props: {
  id: string;
  onBack: () => void;
  onFeedback: (feedback: Feedback) => void;
}) {
  const { boxes } = useSession();
  const [panel, setPanel] = useState<'label' | 'fill' | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
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
      {editing ? (
        <BoxForm
          initial={box}
          onCancel={() => setEditing(false)}
          onSubmit={async (name, location) => {
            await boxes.update(box.id, { name, location });
            setEditing(false);
            props.onFeedback({ message: 'Boîte modifiée.', tone: 'ok' });
            await reload();
          }}
        />
      ) : (
        <View style={styles.head}>
          <View style={styles.grow}>
            <Text style={text.label}>Boîte N° {box.labelNo}</Text>
            <Text accessibilityRole="header" style={text.h2}>
              {boxTitle(box)}
            </Text>
            <Text style={text.muted}>
              {[box.location, articles(box.itemCount)]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {box.nextExpiration ? (
              <Text style={text.subtle}>
                Prochaine péremption : {formatDate(box.nextExpiration)}
              </Text>
            ) : null}
          </View>
          {status ? (
            <StatusChip tone={status.tone} label={status.label} />
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Modifier la boîte N° ${box.labelNo}`}
            onPress={() => setEditing(true)}
            hitSlop={8}
            style={styles.iconButton}
          >
            <Pencil color={colors.text} size={18} />
          </Pressable>
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
      )}
      {confirming ? (
        <Panel accent={colors.danger} style={styles.form}>
          <Text style={text.body}>
            Supprimer la boîte N° {box.labelNo} ? Son contenu reste dans le
            stock, hors boîte.
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
          variant={panel === 'label' ? 'primary' : 'secondary'}
          icon={QrIcon}
          label="Étiquette QR"
          onPress={() => setPanel(panel === 'label' ? null : 'label')}
        />
        <Button
          compact
          variant={panel === 'fill' ? 'primary' : 'secondary'}
          icon={BoxIcon}
          label="Contenu depuis le stock"
          onPress={() => setPanel(panel === 'fill' ? null : 'fill')}
        />
      </View>
      {panel === 'label' ? <LabelPanel box={box} /> : null}
      {panel === 'fill' ? (
        <FillPanel
          box={box}
          onSaved={async message => {
            props.onFeedback({ message, tone: 'ok' });
            await reload();
          }}
        />
      ) : null}
      {lines.length === 0 ? (
        <EmptyState
          icon={BoxIcon}
          title="Cette boîte est vide."
          message="Choisissez son contenu dans le stock avec « Contenu depuis le stock »."
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

/** Liste des boîtes, création, scan d'une étiquette et planche à imprimer. */
export function BoxesSection(props: {
  /** Boîte à ouvrir d'emblée (scan depuis un autre écran). */
  initialBox?: string | null;
}) {
  const { boxes, files, scanSource } = useSession();
  const [openId, setOpenId] = useState<string | null>(props.initialBox ?? null);
  const [creating, setCreating] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const { data, error, reload } = useLoader(() => boxes.list(), [openId]);

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
        setOpenId(id);
      }
    } catch (e) {
      setFeedback({ tone: 'error', message: failure(e) });
    }
  };

  const scanButton = scanSource.scanQr ? (
    <Button
      compact
      variant="secondary"
      icon={ScanQrCode}
      label="Scanner une boîte"
      onPress={() => void scan()}
    />
  ) : null;

  if (openId !== null) {
    return (
      <>
        {feedback ? <Notice {...feedback} /> : null}
        <BoxView
          key={openId}
          id={openId}
          onBack={() => setOpenId(null)}
          onFeedback={setFeedback}
        />
        <View style={styles.row}>{scanButton}</View>
      </>
    );
  }

  const list = data ?? [];
  const nextNo = list.reduce((max, b) => Math.max(max, b.labelNo), 0) + 1;
  return (
    <>
      <Text style={text.muted}>
        L’inventaire de chaque boîte fermée, fait à partir du stock. Collez son
        étiquette : en la scannant, Fenrir affiche son contenu et sa prochaine
        péremption.
      </Text>
      {feedback ? <Notice {...feedback} /> : null}
      {error ? <Notice tone="error" message={error} /> : null}
      <View style={styles.row}>
        {creating ? null : (
          <Button
            compact
            variant="primary"
            icon={Plus}
            label="Nouvelle boîte"
            onPress={() => setCreating(true)}
          />
        )}
        {scanButton}
      </View>
      {files.printHtml && list.length > 0 ? (
        <View style={styles.back}>
          <Button
            compact
            variant="ghost"
            icon={Printer}
            label="Imprimer toutes les étiquettes"
            onPress={() => {
              setFeedback(null);
              files
                .printHtml?.('Étiquettes des boîtes', labelsHtml(list))
                .catch((e: unknown) =>
                  setFeedback({ tone: 'error', message: failure(e) }),
                );
            }}
          />
        </View>
      ) : null}
      {creating ? (
        <BoxForm
          nextNo={nextNo}
          onCancel={() => setCreating(false)}
          onSubmit={async (name, location) => {
            const box = await boxes.create({ name, location });
            setCreating(false);
            setFeedback({
              message: `Boîte N° ${box.labelNo} créée.`,
              tone: 'ok',
            });
            await reload();
            setOpenId(box.id);
          }}
        />
      ) : null}
      {data !== null && list.length === 0 && !creating ? (
        <EmptyState
          icon={BoxIcon}
          title="Aucune boîte."
          message="Créez une boîte, choisissez son contenu dans le stock, puis imprimez son étiquette."
        />
      ) : null}
      {list.map(box => {
        const status = boxStatus(box);
        return (
          <Pressable
            key={box.id}
            accessibilityRole="button"
            accessibilityLabel={`Boîte N° ${box.labelNo}${
              box.name ? `, ${box.name}` : ''
            } : ${box.itemCount === 0 ? 'vide' : articles(box.itemCount)}${
              status ? `, ${status.label}` : ''
            }`}
            onPress={() => setOpenId(box.id)}
            style={({ pressed }) => [styles.row2, pressed && styles.pressed]}
          >
            <View style={styles.badge}>
              <Text style={styles.badgeText}>N° {box.labelNo}</Text>
            </View>
            <View style={styles.grow}>
              <Text style={text.h3}>{boxTitle(box)}</Text>
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
  candidate: { flexDirection: 'row', alignItems: 'center', gap: space.m },
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
  row2: {
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
