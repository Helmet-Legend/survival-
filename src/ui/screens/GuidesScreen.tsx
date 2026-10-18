/**
 * Guides : catégories de fiches (nombre réel de fiches), recherche plein
 * texte et lecture. Les fiches sont stockées dans le coffre, hors ligne.
 */
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  ClipboardList,
  Compass,
  Droplet,
  Flame,
  HeartPulse,
  Radio,
  SearchX,
  ShowerHead,
  Siren,
  Utensils,
  type LucideIcon,
} from 'lucide-react-native';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { GUIDE_FOLDERS } from '../../content/fiches/fiche';
import { searchGuides } from '../../db/guides';
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
  snippet?: string;
}

/** Pictogramme et couleur par dossier connu ; livre ouvert sinon. */
const CATEGORY_STYLE: Record<string, [LucideIcon, string]> = {
  Survie: [Flame, colors.energy],
  Médical: [HeartPulse, colors.health],
  Eau: [Droplet, colors.water],
  Communication: [Radio, colors.cyan],
  Orientation: [Compass, colors.equipment],
  Alimentation: [Utensils, colors.food],
  Hygiène: [ShowerHead, colors.cyanSoft],
  Préparation: [ClipboardList, colors.primary],
  'Risques & alertes': [Siren, colors.danger],
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
        'SELECT slug, title, category FROM survival_guides ORDER BY title',
      );
      return rows.map(r => ({
        slug: String(r.slug),
        title: String(r.title),
        category: String(r.category),
      }));
    }
    return searchGuides(db, query);
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
                <Text style={[text.label, { color }]}>{guide.category}</Text>
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
        Fiches d’exemple, à faire valider par un professionnel de santé.
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

export function GuideReader(props: { slug: string; onBack: () => void }) {
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
          label="Toutes les fiches"
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
          {String(data.body)
            .split('\n')
            .map((line, i) => (
              <GuideLine key={i} line={line} />
            ))}
        </View>
      ) : null}
    </ScrollView>
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
