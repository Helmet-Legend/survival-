/**
 * Dossier « Documents » de l'écran Stocks : pièces d'identité, permis,
 * carte Vitale, mutuelle… avec numéro, titulaire, date d'expiration et
 * photos, gardés dans le coffre chiffré.
 */
import {
  BookUser,
  Car,
  FileText,
  HeartPulse,
  IdCard,
  Pencil,
  Plus,
  ShieldPlus,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  DOCUMENT_KINDS,
  DOCUMENT_RENEW_DAYS,
  InventoryError,
  type DocumentKind,
  type DocumentSummary,
} from '../../inventory';
import {
  Button,
  Chip,
  Field,
  IconTile,
  Panel,
  SectionTitle,
  StatusChip,
} from '../components/controls';
import { PhotoStrip } from '../components/PhotoStrip';
import { formatDate } from '../format';
import { useSession } from '../session';
import { colors, radius, space, text, type StatusTone } from '../theme';

type Feedback = { message: string; tone: 'ok' | 'error' };

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  id_card: 'Carte d’identité',
  passport: 'Passeport',
  driving_licence: 'Permis de conduire',
  health_card: 'Carte Vitale',
  insurance: 'Mutuelle / assurance',
  other: 'Autre',
};

const KIND_ICONS: Record<DocumentKind, LucideIcon> = {
  id_card: IdCard,
  passport: BookUser,
  driving_licence: Car,
  health_card: HeartPulse,
  insurance: ShieldPlus,
  other: FileText,
};

/** État d'expiration affiché sur la carte du document. */
export function documentStatus(
  doc: Pick<DocumentSummary, 'daysLeft' | 'expiresAt'>,
): { tone: StatusTone; label: string } | null {
  if (doc.daysLeft === null || doc.expiresAt === null) {
    return null;
  }
  if (doc.daysLeft < 0) {
    return { tone: 'danger', label: 'Expiré' };
  }
  if (doc.daysLeft <= DOCUMENT_RENEW_DAYS) {
    return { tone: 'warn', label: 'À renouveler' };
  }
  return null;
}

export function DocumentsSection(props: {
  documents: readonly DocumentSummary[];
  onChanged: (feedback: Feedback) => Promise<void>;
}) {
  const { documents } = useSession();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const remove = async (doc: DocumentSummary) => {
    setConfirmDelete(null);
    setExpanded(null);
    try {
      await documents.remove(doc.id);
      await props.onChanged({
        message: `« ${doc.title} » supprimé, avec ses photos.`,
        tone: 'ok',
      });
    } catch (e) {
      await props.onChanged({
        message: e instanceof Error ? e.message : String(e),
        tone: 'error',
      });
    }
  };

  return (
    <View style={styles.section}>
      <SectionTitle
        title="Documents"
        right={
          <Button
            compact
            variant={editing === 'new' ? 'ghost' : 'primary'}
            icon={editing === 'new' ? X : Plus}
            label={editing === 'new' ? 'Fermer' : 'Ajouter un document'}
            onPress={() => setEditing(editing === 'new' ? null : 'new')}
          />
        }
      />
      <Text style={text.subtle}>
        Numéros, dates et photos de vos papiers, chiffrés dans le coffre :
        utiles pour les refaire en cas de perte ou de vol.
      </Text>

      {editing === 'new' ? (
        <DocumentForm
          onDone={async (message, id) => {
            setEditing(null);
            setExpanded(id);
            await props.onChanged({ message, tone: 'ok' });
          }}
        />
      ) : null}

      {props.documents.length === 0 && editing !== 'new' ? (
        <Text style={text.muted}>Aucun document enregistré.</Text>
      ) : null}

      {props.documents.map(doc => {
        if (editing === doc.id) {
          return (
            <DocumentForm
              key={doc.id}
              doc={doc}
              onCancel={() => setEditing(null)}
              onDone={async message => {
                setEditing(null);
                await props.onChanged({ message, tone: 'ok' });
              }}
            />
          );
        }
        const status = documentStatus(doc);
        const open = expanded === doc.id;
        return (
          <View key={doc.id} style={styles.card}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              accessibilityLabel={`${doc.title}, ${
                DOCUMENT_KIND_LABELS[doc.kind]
              }${status ? `, ${status.label}` : ''}`}
              onPress={() => setExpanded(open ? null : doc.id)}
              style={({ pressed }) => [styles.head, pressed && styles.pressed]}
            >
              <IconTile icon={KIND_ICONS[doc.kind]} color={colors.cyan} />
              <View style={styles.grow}>
                <Text style={text.h3}>{doc.title}</Text>
                <Text style={text.muted}>
                  {DOCUMENT_KIND_LABELS[doc.kind]}
                  {doc.holder ? ` · ${doc.holder}` : ''}
                </Text>
                {doc.expiresAt ? (
                  <Text style={text.subtle}>
                    {doc.daysLeft !== null && doc.daysLeft < 0
                      ? `Expiré le ${formatDate(doc.expiresAt)}`
                      : `Valide jusqu’au ${formatDate(doc.expiresAt)}`}
                  </Text>
                ) : null}
                {status ? (
                  <StatusChip tone={status.tone} label={status.label} />
                ) : null}
              </View>
            </Pressable>
            {open ? (
              <View style={styles.detail}>
                <Text selectable style={text.body}>
                  N° : {doc.number ?? 'non renseigné'}
                </Text>
                {doc.notes ? (
                  <Text selectable style={text.muted}>
                    {doc.notes}
                  </Text>
                ) : null}
                <PhotoStrip
                  owner="document"
                  ownerId={doc.id}
                  label={doc.title}
                />
                {confirmDelete === doc.id ? (
                  <Panel accent={colors.danger} style={styles.dialog}>
                    <Text style={text.body}>
                      Supprimer « {doc.title} » et ses photos ?
                    </Text>
                    <View style={styles.row}>
                      <Button
                        variant="danger"
                        label="Supprimer"
                        onPress={() => {
                          void remove(doc);
                        }}
                      />
                      <Button
                        variant="ghost"
                        label="Annuler"
                        onPress={() => setConfirmDelete(null)}
                      />
                    </View>
                  </Panel>
                ) : (
                  <View style={styles.row}>
                    <Button
                      compact
                      icon={Pencil}
                      label="Modifier"
                      onPress={() => setEditing(doc.id)}
                    />
                    <Button
                      compact
                      variant="danger"
                      icon={Trash2}
                      label="Supprimer le document"
                      onPress={() => setConfirmDelete(doc.id)}
                    />
                  </View>
                )}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function DocumentForm(props: {
  doc?: DocumentSummary;
  onDone: (message: string, id: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const { documents } = useSession();
  const [kind, setKind] = useState<DocumentKind>(props.doc?.kind ?? 'id_card');
  const [title, setTitle] = useState(props.doc?.title ?? '');
  const [holder, setHolder] = useState(props.doc?.holder ?? '');
  const [number, setNumber] = useState(props.doc?.number ?? '');
  const [expiresAt, setExpiresAt] = useState(props.doc?.expiresAt ?? '');
  const [notes, setNotes] = useState(props.doc?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    setErrors({});
    const input = {
      kind,
      // Sans intitulé, le type suffit (« Passeport »).
      title: title.trim() === '' ? DOCUMENT_KIND_LABELS[kind] : title,
      holder,
      number,
      expiresAt,
      notes,
    };
    try {
      const saved = props.doc
        ? await documents.update(props.doc.id, input)
        : await documents.create(input);
      await props.onDone(
        props.doc
          ? `« ${saved.title} » modifié.`
          : `« ${saved.title} » ajouté. Vous pouvez maintenant le photographier.`,
        saved.id,
      );
    } catch (e) {
      if (e instanceof InventoryError && e.field) {
        setErrors({ [e.field]: e.message });
      } else {
        setErrors({ form: e instanceof Error ? e.message : String(e) });
      }
    }
  };

  return (
    <Panel
      title={props.doc ? 'Modifier le document' : 'Nouveau document'}
      accent={colors.primary}
    >
      <Text style={styles.fieldLabel}>Type</Text>
      <View style={styles.wrap}>
        {DOCUMENT_KINDS.map(k => (
          <Chip
            key={k}
            label={DOCUMENT_KIND_LABELS[k]}
            selected={kind === k}
            onPress={() => setKind(k)}
          />
        ))}
      </View>
      <Field
        label="Intitulé (facultatif)"
        value={title}
        onChangeText={setTitle}
        placeholder={DOCUMENT_KIND_LABELS[kind]}
        maxLength={120}
        error={errors.title}
      />
      <Field
        label="Titulaire (facultatif)"
        value={holder}
        onChangeText={setHolder}
        placeholder="Ex. Camille Martin"
        maxLength={120}
        error={errors.holder}
      />
      <Field
        label="Numéro (facultatif)"
        value={number}
        onChangeText={setNumber}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={60}
        error={errors.number}
      />
      <Field
        label="Date d’expiration (AAAA-MM-JJ, facultatif)"
        value={expiresAt}
        onChangeText={setExpiresAt}
        placeholder="2031-05-20"
        autoCapitalize="none"
        error={errors.expiresAt}
        hint={`Signalé « À renouveler » ${DOCUMENT_RENEW_DAYS} jours avant.`}
      />
      <Field
        label="Notes (facultatif)"
        value={notes}
        onChangeText={setNotes}
        placeholder="Lieu de délivrance, contact mutuelle…"
        multiline
        maxLength={500}
        error={errors.notes}
      />
      {errors.form ? <Text style={styles.error}>{errors.form}</Text> : null}
      <View style={styles.row}>
        <Button
          variant="primary"
          label={props.doc ? 'Enregistrer le document' : 'Ajouter le document'}
          onPress={() => {
            void submit();
          }}
        />
        {props.onCancel ? (
          <Button variant="ghost" label="Annuler" onPress={props.onCancel} />
        ) : null}
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.m },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.l,
    padding: space.l,
  },
  pressed: { opacity: 0.82 },
  grow: { flex: 1, minWidth: 0, gap: 4 },
  detail: {
    gap: space.m,
    paddingHorizontal: space.l,
    paddingBottom: space.l,
    paddingTop: space.m,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  dialog: { backgroundColor: colors.bgElevated },
  row: { flexDirection: 'row', gap: space.s, flexWrap: 'wrap' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  fieldLabel: { color: colors.textMuted, fontSize: 14 },
  error: { color: colors.danger },
});
