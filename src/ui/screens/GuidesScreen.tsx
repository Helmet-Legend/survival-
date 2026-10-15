/**
 * Guides : catégories de fiches (nombre réel de fiches), recherche plein
 * texte et lecture. Les fiches sont stockées dans le coffre, hors ligne.
 */
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  ClipboardList,
  Droplet,
  HeartPulse,
  Radio,
  SearchX,
  type LucideIcon,
} from 'lucide-react-native';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

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

/** Pictogramme et couleur par catégorie connue ; livre ouvert sinon. */
const CATEGORY_STYLE: Record<string, [LucideIcon, string]> = {
  Eau: [Droplet, colors.water],
  Secourisme: [HeartPulse, colors.health],
  Signalisation: [Radio, colors.cyan],
  Préparation: [ClipboardList, colors.primary],
};

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

      {!searching && category === null
        ? [...categories.entries()]
            .sort(([a], [b]) => a.localeCompare(b, 'fr'))
            .map(([name, guides]) => {
              const [Icon, color] = categoryStyle(name);
              return (
                <Pressable
                  key={name}
                  accessibilityRole="button"
                  accessibilityLabel={`${name}, ${fiches(guides.length)}`}
                  onPress={() => setCategory(name)}
                  style={({ pressed }) => [
                    styles.card,
                    pressed && styles.pressed,
                  ]}
                >
                  <IconTile icon={Icon} color={color} />
                  <View style={styles.grow}>
                    <Text style={text.h3}>{name}</Text>
                    <Text style={styles.count}>{fiches(guides.length)}</Text>
                    <Text style={text.subtle} numberOfLines={1}>
                      {guides.map(g => g.title).join(', ')}
                    </Text>
                  </View>
                  <ChevronRight color={colors.text} size={22} />
                </Pressable>
              );
            })
        : shown.map(guide => {
            const [Icon, color] = categoryStyle(guide.category);
            return (
              <Pressable
                key={guide.slug}
                accessibilityRole="button"
                onPress={() => setSlug(guide.slug)}
                style={({ pressed }) => [
                  styles.card,
                  pressed && styles.pressed,
                ]}
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
          })}

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

function GuideReader(props: { slug: string; onBack: () => void }) {
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
            .map((line, i) =>
              line.startsWith('- ') ? (
                <View key={i} style={styles.bullet}>
                  <Text style={styles.bulletMark}>•</Text>
                  <Text style={[text.body, styles.grow]}>{line.slice(2)}</Text>
                </View>
              ) : (
                <Text key={i} style={text.body}>
                  {line}
                </Text>
              ),
            )}
        </View>
      ) : null}
    </ScrollView>
  );
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
});
