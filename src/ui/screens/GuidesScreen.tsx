/** Fiches de survie : recherche plein texte et lecture. */
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { searchGuides } from '../../db/guides';
import { Button, Field } from '../components/controls';
import { useSession } from '../session';
import { colors, space, text } from '../theme';
import { useLoader } from '../useLoader';

interface GuideRow {
  slug: string;
  title: string;
  category: string;
  snippet?: string;
}

export function GuidesScreen() {
  const { db } = useSession();
  const [query, setQuery] = useState('');
  const [slug, setSlug] = useState<string | null>(null);

  const { data } = useLoader(async (): Promise<GuideRow[]> => {
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

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      <Field
        label="Rechercher"
        value={query}
        onChangeText={setQuery}
        placeholder="garrot, eau, hypothermie…"
        autoCorrect={false}
        returnKeyType="search"
      />
      {data?.length === 0 ? (
        <Text style={text.dim}>Aucune fiche ne correspond.</Text>
      ) : null}
      {data?.map(guide => (
        <Pressable
          key={guide.slug}
          accessibilityRole="button"
          onPress={() => setSlug(guide.slug)}
          style={styles.guide}
        >
          <Text style={text.label}>{guide.category}</Text>
          <Text style={text.body}>{guide.title}</Text>
          {guide.snippet ? <Snippet text={guide.snippet} /> : null}
        </Pressable>
      ))}
      <Text style={text.dim}>
        Fiches d’exemple, à faire valider par un professionnel de santé.
      </Text>
    </ScrollView>
  );
}

/** Extrait FTS5 : les termes trouvés sont encadrés par [ et ]. */
function Snippet({ text: snippet }: { text: string }) {
  const parts = snippet.split(/(\[[^\]]*\])/);
  return (
    <Text style={text.dim}>
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
  const { data } = useLoader(async () => {
    const { rows } = await db.execute(
      'SELECT title, category, body FROM survival_guides WHERE slug = ?',
      [props.slug],
    );
    return rows[0] ?? null;
  }, [props.slug]);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.back}>
        <Button label="← Toutes les fiches" onPress={props.onBack} />
      </View>
      {data ? (
        <>
          <Text style={text.label}>{String(data.category)}</Text>
          <Text style={styles.title}>{String(data.title)}</Text>
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
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.l, gap: space.m },
  guide: {
    gap: 2,
    paddingVertical: space.m,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  hit: { color: colors.amber, fontWeight: '600' },
  back: { alignItems: 'flex-start' },
  title: { ...text.title, fontSize: 28 },
  bullet: { flexDirection: 'row', gap: space.s },
  bulletMark: { color: colors.amber, fontSize: 15, lineHeight: 21 },
  grow: { flex: 1 },
});
