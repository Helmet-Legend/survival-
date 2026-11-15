/**
 * Champignons : aide à la reconnaissance, jamais un feu vert pour consommer.
 * Trois onglets : les 40 espèces (filtres Mortels, Toxiques, Comestibles ⚠),
 * une clé en trois questions qui mène à des « espèces possibles, à faire
 * vérifier », et les réflexes en cas d'intoxication. Le bandeau rouge reste
 * affiché sur chaque écran.
 */
import { AlertTriangle, Phone } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  isKeyResult,
  KEY_QUESTIONS,
  KEY_RESULTS,
  MUSHROOM_GROUPS,
  MUSHROOM_PHOTO_CREDITS,
  MUSHROOM_SOURCES,
  MUSHROOM_WARNING,
  MUSHROOMS,
  mushroomById,
  mushroomPhotos,
  POISONING_STEPS,
  searchMushrooms,
  type KeyNode,
  type KeyResultId,
  type Mushroom,
  type MushroomGroup,
} from '../../content/mushrooms';
import { markLeavingForCall } from '../callGrace';
import { Chip, Notice, ScreenTitle, SearchField } from '../components/controls';
import { MUSHROOM_IMAGES } from '../mushroomImages';
import { useNavigation } from '../navigation';
import { colors, radius, space, text, tint } from '../theme';
import { useBack } from '../useBackHandler';

type MushroomTab = 'species' | 'key' | 'poisoning';

const GROUP_COLOR: Record<MushroomGroup, string> = {
  mortel: colors.danger,
  toxique: colors.warning,
  comestible: colors.success,
};

const GROUPS = Object.keys(MUSHROOM_GROUPS) as MushroomGroup[];

export function MushroomsScreen() {
  const navigation = useNavigation();
  const [tab, setTab] = useState<MushroomTab>('species');
  const [group, setGroup] = useState<MushroomGroup>('mortel');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [steps, setSteps] = useState<Array<KeyNode | KeyResultId>>([]);
  const open = openId === null ? undefined : mushroomById(openId);
  useBack(open !== undefined, () => setOpenId(null));

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenTitle
        title={open ? open.name : 'Champignons'}
        onBack={open ? () => setOpenId(null) : navigation.close}
        backLabel={open ? 'Retour à la liste' : navigation.backLabel}
      />
      <View style={styles.warning} accessibilityRole="alert">
        <AlertTriangle color={colors.danger} size={20} strokeWidth={2} />
        <Text style={styles.warningText}>{MUSHROOM_WARNING}</Text>
      </View>
      {open ? (
        <MushroomDetail mushroom={open} onOpen={setOpenId} />
      ) : (
        <>
          <View style={styles.row}>
            <Chip
              label="Espèces"
              selected={tab === 'species'}
              onPress={() => setTab('species')}
            />
            <Chip
              label="Caractéristiques"
              selected={tab === 'key'}
              onPress={() => setTab('key')}
            />
            <Chip
              label="Intoxication"
              selected={tab === 'poisoning'}
              onPress={() => setTab('poisoning')}
            />
          </View>
          {tab === 'species' ? (
            <SpeciesList
              group={group}
              onGroup={setGroup}
              query={query}
              onQuery={setQuery}
              onOpen={setOpenId}
            />
          ) : tab === 'key' ? (
            <KeyHelper steps={steps} onSteps={setSteps} onOpen={setOpenId} />
          ) : (
            <Poisoning />
          )}
        </>
      )}
    </ScrollView>
  );
}

function SpeciesList(props: {
  group: MushroomGroup;
  onGroup: (group: MushroomGroup) => void;
  query: string;
  onQuery: (query: string) => void;
  onOpen: (id: string) => void;
}) {
  const searching = props.query.trim() !== '';
  const list = searchMushrooms(
    props.query,
    searching ? undefined : props.group,
  );
  return (
    <View style={styles.stack}>
      <SearchField
        label={`Rechercher parmi ${MUSHROOMS.length} espèces`}
        value={props.query}
        onChangeText={props.onQuery}
      />
      {searching ? null : (
        <>
          <View style={styles.row}>
            {GROUPS.map(g => (
              <Chip
                key={g}
                label={`${MUSHROOM_GROUPS[g].label} · ${
                  MUSHROOMS.filter(x => x.group === g).length
                }`}
                selected={props.group === g}
                onPress={() => props.onGroup(g)}
              />
            ))}
          </View>
          <Text style={text.subtle}>{MUSHROOM_GROUPS[props.group].hint}</Text>
        </>
      )}
      {list.length === 0 ? (
        <Text style={text.muted}>Aucune espèce ne correspond.</Text>
      ) : (
        list.map(x => (
          <SpeciesRow
            key={x.id}
            mushroom={x}
            onPress={() => props.onOpen(x.id)}
          />
        ))
      )}
    </View>
  );
}

function SpeciesRow(props: { mushroom: Mushroom; onPress: () => void }) {
  const x = props.mushroom;
  const color = GROUP_COLOR[x.group];
  const [photo] = mushroomPhotos(x.id);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${x.name}, ${MUSHROOM_GROUPS[x.group].badge}`}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.speciesRow,
        { borderLeftColor: color },
        pressed && styles.pressed,
      ]}
    >
      {photo ? (
        <Image source={MUSHROOM_IMAGES[photo]} style={styles.thumb} />
      ) : (
        <View style={styles.thumb} />
      )}
      <View style={styles.grow}>
        <Text style={styles.speciesName}>{x.name}</Text>
        <Text style={styles.latin}>{x.latin}</Text>
      </View>
      <GroupBadge group={x.group} />
    </Pressable>
  );
}

function GroupBadge(props: { group: MushroomGroup }) {
  const color = GROUP_COLOR[props.group];
  return (
    <View style={[styles.badge, { backgroundColor: tint(color) }]}>
      <Text style={[styles.badgeText, { color }]}>
        {props.group === 'mortel' ? '☠ ' : ''}
        {MUSHROOM_GROUPS[props.group].badge}
      </Text>
    </View>
  );
}

function MushroomDetail(props: {
  mushroom: Mushroom;
  onOpen: (id: string) => void;
}) {
  const x = props.mushroom;
  const photos = mushroomPhotos(x.id);
  const dangerous = x.group !== 'comestible';
  return (
    <View style={styles.stack}>
      <View style={styles.photos}>
        {photos.map((key, i) => (
          <Image
            key={key}
            source={MUSHROOM_IMAGES[key]}
            accessibilityLabel={`${x.name}, photo ${i + 1}`}
            style={[styles.photo, photos.length === 1 && styles.photoWide]}
          />
        ))}
      </View>
      <View>
        {photos.map((key, i) => (
          <Text key={key} style={styles.credit}>
            Photo {i + 1} : © {MUSHROOM_PHOTO_CREDITS[key]} · Wikimedia Commons
          </Text>
        ))}
      </View>
      <View style={styles.row}>
        <GroupBadge group={x.group} />
        <Text style={styles.latin}>{x.latin}</Text>
      </View>
      <View style={styles.card}>
        <Text style={text.label}>La reconnaître</Text>
        <Trait label="Chapeau" value={x.cap} />
        <Trait label="Dessous" value={x.under} />
        <Trait label="Pied" value={x.stem} />
        <Trait label="Où, quand" value={x.where} />
      </View>
      <View
        style={[styles.card, dangerous ? styles.cardDanger : styles.cardWarn]}
      >
        <Text
          style={[
            text.label,
            { color: dangerous ? colors.danger : colors.warning },
          ]}
        >
          {dangerous ? 'Danger' : 'Précaution'}
        </Text>
        <Text style={text.body}>{x.warning}</Text>
      </View>
      <View style={[styles.card, styles.cardWarn]}>
        <Text style={[text.label, { color: colors.warning }]}>
          Confusions dangereuses
        </Text>
        {x.lookalikes.map(l => {
          const target = MUSHROOMS.find(s => l.name.startsWith(s.name));
          return (
            <Text key={l.name} style={text.body}>
              {'• '}
              <Text
                style={[styles.bold, target && styles.link]}
                onPress={target ? () => props.onOpen(target.id) : undefined}
              >
                {l.name}
              </Text>
              {` : ${l.how}`}
            </Text>
          );
        })}
      </View>
      <Text style={text.subtle}>{MUSHROOM_SOURCES}</Text>
    </View>
  );
}

function Trait(props: { label: string; value: string }) {
  return (
    <Text style={text.body}>
      <Text style={styles.bold}>{props.label} : </Text>
      {props.value}
    </Text>
  );
}

function KeyHelper(props: {
  steps: Array<KeyNode | KeyResultId>;
  onSteps: (steps: Array<KeyNode | KeyResultId>) => void;
  onOpen: (id: string) => void;
}) {
  const current = props.steps[props.steps.length - 1] ?? 'q1';
  const result = isKeyResult(current) ? KEY_RESULTS[current] : null;
  const question = isKeyResult(current) ? null : KEY_QUESTIONS[current];
  return (
    <View style={styles.stack}>
      <View style={styles.progress}>
        {[0, 1, 2].map(i => (
          <View
            key={i}
            style={[
              styles.progressStep,
              i < props.steps.length && styles.progressOn,
            ]}
          />
        ))}
      </View>
      {question ? (
        <>
          <Text style={text.subtle}>
            Question {props.steps.length + 1} sur 3 au plus
          </Text>
          <Text style={text.h2}>{question.question}</Text>
          <Text style={text.muted}>{question.help}</Text>
          {question.answers.map(a => (
            <Pressable
              key={a.label}
              accessibilityRole="button"
              onPress={() => props.onSteps([...props.steps, a.next])}
              style={({ pressed }) => [
                styles.answer,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.answerLabel}>{a.label}</Text>
              <Text style={text.subtle}>{a.help}</Text>
            </Pressable>
          ))}
        </>
      ) : null}
      {result ? (
        <>
          <View
            style={[
              styles.card,
              result.danger ? styles.cardDanger : styles.cardWarn,
            ]}
          >
            <Text
              style={[
                text.label,
                { color: result.danger ? colors.danger : colors.warning },
              ]}
            >
              {result.danger ? 'Danger' : 'Prudence'}
            </Text>
            <Text style={styles.resultTitle}>{result.title}</Text>
            <Text style={text.muted}>{result.text}</Text>
          </View>
          <Text style={text.label}>Espèces possibles, à faire vérifier</Text>
          {result.species.map(id => {
            const x = mushroomById(id);
            return x ? (
              <SpeciesRow
                key={id}
                mushroom={x}
                onPress={() => props.onOpen(id)}
              />
            ) : null;
          })}
        </>
      ) : null}
      {props.steps.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => props.onSteps([])}
          style={({ pressed }) => [styles.restart, pressed && styles.pressed]}
        >
          <Text style={styles.restartText}>Recommencer</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Poisoning() {
  const [error, setError] = useState<string | null>(null);
  const call = (number: string) => {
    // Le coffre est ouvert ici : il le reste pendant l'appel, comme depuis
    // l'écran Urgence.
    markLeavingForCall();
    Linking.openURL(`tel:${number}`).catch(() =>
      setError('Impossible d’ouvrir l’application du téléphone.'),
    );
  };
  return (
    <View style={styles.stack}>
      <View style={styles.row}>
        {[
          { number: '15', label: 'SAMU' },
          { number: '112', label: 'Urgences' },
        ].map(n => (
          <Pressable
            key={n.number}
            accessibilityRole="button"
            accessibilityLabel={`Appeler le ${n.number}, ${n.label}`}
            onPress={() => call(n.number)}
            style={({ pressed }) => [
              styles.callButton,
              pressed && styles.pressed,
            ]}
          >
            <Phone color={colors.text} size={20} strokeWidth={2} />
            <Text style={styles.callNumber}>{n.number}</Text>
            <Text style={styles.callLabel}>{n.label}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Notice tone="error" message={error} /> : null}
      <Text style={text.muted}>
        Centres antipoison : numéros de votre région sur centres-antipoison.net.
      </Text>
      <View style={styles.card}>
        <Text style={text.label}>En cas de malaise après un repas</Text>
        {POISONING_STEPS.map(s => (
          <Text key={s} style={text.body}>
            {`• ${s}`}
          </Text>
        ))}
      </View>
      <Text style={text.subtle}>
        Sources : ANSES, centres antipoison. À faire valider.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.l, gap: space.m, paddingBottom: space.xl * 2 },
  stack: { gap: space.m },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.s,
  },
  grow: { flex: 1, gap: 2 },
  pressed: { opacity: 0.7 },
  bold: { fontWeight: '700' },
  link: { color: colors.cyan, textDecorationLine: 'underline' },
  warning: {
    flexDirection: 'row',
    gap: space.s,
    alignItems: 'flex-start',
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: tint(colors.danger, '80'),
    backgroundColor: colors.dangerSurface,
    padding: space.m,
  },
  warningText: { flex: 1, color: '#FFB3BA', fontSize: 14, lineHeight: 19 },
  speciesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    borderRadius: radius.m,
    borderWidth: 1,
    borderLeftWidth: 4,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: space.s,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: radius.s,
    backgroundColor: colors.surfaceRaised,
  },
  speciesName: { color: colors.text, fontSize: 16, fontWeight: '700' },
  latin: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic' },
  badge: {
    borderRadius: 12,
    paddingHorizontal: space.s,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 11, fontWeight: '800' },
  photos: { flexDirection: 'row', gap: space.s },
  photo: {
    flex: 1,
    height: 170,
    borderRadius: radius.m,
    backgroundColor: colors.surfaceRaised,
  },
  photoWide: { height: 220 },
  credit: { color: colors.textSubtle, fontSize: 11, lineHeight: 15 },
  card: {
    gap: space.s,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: space.m,
  },
  cardDanger: {
    borderColor: tint(colors.danger, '80'),
    backgroundColor: colors.dangerSurface,
  },
  cardWarn: {
    borderColor: tint(colors.warning, '66'),
    backgroundColor: tint(colors.warning, '12'),
  },
  progress: { flexDirection: 'row', gap: space.xs },
  progressStep: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  progressOn: { backgroundColor: colors.primary },
  answer: {
    minHeight: 56,
    justifyContent: 'center',
    gap: 2,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.borderActive,
    backgroundColor: colors.surface,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
  },
  answerLabel: { color: colors.text, fontSize: 17, fontWeight: '700' },
  resultTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  restart: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.borderActive,
  },
  restartText: { color: colors.cyan, fontSize: 16, fontWeight: '700' },
  callButton: {
    flex: 1,
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: radius.m,
    backgroundColor: colors.danger,
  },
  callNumber: { color: colors.text, fontSize: 26, fontWeight: '800' },
  callLabel: { color: colors.text, fontSize: 12, fontWeight: '700' },
});
