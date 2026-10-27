/**
 * Réglages › Sauvegarde : exporter le coffre ouvert dans un fichier chiffré
 * par un mot de passe, le restaurer (sur ce téléphone ou un autre), ou
 * exporter le stock en tableur.
 */
import { DatabaseBackup, FileDown, FileUp, Sheet } from 'lucide-react-native';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  BACKUP_EXTENSION,
  BACKUP_PASSWORD_MIN,
  BackupError,
  createBackup,
  restoreBackup,
} from '../../backup/backup';
import { stockCsv } from '../../backup/csv';
import {
  backupAge,
  getBackupStatus,
  loadLastBackup,
  saveLastBackup,
} from '../../backup/lastBackup';
import { localToday } from '../../lib/dates';
import { syncReminders } from '../../resilience/reminders';
import { Button, Field, Notice, Panel } from '../components/controls';
import { CATEGORY_TITLES, formatDate, UNIT_LABELS } from '../format';
import { useSession } from '../session';
import { colors, radius, space, text } from '../theme';
import { useLoader } from '../useLoader';

type Mode = 'idle' | 'export' | 'restore';
type Feedback = { message: string; tone: 'ok' | 'error' } | null;

function errorText(e: unknown): string {
  return e instanceof BackupError || e instanceof Error ? e.message : String(e);
}

/** « 12 articles, 30 lots, 4 photos, » d'après le recomptage. */
function restoredCounts(counts: Record<string, number> = {}): string {
  const parts = (
    [
      ['inventory_items', 'article', 'articles'],
      ['inventory_lots', 'lot', 'lots'],
      ['documents', 'document', 'documents'],
      ['photos', 'photo', 'photos'],
    ] as const
  )
    .filter(([table]) => (counts[table] ?? 0) > 0)
    .map(([table, one, many]) => {
      const n = counts[table];
      return `${n} ${n > 1 ? many : one}`;
    });
  return parts.length > 0 ? `${parts.join(', ')}, ` : '';
}

export function BackupPanel(props: { onRestored: () => Promise<void> }) {
  const { db, files, backupCrypto, reminders } = useSession();
  const [mode, setMode] = useState<Mode>('idle');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const { data: status, reload: reloadStatus } = useLoader(() =>
    getBackupStatus(db),
  );

  if (!files.available || backupCrypto === null) {
    return null;
  }
  const crypto = backupCrypto;

  const reset = () => {
    setMode('idle');
    setPassword('');
    setConfirm('');
    setPending(null);
    setFieldError(null);
  };

  const exportBackup = async () => {
    setFieldError(null);
    if (password.length < BACKUP_PASSWORD_MIN) {
      setFieldError(`Au moins ${BACKUP_PASSWORD_MIN} caractères`);
      return;
    }
    if (password !== confirm) {
      setFieldError('Les deux mots de passe sont différents');
      return;
    }
    setBusy(true);
    try {
      const { text: content, summary } = await createBackup(
        db,
        password,
        crypto,
      );
      const saved = await files.saveText(
        `fenrir-sauvegarde-${localToday()}.${BACKUP_EXTENSION}`,
        'application/octet-stream',
        content,
      );
      reset();
      if (saved) {
        await saveLastBackup(db);
        await reloadStatus();
      }
      setFeedback(
        saved
          ? {
              message: `Sauvegarde enregistrée (${summary.rows} éléments). Gardez le mot de passe : sans lui, elle est illisible.`,
              tone: 'ok',
            }
          : { message: 'Enregistrement annulé.', tone: 'error' },
      );
    } catch (e) {
      setFeedback({ message: errorText(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const pickBackup = async () => {
    setFeedback(null);
    try {
      const content = await files.openText();
      if (content !== null) {
        setPending(content);
        setMode('restore');
      }
    } catch (e) {
      setFeedback({ message: errorText(e), tone: 'error' });
    }
  };

  const restore = async () => {
    if (pending === null) {
      return;
    }
    setFieldError(null);
    setBusy(true);
    try {
      // La date de la dernière sauvegarde reste celle de ce téléphone.
      const lastBackup = await loadLastBackup(db);
      const summary = await restoreBackup(db, pending, password, crypto.engine);
      if (lastBackup !== null) {
        await saveLastBackup(db, lastBackup);
      }
      await reloadStatus();
      await syncReminders(db, reminders).catch(() => undefined);
      reset();
      setFeedback({
        message: `Sauvegarde du ${formatDate(
          summary.createdAt.slice(0, 10),
        )} restaurée et vérifiée : ${restoredCounts(summary.counts)}${
          summary.rows
        } éléments au total.`,
        tone: 'ok',
      });
      await props.onRestored();
    } catch (e) {
      if (e instanceof BackupError && e.code === 'WRONG_PASSWORD') {
        setFieldError(e.message);
      } else {
        setFeedback({ message: errorText(e), tone: 'error' });
      }
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    setFeedback(null);
    try {
      const csv = await stockCsv(db, {
        category: CATEGORY_TITLES,
        unit: UNIT_LABELS,
      });
      const saved = await files.saveText(
        `fenrir-stock-${localToday()}.csv`,
        'text/csv',
        csv,
      );
      setFeedback(
        saved
          ? { message: 'Stock exporté en tableur.', tone: 'ok' }
          : { message: 'Export annulé.', tone: 'error' },
      );
    } catch (e) {
      setFeedback({ message: errorText(e), tone: 'error' });
    }
  };

  return (
    <Panel
      title="Sauvegarde"
      right={<DatabaseBackup color={colors.cyan} size={20} />}
    >
      {status ? (
        <View style={[styles.last, status.due && styles.lastDue]}>
          <Text style={[text.body, status.due && styles.lastDueText]}>
            {status.last === null || status.daysSince === null
              ? 'Aucune sauvegarde pour l’instant.'
              : `Dernière sauvegarde : ${backupAge(status.daysSince)}`}
          </Text>
          {status.last !== null && (status.daysSince ?? 0) > 1 ? (
            <Text style={text.subtle}>le {formatDate(status.last)}</Text>
          ) : null}
        </View>
      ) : null}
      <Text style={text.muted}>
        Votre coffre n’existe que sur ce téléphone. Exportez une sauvegarde
        chiffrée et gardez-la ailleurs, de préférence hors du téléphone : Google
        Drive, clé USB, carte SD retirée ensuite, ordinateur.
      </Text>

      {mode === 'export' ? (
        <View style={styles.form}>
          <Field
            label="Mot de passe de la sauvegarde"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            hint={`${BACKUP_PASSWORD_MIN} caractères minimum, différent de votre code.`}
          />
          <Field
            label="Confirmer le mot de passe"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            error={fieldError}
          />
          <Text style={text.subtle}>
            Notez-le sur papier : sans lui, personne ne peut lire la sauvegarde,
            pas même vous.
          </Text>
          <View style={styles.row}>
            <Button
              variant="primary"
              label={busy ? 'Chiffrement…' : 'Chiffrer et enregistrer'}
              disabled={busy}
              onPress={() => {
                void exportBackup();
              }}
            />
            <Button variant="ghost" label="Annuler" onPress={reset} />
          </View>
        </View>
      ) : null}

      {mode === 'restore' ? (
        <View style={styles.form}>
          <Notice
            tone="error"
            message="La restauration remplace tout le contenu de ce coffre (stock, sacs, armes, documents, photos)."
          />
          <Field
            label="Mot de passe de la sauvegarde"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            error={fieldError}
          />
          <View style={styles.row}>
            <Button
              variant="danger"
              label={busy ? 'Restauration…' : 'Restaurer'}
              disabled={busy}
              onPress={() => {
                void restore();
              }}
            />
            <Button variant="ghost" label="Annuler" onPress={reset} />
          </View>
        </View>
      ) : null}

      {mode === 'idle' ? (
        <View style={styles.actions}>
          <Button
            icon={FileDown}
            label="Exporter une sauvegarde"
            onPress={() => {
              setFeedback(null);
              setMode('export');
            }}
          />
          <Button
            icon={FileUp}
            label="Restaurer une sauvegarde"
            onPress={() => {
              void pickBackup();
            }}
          />
          <Button
            variant="ghost"
            icon={Sheet}
            label="Exporter le stock (tableur, non chiffré)"
            onPress={() => {
              void exportCsv();
            }}
          />
        </View>
      ) : null}

      {feedback ? <Notice {...feedback} /> : null}
    </Panel>
  );
}

const styles = StyleSheet.create({
  last: {
    gap: space.xs,
    padding: space.s,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
  },
  lastDue: { borderColor: colors.warning },
  lastDueText: { color: colors.warning },
  form: { gap: space.m },
  actions: { gap: space.s },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
});
