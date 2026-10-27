/**
 * Guides : catégories de fiches (nombre réel de fiches), recherche plein
 * texte et lecture. Les fiches sont stockées dans le coffre, hors ligne.
 */
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  ClipboardList,
  Compass,
  DoorOpen,
  ExternalLink,
  Landmark,
  Timer,
  Droplet,
  HeartPulse,
  House,
  Radio,
  SearchX,
  Shield,
  Siren,
  Trees,
  Utensils,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react-native';
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
  F,
  GUIDE_FOLDERS,
  readMeta,
  type FicheLink,
  type Phase,
  type Priority,
  ficheInfo,
  ficheLayout,
  ficheSources,
  HEADER_KEYS,
  imageCard,
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
import { crisisById } from '../../plan/crisis';
import {
  computeResilience,
  loadConsumableLots,
  loadHousehold,
} from '../../resilience/resilienceCalculator';
import {
  Button,
  EmptyState,
  IconTile,
  Notice,
  SearchField,
} from '../components/controls';
import { formatNumber } from '../format';
import { GUIDE_IMAGES } from '../guideImages';
import { WaterIcon, type Icon as AppIcon } from '../icons';
import { useNavigation } from '../navigation';
import { useSession } from '../session';
import { colors, radius, sizes, space, text, tint } from '../theme';
import { useBack } from '../useBackHandler';
import { useLoader } from '../useLoader';

interface GuideRow {
  slug: string;
  title: string;
  category: string;
  priority: Priority;
  minutes?: number | null;
  /** « En bref » de la fiche, affiché sous le titre dans la liste. */
  summary?: string | null;
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

/**
 * Fiche à rouvrir au retour dans les Fiches, après un lien « Dans Fenrir »
 * (stock d'eau, simulateur) : l'écran des fiches est refermé entre-temps.
 */
let resume: { slug: string; category: string | null; query: string } | null =
  null;

export function GuidesScreen() {
  const { db } = useSession();
  const [initial] = useState(() => {
    const value = resume;
    resume = null;
    return value;
  });
  const [query, setQuery] = useState(initial?.query ?? '');
  const [category, setCategory] = useState<string | null>(
    initial?.category ?? null,
  );
  const [slug, setSlug] = useState<string | null>(initial?.slug ?? null);
  // « Retour » : de la recherche ou d'une catégorie à toutes les catégories
  // (la fiche ouverte se referme d'elle-même).
  useBack(category !== null || query !== '', () =>
    query !== '' ? setQuery('') : setCategory(null),
  );

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
          summary: ficheInfo(String(r.body)).summary,
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
    return (
      <GuideReader
        slug={slug}
        onBack={() => setSlug(null)}
        onLeave={() => {
          resume = { slug, category, query };
        }}
        onOpenGuide={setSlug}
        backLabel={
          query.trim() !== ''
            ? 'Retour aux résultats'
            : category !== null
            ? `Retour : ${category}`
            : undefined
        }
      />
    );
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
        label="Rechercher une fiche"
        value={query}
        onChangeText={setQuery}
        placeholder="Rechercher une fiche…"
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
                {guide.snippet ? (
                  <Snippet text={guide.snippet} />
                ) : guide.summary ? (
                  <Text style={text.subtle} numberOfLines={2}>
                    {guide.summary}
                  </Text>
                ) : null}
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
  /**
   * Avec ces deux rappels, la fiche affiche ses liens « Dans Fenrir » :
   * `onLeave` avant d'ouvrir un autre écran, `onOpenGuide` pour une fiche.
   */
  onLeave?: () => void;
  onOpenGuide?: (slug: string) => void;
}) {
  const { db } = useSession();
  useBack(true, props.onBack);
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
          <FicheTitle
            category={String(data.category)}
            title={String(data.title)}
          />
          <FicheBody
            slug={props.slug}
            category={String(data.category)}
            body={String(data.body)}
            onLeave={props.onLeave}
            onOpenGuide={props.onOpenGuide}
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

/**
 * Corps de la fiche : actions prioritaires, texte (en onglets Avant /
 * Pendant / Après s'il y en a), choses à ne pas faire, liens, pied.
 */
/**
 * Catégorie et titre, avec l'icône de la famille : la même icône et la même
 * couleur que son dossier dans la liste des fiches.
 */
function FicheTitle(props: { category: string; title: string }) {
  const [Icon, color] = categoryStyle(props.category);
  return (
    <>
      <Text style={[text.label, { color }]}>{props.category}</Text>
      <View style={styles.titleRow}>
        <View
          style={[
            styles.familyIcon,
            { borderColor: tint(color, '88'), backgroundColor: tint(color) },
          ]}
        >
          <Icon color={color} size={22} />
        </View>
        <Text accessibilityRole="header" style={[text.h1, styles.grow]}>
          {props.title}
        </Text>
      </View>
    </>
  );
}

function FicheBody(props: {
  slug: string;
  category: string;
  body: string;
  onLeave?: () => void;
  onOpenGuide?: (slug: string) => void;
}) {
  const layout = ficheLayout(props.body);
  const phases = layout.phases.map(p => p.phase);
  const [phase, setPhase] = useState<Phase | null>(
    phases.includes('Pendant') ? 'Pendant' : phases[0] ?? null,
  );
  const current = layout.phases.find(p => p.phase === phase);
  // Couleur de la famille : « En bref », numéros d'étapes, libellés des
  // tableaux. Le rouge (danger) et l'orange (actions prioritaires) restent.
  const accent = categoryStyle(props.category)[1];
  const lines = (list: string[], key: string) =>
    blocks(list).map((block, i) =>
      typeof block === 'string' ? (
        <GuideLine key={`${key}${i}`} line={block} accent={accent} />
      ) : block.kind === 'checks' ? (
        <GuideChecklist
          key={`${key}${i}`}
          slug={props.slug}
          items={block.items}
        />
      ) : (
        <GuideFold key={`${key}${i}`} title={block.title} items={block.items} />
      ),
    );
  const showLinks =
    props.onLeave !== undefined &&
    props.onOpenGuide !== undefined &&
    layout.links.length > 0;
  return (
    <>
      <FicheHeader body={props.body} accent={accent} />
      {layout.priorities.length > 0 ? (
        <View style={styles.priorities}>
          <Text accessibilityRole="header" style={styles.prioritiesTitle}>
            {layout.priorities.length === 3
              ? 'Les 3 actions prioritaires'
              : 'Actions prioritaires'}
          </Text>
          {layout.priorities.map((action, i) => (
            <View key={action} style={styles.priority}>
              <Text style={styles.priorityMark}>{i + 1}</Text>
              <Text style={[text.body, styles.grow]}>{action}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {lines(layout.intro, 'i')}
      {phases.length > 0 ? (
        <View style={styles.tabs} accessibilityRole="tablist">
          {phases.map(p => (
            <Pressable
              key={p}
              accessibilityRole="tab"
              accessibilityState={{ selected: p === phase }}
              onPress={() => setPhase(p)}
              style={[styles.tab, p === phase && styles.tabOn]}
            >
              <Text style={[styles.tabText, p === phase && styles.tabTextOn]}>
                {p}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {current ? lines(current.lines, current.phase) : null}
      {layout.donts.length > 0 ? (
        <View style={styles.donts}>
          <Text accessibilityRole="header" style={styles.dontsTitle}>
            À ne surtout pas faire
          </Text>
          {layout.donts.map(item => (
            <View key={item} style={styles.priority}>
              <X color={colors.danger} size={18} strokeWidth={3} />
              <Text style={[text.body, styles.grow]}>{item}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {showLinks ? (
        <FicheLinks
          links={layout.links}
          onLeave={props.onLeave!}
          onOpenGuide={props.onOpenGuide!}
        />
      ) : null}
      <MetaFooter body={props.body} />
    </>
  );
}

/** Fiche qui renvoie aux consignes officielles de sa commune. */
const LOCAL_RISKS_SLUG = 'evaluer-risques-foyer';

/** Liens « Dans Fenrir » : stock d'eau réel, simulateur, consignes locales. */
function FicheLinks(props: {
  links: FicheLink[];
  onLeave: () => void;
  onOpenGuide: (slug: string) => void;
}) {
  const { db } = useSession();
  const navigation = useNavigation();
  const wantsWater = props.links.some(l => l.kind === 'waterStock');
  const { data: water } = useLoader(async () => {
    if (!wantsWater) {
      return null;
    }
    const [household, lots] = await Promise.all([
      loadHousehold(db),
      loadConsumableLots(db),
    ]);
    const report = computeResilience(lots, household, localToday());
    return {
      liters: report.water.available,
      days: report.water.days,
      members: household.members,
    };
  }, [wantsWater]);
  return (
    <View style={styles.links}>
      <Text style={text.label}>Dans Fenrir</Text>
      {props.links.map(link => {
        if (link.kind === 'waterStock') {
          return (
            <ModuleLink
              key="water"
              icon={WaterIcon}
              color={colors.water}
              title="Mon stock d’eau"
              detail={
                water
                  ? `${formatNumber(water.liters)} L · ${water.days} j pour ${
                      water.members
                    } personne${water.members > 1 ? 's' : ''}`
                  : 'Réserves d’eau du foyer'
              }
              onPress={() => {
                props.onLeave();
                navigation.goTo('stock', { category: 'water' });
              }}
            />
          );
        }
        if (link.kind === 'healthStock') {
          return (
            <ModuleLink
              key="health"
              icon={HeartPulse}
              color={colors.health}
              title="Ma trousse de secours"
              detail="Médicaments et matériel de soin du stock"
              onPress={() => {
                props.onLeave();
                navigation.goTo('stock', { category: 'medical' });
              }}
            />
          );
        }
        if (link.kind === 'crisis') {
          return (
            <ModuleLink
              key={`crisis-${link.scenario}`}
              icon={Timer}
              color={colors.cyan}
              title={`Simuler : ${crisisById(link.scenario).label}`}
              detail="Jour par jour, sur votre stock réel"
              onPress={() => {
                props.onLeave();
                navigation.openCrisis(link.scenario);
              }}
            />
          );
        }
        return (
          <ModuleLink
            key="local"
            icon={Landmark}
            color={colors.purple}
            title="Consignes officielles locales"
            detail="DICRIM de la mairie, PFMS, Géorisques"
            onPress={() => props.onOpenGuide(LOCAL_RISKS_SLUG)}
          />
        );
      })}
    </View>
  );
}

function ModuleLink(props: {
  icon: AppIcon;
  color: string;
  title: string;
  detail: string;
  onPress: () => void;
}) {
  const Icon = props.icon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.title}. ${props.detail}`}
      onPress={props.onPress}
      style={({ pressed }) => [styles.moduleLink, pressed && styles.pressed]}
    >
      <View style={[styles.moduleIcon, { backgroundColor: tint(props.color) }]}>
        <Icon color={props.color} size={20} />
      </View>
      <View style={styles.grow}>
        <Text style={styles.title}>{props.title}</Text>
        <Text style={text.subtle}>{props.detail}</Text>
      </View>
      <ChevronRight color={colors.textMuted} size={20} />
    </Pressable>
  );
}

type Block =
  | string
  | { kind: 'checks'; items: string[] }
  | { kind: 'fold'; title: string; items: string[] };

/**
 * Les lignes « ☐ » consécutives forment une liste de contrôle ; une ligne
 * « ▸ Titre » ouvre un volet repliable qui reçoit les puces « - » suivantes.
 */
function blocks(lines: readonly string[]): Block[] {
  const out: Block[] = [];
  for (const line of lines) {
    const last = out[out.length - 1];
    if (line.startsWith(CHECK_PREFIX)) {
      const label = line.slice(CHECK_PREFIX.length);
      if (typeof last === 'object' && last.kind === 'checks') {
        last.items.push(label);
      } else {
        out.push({ kind: 'checks', items: [label] });
      }
    } else if (line.startsWith('▸ ')) {
      out.push({ kind: 'fold', title: line.slice(2).trim(), items: [] });
    } else if (
      line.startsWith('- ') &&
      typeof last === 'object' &&
      last.kind === 'fold'
    ) {
      last.items.push(line.slice(2));
    } else {
      out.push(line);
    }
  }
  return out;
}

/** Volet repliable : fermé à l'ouverture de la fiche, ouvert d'un appui. */
function GuideFold(props: { title: string; items: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.fold}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(o => !o)}
        style={({ pressed }) => [styles.foldHead, pressed && styles.pressed]}
      >
        <Text style={[styles.title, styles.grow]}>{props.title}</Text>
        <ChevronDown
          color={colors.textMuted}
          size={20}
          style={open ? styles.foldOpen : undefined}
        />
      </Pressable>
      {open
        ? props.items.map(item => (
            <View key={item} style={styles.bullet}>
              <Text style={styles.bulletMark}>•</Text>
              <Text style={[text.body, styles.grow]}>{item}</Text>
            </View>
          ))
        : null}
    </View>
  );
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
function FicheHeader({ body, accent }: { body: string; accent: string }) {
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
        <View style={[styles.brief, { borderLeftColor: accent }]}>
          <Text style={[styles.briefLabel, { color: accent }]}>En bref</Text>
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

const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

/** `2026-10` → « octobre 2026 ». */
function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return MONTHS[m - 1] ? `${MONTHS[m - 1]} ${y}` : month;
}

/** Pied de fiche : priorité, références, pages en ligne, dates, relecture. */
function MetaFooter({ body }: { body: string }) {
  const entries = readMeta(body).entries.filter(
    ([key]) => !HEADER_KEYS.has(key) && key !== 'Source',
  );
  const sources = ficheSources(body);
  const checked = ficheInfo(body).checked;
  return (
    <View style={styles.meta}>
      {sources.length > 0 ? (
        <View style={styles.sources}>
          <Text style={styles.metaKey}>Sources en ligne</Text>
          {sources.map(source => (
            <Pressable
              key={source.url}
              accessibilityRole="link"
              accessibilityLabel={`${source.org} : ${source.title}, ouvrir ${source.url}`}
              onPress={() => {
                Linking.openURL(source.url).catch(() => undefined);
              }}
              style={({ pressed }) => [
                styles.source,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.grow}>
                <Text style={[text.body, styles.sourceOrg]}>{source.org}</Text>
                <Text style={text.subtle}>
                  {source.title} · consulté en {monthLabel(source.consulted)}
                </Text>
                <Text style={styles.sourceUrl}>
                  {source.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}
                </Text>
              </View>
              <ExternalLink color={colors.cyan} size={16} />
            </Pressable>
          ))}
        </View>
      ) : null}
      {checked !== null ? (
        <Text style={text.subtle}>
          <Text style={styles.metaKey}>Vérifiée : </Text>
          {monthLabel(checked)}
        </Text>
      ) : null}
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

function GuideLine({ line, accent }: { line: string; accent: string }) {
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
  const card = imageCard(line);
  if (card) {
    const source = GUIDE_IMAGES[card.image];
    return (
      <View style={styles.imageCard}>
        {source ? (
          <Image
            source={source}
            style={styles.cardImage}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        ) : null}
        <View style={[styles.grow, styles.cardText]}>
          <Text style={styles.title}>{card.title}</Text>
          {card.text ? <Text style={text.muted}>{card.text}</Text> : null}
        </View>
      </View>
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
        <Text style={[styles.tableLabel, { color: accent }]}>{label}</Text>
        {rest.length > 0 ? (
          <Text style={[text.body, styles.grow]}>{rest.join(' ')}</Text>
        ) : null}
      </View>
    );
  }
  const step = /^(\d+)\. (.*)$/.exec(line);
  if (step) {
    return (
      <View style={styles.step}>
        <Text style={[styles.stepPill, { backgroundColor: accent }]}>
          {step[1]}
        </Text>
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  familyIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.s,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: space.m },
  stepPill: {
    width: 28,
    height: 28,
    borderRadius: 9,
    overflow: 'hidden',
    textAlign: 'center',
    lineHeight: 28,
    fontSize: 15,
    fontWeight: '800',
    color: colors.onPrimary,
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
  priorities: {
    gap: space.s,
    padding: space.m,
    borderRadius: radius.s,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: tint(colors.primary, '14'),
  },
  prioritiesTitle: { ...text.label, color: colors.primary },
  priority: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s },
  priorityMark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    overflow: 'hidden',
    textAlign: 'center',
    lineHeight: 24,
    fontWeight: '800',
    color: colors.onPrimary,
    backgroundColor: colors.primary,
  },
  tabs: {
    flexDirection: 'row',
    gap: space.xs,
    padding: space.xs,
    borderRadius: radius.s,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  tab: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.s,
  },
  tabOn: {
    backgroundColor: colors.overlay,
    borderWidth: 1,
    borderColor: colors.borderActive,
  },
  tabText: { color: colors.textMuted, fontSize: 15, fontWeight: '700' },
  tabTextOn: { color: colors.cyan },
  donts: {
    gap: space.s,
    padding: space.m,
    borderRadius: radius.s,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSurface,
  },
  dontsTitle: { ...text.label, color: colors.danger },
  links: { gap: space.s, marginTop: space.s },
  moduleLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: 56,
    padding: space.m,
    borderRadius: radius.s,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  moduleIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.s,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sources: { gap: space.s, marginBottom: space.s },
  source: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    minHeight: 44,
  },
  sourceOrg: { fontWeight: '600' },
  sourceUrl: { color: colors.cyan, fontSize: 13 },
  imageCard: {
    flexDirection: 'row',
    overflow: 'hidden',
    borderRadius: radius.s,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  // Proportions des illustrations : l'image n'est ni étirée ni rognée
  // quand le texte de la carte est long.
  cardImage: { width: '38%', aspectRatio: 1.2, alignSelf: 'flex-start' },
  cardText: { gap: 2, padding: space.m, justifyContent: 'center' },
  fold: {
    borderRadius: radius.s,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    paddingHorizontal: space.m,
    paddingBottom: space.xs,
    gap: space.xs,
  },
  foldHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    minHeight: 48,
  },
  foldOpen: { transform: [{ rotate: '180deg' }] },
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
