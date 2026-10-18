/**
 * Guides : catégories de fiches (nombre réel de fiches), recherche plein
 * texte et lecture. Les fiches sont stockées dans le coffre, hors ligne.
 */
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardList,
  Compass,
  DoorOpen,
  Droplet,
  HeartPulse,
  House,
  Radio,
  SearchX,
  Shield,
  Siren,
  Trees,
  Utensils,
  Zap,
  type LucideIcon,
} from 'lucide-react-native';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  F,
  GUIDE_FOLDERS,
  META_PREFIX,
  readMeta,
  type Priority,
  ficheInfo,
  HEADER_KEYS,
  needsReview,
  REVIEW_AFTER_MONTHS,
} from '../../content/fiches/fiche';
import {
  CHECK_PREFIX,
  checkId,
  clearGuideChecks,
  loadGuideChecks,
  setGuideCheck,
} from '../../content/guideChecks';
import { searchGuides } from '../../db/guides';
import { isoToFr, localToday } from '../../lib/dates';
import {
  Button,
  EmptyState,
  IconTile,
  Notice,
  SearchField,
} from '../components/controls';
import { useSession } from '../session';
import { colors, radius, sizes, space, text } from '../theme';
import { useLoader } from '../useLoader';

interface GuideRow {
  slug: string;
  title: string;
  category: string;
  priority: Priority;
  minutes?: number | null;
  snippet?: string;
}

const PRIORITY_RANK: Record<Priority, number> = {
  vitale: 0,
  importante: 1,
  utile: 2,
};

/** Pictogramme et couleur par dossier connu ; livre ouvert sinon. */
const CATEGORY_STYLE: Record<string, [LucideIcon, string]> = {
  [F.crise]: [ClipboardList, colors.primary],
  [F.risques]: [Siren, colors.danger],
  [F.sante]: [HeartPulse, colors.health],
  [F.eau]: [Droplet, colors.water],
  [F.alimentation]: [Utensils, colors.food],
  [F.energie]: [Zap, colors.energy],
  [F.habitat]: [House, colors.tools],
  [F.evacuation]: [DoorOpen, colors.warning],
  [F.protection]: [Shield, colors.purple],
  [F.communication]: [Radio, colors.cyan],
  [F.orientation]: [Compass, colors.equipment],
  [F.nature]: [Trees, colors.success],
};

/** Ordre des dossiers : celui de GUIDE_FOLDERS, les inconnus à la fin. */
function folderRank(category: string): number {
  const index = (GUIDE_FOLDERS as readonly string[]).indexOf(category);
  return index === -1 ? GUIDE_FOLDERS.length : index;
}

function categoryStyle(category: string): [LucideIcon, string] {
  return CATEGORY_STYLE[category] ?? [BookOpen, colors.cyanSoft];
}

function fiches(count: number): string {
  return `${count} fiche${count > 1 ? 's' : ''}`;
}

export function GuidesScreen() {
  const { db } = useSession();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);

  const { data, error } = useLoader(async (): Promise<GuideRow[]> => {
    if (query.trim() === '') {
      const { rows } = await db.execute(
        'SELECT slug, title, category, body FROM survival_guides ORDER BY title',
      );
      return rows
        .map(r => ({
          slug: String(r.slug),
          title: String(r.title),
          category: String(r.category),
          priority: readMeta(String(r.body)).priority,
          minutes: ficheInfo(String(r.body)).minutes,
        }))
        .sort(
          (a, b) =>
            PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
            a.title.localeCompare(b.title, 'fr'),
        );
    }
    return (await searchGuides(db, query)).map(hit => ({
      ...hit,
      priority: 'importante' as const,
    }));
  }, [query]);

  if (slug !== null) {
    return <GuideReader slug={slug} onBack={() => setSlug(null)} />;
  }

  const searching = query.trim() !== '';
  const categories = new Map<string, GuideRow[]>();
  for (const guide of data ?? []) {
    categories.set(guide.category, [
      ...(categories.get(guide.category) ?? []),
      guide,
    ]);
  }
  const shown =
    searching || category === null
      ? data ?? []
      : (data ?? []).filter(g => g.category === category);

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      <SearchField
        label="Rechercher un guide"
        value={query}
        onChangeText={setQuery}
        placeholder="Rechercher un guide…"
      />
      {error ? <Notice tone="error" message={error} /> : null}

      {!searching && category !== null ? (
        <View style={styles.back}>
          <Button
            variant="ghost"
            compact
            icon={ArrowLeft}
            label="Toutes les catégories"
            onPress={() => setCategory(null)}
          />
        </View>
      ) : null}

      {!searching && category === null ? (
        <View style={styles.folders}>
          {[...categories.entries()]
            .sort(
              ([a], [b]) =>
                folderRank(a) - folderRank(b) || a.localeCompare(b, 'fr'),
            )
            .map(([name, guides]) => {
              const [Icon, color] = categoryStyle(name);
              return (
                <Pressable
                  key={name}
                  accessibilityRole="button"
                  accessibilityLabel={`${name}, ${fiches(guides.length)}`}
                  onPress={() => setCategory(name)}
                  style={({ pressed }) => [
                    styles.folder,
                    pressed && styles.pressed,
                  ]}
                >
                  <IconTile icon={Icon} color={color} />
                  <Text style={styles.folderName}>{name}</Text>
                  <Text style={styles.count}>{fiches(guides.length)}</Text>
                </Pressable>
              );
            })}
        </View>
      ) : (
        shown.map(guide => {
          const [Icon, color] = categoryStyle(guide.category);
          return (
            <Pressable
              key={guide.slug}
              accessibilityRole="button"
              onPress={() => setSlug(guide.slug)}
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            >
              <Icon color={color} size={22} />
              <View style={styles.grow}>
                <View style={styles.cardHead}>
                  <Text style={[text.label, { color }]}>{guide.category}</Text>
                  {guide.priority === 'vitale' && !searching ? (
                    <Text style={styles.vital}>VITAL</Text>
                  ) : null}
                  {guide.minutes ? (
                    <Text style={text.subtle}>{guide.minutes} min</Text>
                  ) : null}
                </View>
                <Text style={styles.title}>{guide.title}</Text>
                {guide.snippet ? <Snippet text={guide.snippet} /> : null}
              </View>
              <ChevronRight color={colors.textMuted} size={20} />
            </Pressable>
          );
        })
      )}

      {data?.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Aucune fiche ne correspond."
          message="Essayez un autre mot : les accents sont ignorés."
        />
      ) : null}
      <Text style={text.subtle}>
        Fiches rédigées pour Fenrir et mises à jour en octobre 2026, avec les
        références à consulter. Les fiches de santé n’ont pas été relues par un
        professionnel et ne remplacent pas une formation aux premiers secours.
      </Text>
    </ScrollView>
  );
}

/** Extrait FTS5 : les termes trouvés sont encadrés par [ et ]. */
function Snippet({ text: snippet }: { text: string }) {
  const parts = snippet.split(/(\[[^\]]*\])/);
  return (
    <Text style={text.muted}>
      {parts.map((part, i) =>
        part.startsWith('[') && part.endsWith(']') ? (
          <Text key={i} style={styles.hit}>
            {part.slice(1, -1)}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

export function GuideReader(props: {
  slug: string;
  onBack: () => void;
  /** Libellé du retour, si l'on ne revient pas à la liste des fiches. */
  backLabel?: string;
}) {
  const { db } = useSession();
  const { data, error } = useLoader(async () => {
    const { rows } = await db.execute(
      'SELECT title, category, body FROM survival_guides WHERE slug = ?',
      [props.slug],
    );
    return rows[0] ?? null;
  }, [props.slug]);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.back}>
        <Button
          variant="ghost"
          compact
          icon={ArrowLeft}
          label={props.backLabel ?? 'Toutes les fiches'}
          onPress={props.onBack}
        />
      </View>
      {error ? <Notice tone="error" message={error} /> : null}
      {data ? (
        <View style={styles.reader}>
          <Text
            style={[
              text.label,
              { color: categoryStyle(String(data.category))[1] },
            ]}
          >
            {String(data.category)}
          </Text>
          <Text accessibilityRole="header" style={text.h1}>
            {String(data.title)}
          </Text>
          <FicheHeader body={String(data.body)} />
          {blocks(String(data.body)).map((block, i) =>
            typeof block === 'string' ? (
              <GuideLine key={i} line={block} />
            ) : (
              <GuideChecklist key={i} slug={props.slug} items={block} />
            ),
          )}
          <MetaFooter body={String(data.body)} />
        </View>
      ) : null}
    </ScrollView>
  );
}

/**
 * Lignes affichables d'une fiche, métadonnées retirées ; les lignes « ☐ »
 * consécutives forment une liste de contrôle.
 */
function blocks(body: string): Array<string | string[]> {
  const out: Array<string | string[]> = [];
  for (const line of body.split('\n')) {
    if (line.startsWith(META_PREFIX)) {
      continue;
    }
    if (line.startsWith(CHECK_PREFIX)) {
      const label = line.slice(CHECK_PREFIX.length);
      const last = out[out.length - 1];
      if (Array.isArray(last)) {
        last.push(label);
      } else {
        out.push([label]);
      }
    } else {
      out.push(line);
    }
  }
  return out;
}

/** Liste de contrôle cochable ; la date du dernier contrôle est conservée. */
function GuideChecklist(props: { slug: string; items: string[] }) {
  const { db } = useSession();
  const { data, reload } = useLoader(
    () => loadGuideChecks(db, props.slug),
    [props.slug],
  );
  const checks = data ?? new Map<string, string>();
  const done = props.items.filter(label => checks.has(checkId(label))).length;
  const last = [...checks.values()].sort().pop();
  const toggle = async (label: string, checked: boolean) => {
    await setGuideCheck(db, props.slug, checkId(label), checked);
    await reload();
  };
  return (
    <View style={styles.checklist}>
      {props.items.map(label => {
        const checked = checks.has(checkId(label));
        const Icon = checked ? CheckCircle2 : Circle;
        return (
          <Pressable
            key={label}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            accessibilityLabel={label}
            onPress={() => {
              void toggle(label, !checked);
            }}
            style={({ pressed }) => [styles.check, pressed && styles.pressed]}
          >
            <Icon
              color={checked ? colors.success : colors.textMuted}
              size={22}
              strokeWidth={2}
            />
            <Text style={[text.body, styles.grow]}>{label}</Text>
          </Pressable>
        );
      })}
      <Text style={text.subtle}>
        {done} sur {props.items.length} vérifiés
        {last ? ` · dernier contrôle le ${isoToFr(last.slice(0, 10))}` : ''}
      </Text>
      {done > 0 ? (
        <Button
          compact
          variant="ghost"
          label="Nouveau contrôle"
          accessibilityLabel="Nouveau contrôle : tout décocher"
          onPress={() => {
            void clearGuideChecks(db, props.slug).then(reload);
          }}
        />
      ) : null}
    </View>
  );
}

/** Tête de fiche : priorité, temps de lecture, fiabilité, résumé, révision. */
function FicheHeader({ body }: { body: string }) {
  const { priority } = readMeta(body);
  const info = ficheInfo(body);
  const stale = needsReview(info.checked, localToday());
  return (
    <>
      <View style={styles.badges}>
        <Text
          style={[styles.badge, priority === 'vitale' && styles.badgeVital]}
        >
          {PRIORITY_LABELS[priority]}
        </Text>
        {info.minutes !== null ? (
          <Text style={styles.badge}>{info.minutes} min de lecture</Text>
        ) : null}
        {info.reliability !== null ? (
          <Text style={styles.badge}>{info.reliability}</Text>
        ) : null}
      </View>
      {stale ? (
        <View style={styles.review}>
          <Text style={styles.reviewText}>
            Fiche à revoir : sa dernière vérification date de plus de{' '}
            {REVIEW_AFTER_MONTHS} mois. Recoupez avec les sources officielles à
            jour.
          </Text>
        </View>
      ) : null}
      {info.summary ? (
        <View style={styles.brief}>
          <Text style={styles.briefLabel}>En bref</Text>
          <Text style={text.body}>{info.summary}</Text>
        </View>
      ) : null}
    </>
  );
}

const PRIORITY_LABELS: Record<Priority, string> = {
  vitale: 'Vitale',
  importante: 'Importante',
  utile: 'Utile',
};

/** Pied de fiche : priorité, références, date et statut de relecture. */
function MetaFooter({ body }: { body: string }) {
  const entries = readMeta(body).entries.filter(
    ([key]) => !HEADER_KEYS.has(key),
  );
  if (entries.length === 0) {
    return null;
  }
  return (
    <View style={styles.meta}>
      {entries.map(([key, value]) => (
        <Text key={key} style={text.subtle}>
          <Text style={styles.metaKey}>{key} : </Text>
          {value}
        </Text>
      ))}
    </View>
  );
}

/**
 * Une ligne de fiche : « ## » intertitre, « - » puce, « 1. » étape
 * numérotée, « ! » mise en garde, « = » ligne de tableau (libellé puis
 * valeur), « | » grille en chasse fixe (deux cases par ligne). Les cases
 * sont séparées par au moins deux espaces.
 */
function cells(line: string): string[] {
  return line
    .slice(2)
    .trim()
    .split(/\s{2,}/);
}

function GuideLine({ line }: { line: string }) {
  if (line.trim() === '') {
    return null;
  }
  if (line.startsWith('## ')) {
    return (
      <Text accessibilityRole="header" style={styles.heading}>
        {line.slice(3)}
      </Text>
    );
  }
  if (line.startsWith('◇ ')) {
    return (
      <View style={styles.diagramNode}>
        <Text style={styles.diagramNodeText}>{line.slice(2)}</Text>
      </View>
    );
  }
  if (line.trim() === '↓') {
    return (
      <View style={styles.diagramConnector}>
        <Text style={styles.diagramArrow}>↓</Text>
      </View>
    );
  }
  if (line.startsWith('! ')) {
    return (
      <View style={styles.warning}>
        <Text style={styles.warningText}>{line.slice(2)}</Text>
      </View>
    );
  }
  if (line.startsWith('| ')) {
    return (
      <View style={styles.grid}>
        {cells(line).map((cell, i) => (
          <Text key={i} style={[styles.mono, styles.gridCell]}>
            {cell}
          </Text>
        ))}
      </View>
    );
  }
  if (line.startsWith('= ')) {
    const [label, ...rest] = cells(line);
    return (
      <View style={styles.tableRow}>
        <Text style={styles.tableLabel}>{label}</Text>
        {rest.length > 0 ? (
          <Text style={[text.body, styles.grow]}>{rest.join(' ')}</Text>
        ) : null}
      </View>
    );
  }
  const step = /^(\d+)\. (.*)$/.exec(line);
  if (step) {
    return (
      <View style={styles.bullet}>
        <Text style={styles.stepMark}>{step[1]}</Text>
        <Text style={[text.body, styles.grow]}>{step[2]}</Text>
      </View>
    );
  }
  if (line.startsWith('- ')) {
    return (
      <View style={styles.bullet}>
        <Text style={styles.bulletMark}>•</Text>
        <Text style={[text.body, styles.grow]}>{line.slice(2)}</Text>
      </View>
    );
  }
  return <Text style={text.body}>{line}</Text>;
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: sizes.screenPadding,
    paddingBottom: space.xl,
    gap: space.m,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.l,
    minHeight: 72,
    padding: space.l,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
  },
  folders: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: space.m,
  },
  folder: {
    width: '48%',
    gap: space.s,
    padding: space.m,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
  },
  folderName: { ...text.body, fontWeight: '700' },
  pressed: { opacity: 0.82 },
  grow: { flex: 1, minWidth: 0 },
  count: { color: colors.text, fontSize: 15 },
  title: { ...text.body, fontWeight: '600' },
  hit: { color: colors.primary, fontWeight: '700' },
  back: { alignItems: 'flex-start' },
  reader: {
    gap: space.m,
    padding: space.l,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
  },
  bullet: { flexDirection: 'row', gap: space.s },
  bulletMark: { color: colors.primary, fontSize: 16, lineHeight: 22 },
  stepMark: {
    minWidth: 22,
    color: colors.primary,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  heading: {
    ...text.h3,
    marginTop: space.s,
    color: colors.text,
  },
  warning: {
    padding: space.m,
    borderRadius: radius.s,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSurface,
  },
  warningText: { color: colors.text, fontSize: 15, lineHeight: 21 },
  diagramNode: {
    alignSelf: 'stretch',
    paddingVertical: space.s,
    paddingHorizontal: space.m,
    borderRadius: radius.s,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  diagramNodeText: {
    ...text.body,
    fontWeight: '700',
    textAlign: 'center',
    color: colors.text,
  },
  diagramConnector: { alignItems: 'center', marginVertical: -space.s },
  diagramArrow: { color: colors.primary, fontSize: 22, fontWeight: '800' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  vital: {
    color: colors.danger,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  meta: {
    gap: 4,
    marginTop: space.m,
    paddingTop: space.m,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  metaKey: { fontWeight: '700', color: colors.textMuted },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  badge: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: space.s,
    paddingVertical: 2,
    borderRadius: radius.s,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeVital: { color: colors.danger, borderColor: colors.danger },
  brief: {
    gap: space.xs,
    padding: space.m,
    borderRadius: radius.s,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    backgroundColor: colors.surface,
  },
  briefLabel: { ...text.label, color: colors.primary },
  review: {
    padding: space.m,
    borderRadius: radius.s,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  reviewText: { color: colors.warning, fontSize: 14, lineHeight: 20 },
  checklist: {
    gap: space.xs,
    padding: space.m,
    borderRadius: radius.s,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  check: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: 44,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  gridCell: { width: '50%' },
  tableRow: {
    flexDirection: 'row',
    gap: space.m,
    paddingVertical: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  tableLabel: {
    ...text.body,
    width: '38%',
    color: colors.primaryBright,
    fontWeight: '600',
  },
  mono: {
    ...text.mono,
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
});
