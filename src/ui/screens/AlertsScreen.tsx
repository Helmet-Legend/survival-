/**
 * Alertes : vigilances et avis officiels (météo, crues, submersion, feux,
 * produits rappelés, médicaments, eau, gaz, carburants, séismes), et leurs
 * réglages. Rien n'est téléchargé tant qu'elles ne sont pas activées.
 */
import { ExternalLink, RefreshCw } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { departmentName, parseDepartments } from '../../alerts/departments';
import { FEEDS, saveAlertSettings, type FeedId } from '../../alerts/store';
import type { Alert } from '../../alerts/types';
import { LEVEL_COLORS } from '../components/AlertBanner';
import {
  Button,
  Field,
  Notice,
  Panel,
  ScreenTitle,
} from '../components/controls';
import { formatDate } from '../format';
import { useNavigation } from '../navigation';
import { useSession } from '../session';
import { colors, radius, sizes, space, text, tint } from '../theme';
import { useAlerts } from '../useAlerts';

const LEVEL_WORDS = { yellow: 'Jaune', orange: 'Orange', red: 'Rouge' };

/** « 20/10/2026 22:00 » d'une date ISO, à l'heure locale. */
function when(iso: string | null): string | null {
  if (iso === null) {
    return null;
  }
  if (iso.length <= 10) {
    return formatDate(iso);
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function AlertsScreen() {
  const { db } = useSession();
  const navigation = useNavigation();
  const { settings, cache, alerts, refreshing, reload } = useAlerts();
  const [departments, setDepartments] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (settings) {
      setDepartments(settings.departments.join(', '));
    }
  }, [settings]);

  const title = (
    <ScreenTitle
      title="Alertes"
      onBack={navigation.close}
      backLabel={navigation.backLabel}
    />
  );
  if (settings === null) {
    return <View style={styles.page}>{title}</View>;
  }

  const save = async (next: { enabled?: boolean; departments?: string[] }) => {
    setNotice(null);
    await saveAlertSettings(db, {
      enabled: next.enabled ?? settings.enabled,
      departments: next.departments ?? settings.departments,
    });
    await reload({ fetch: true, force: true });
  };

  const saveDepartments = () => {
    const codes = parseDepartments(departments);
    if (departments.trim() !== '' && codes.length === 0) {
      setNotice('Département inconnu : saisissez son numéro (13, 2A…).');
      return;
    }
    void save({ departments: codes });
  };

  const feeds = Object.keys(FEEDS) as FeedId[];
  const errors = feeds.filter(id => cache?.feeds[id]?.error);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {title}

      <Panel>
        <View style={styles.row}>
          <Text style={[text.body, styles.grow]}>Alertes en ligne</Text>
          <Switch
            accessibilityLabel="Recevoir les alertes en ligne"
            value={settings.enabled}
            onValueChange={value => {
              void save({ enabled: value });
            }}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={colors.text}
          />
        </View>
        <Text style={text.subtle}>
          {settings.enabled
            ? 'Quand le réseau le permet, Fenrir télécharge les bulletins nationaux et les trie dans le téléphone : vos départements, votre stock et votre domicile ne sont envoyés à personne. Seuls les carburants sont demandés par département.'
            : 'Désactivées : rien n’est téléchargé. Activez-les pour voir vigilances météo, crues, submersion, feux de forêt, produits rappelés de votre stock, médicaments en rupture, restrictions d’eau, signal gaz, carburants et séismes.'}
        </Text>
        {settings.enabled ? (
          <>
            <Field
              label="Départements suivis"
              value={departments}
              onChangeText={setDepartments}
              onEndEditing={saveDepartments}
              onSubmitEditing={saveDepartments}
              placeholder="Ex : 13, 84"
              autoCapitalize="characters"
              hint={
                settings.departments.length === 0
                  ? 'Domicile, travail, point de regroupement, famille…'
                  : settings.departments
                      .map(c => departmentName(c) ?? c)
                      .join(', ')
              }
            />
            <Text style={text.subtle}>
              Séismes : distance calculée depuis votre point « Domicile »
              (onglet Position).
            </Text>
          </>
        ) : null}
        {notice ? <Notice tone="error" message={notice} /> : null}
      </Panel>

      {settings.enabled ? (
        <>
          <Button
            icon={RefreshCw}
            label={refreshing ? 'Mise à jour…' : 'Actualiser'}
            disabled={refreshing}
            onPress={() => {
              void reload({ fetch: true, force: true });
            }}
          />
          {alerts.length === 0 ? (
            <Panel>
              <Text style={text.body}>Aucune alerte en cours.</Text>
              <Text style={text.subtle}>
                {settings.departments.length === 0
                  ? 'Ajoutez au moins un département pour la vigilance météo.'
                  : 'Pas de vigilance jaune, orange ou rouge, ni de produit rappelé dans votre stock.'}
              </Text>
            </Panel>
          ) : (
            alerts.map(a => <AlertCard key={a.id} alert={a} />)
          )}

          <Panel title="Sources">
            {feeds.map(id => {
              const f = cache?.feeds[id];
              return (
                <Text key={id} style={text.subtle}>
                  {FEEDS[id].label} :{' '}
                  {f?.at ? `relevé ${when(f.at)}` : 'pas encore relevé'}
                  {f?.error ? ` · injoignable (${f.error})` : ''}
                </Text>
              );
            })}
            {errors.length > 0 ? (
              <Text style={text.subtle}>
                Sans réseau, le dernier relevé reste affiché.
              </Text>
            ) : null}
          </Panel>
        </>
      ) : null}

      <Text style={text.subtle}>
        Ne remplace pas FR-Alert ni les consignes des autorités : en cas de
        danger immédiat, l’alerte officielle arrive directement sur le
        téléphone.
      </Text>
    </ScrollView>
  );
}

function AlertCard(props: { alert: Alert }) {
  const a = props.alert;
  const color = LEVEL_COLORS[a.level];
  const period = [when(a.start), when(a.end)].filter(Boolean).join(' → ');
  const url = a.url;
  return (
    <View
      style={[
        styles.card,
        { borderColor: tint(color, 'aa'), backgroundColor: tint(color, '12') },
      ]}
    >
      <View style={styles.row}>
        <Text style={[styles.level, { color, borderColor: tint(color, '88') }]}>
          {LEVEL_WORDS[a.level]}
        </Text>
        <Text style={[styles.cardTitle, styles.grow]}>{a.title}</Text>
      </View>
      {a.where ? <Text style={text.body}>{a.where}</Text> : null}
      {period ? <Text style={text.subtle}>{period}</Text> : null}
      {a.detail ? <Text style={text.muted}>{a.detail}</Text> : null}
      {a.instruction ? (
        <Text style={styles.instruction}>{a.instruction}</Text>
      ) : null}
      {url ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Source officielle : ${a.title}`}
          onPress={() => {
            Linking.openURL(url).catch(() => undefined);
          }}
          style={styles.link}
        >
          <ExternalLink color={colors.cyan} size={16} />
          <Text style={styles.linkText}>Source officielle</Text>
        </Pressable>
      ) : null}
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
  card: {
    borderWidth: 1,
    borderRadius: radius.card,
    padding: space.m,
    gap: space.xs,
  },
  level: {
    fontSize: 12,
    fontWeight: '800',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.s,
    paddingVertical: 2,
  },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  instruction: { ...text.body, color: colors.text, fontWeight: '600' },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginTop: space.xs,
  },
  linkText: { color: colors.cyan, fontSize: 14, fontWeight: '600' },
});
