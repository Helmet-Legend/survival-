/**
 * Politique de confidentialité, lisible sans réseau (même texte que la
 * page publiée pour Google Play).
 */
import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import {
  PRIVACY_SECTIONS,
  PRIVACY_SUMMARY,
  PRIVACY_UPDATED,
} from '../../content/privacy';
import { Panel, ScreenTitle } from '../components/controls';
import { formatDate } from '../format';
import { useNavigation } from '../navigation';
import { sizes, space, text } from '../theme';

/** Mention de droits, hors du texte de la politique (publié tel quel). */
export const COPYRIGHT =
  '© 2026 Helmet-Legend. Tous droits réservés. Version de test, ne pas diffuser.';

export function PrivacyScreen() {
  const navigation = useNavigation();
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScreenTitle
        title="Politique de confidentialité"
        onBack={navigation.close}
        backLabel={navigation.backLabel}
      />
      <Text style={text.body}>{PRIVACY_SUMMARY}</Text>
      {PRIVACY_SECTIONS.map(section => (
        <Panel key={section.title} title={section.title}>
          {section.paragraphs.map(paragraph => (
            <Text key={paragraph} style={text.muted}>
              {paragraph}
            </Text>
          ))}
        </Panel>
      ))}
      <Text style={text.subtle}>
        Mise à jour : {formatDate(PRIVACY_UPDATED)}
      </Text>
      <Text style={text.subtle}>{COPYRIGHT}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: sizes.screenPadding,
    paddingBottom: space.xl,
    gap: space.m,
  },
});
