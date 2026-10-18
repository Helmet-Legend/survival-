/**
 * Dossier « Sacs d'évacuation » de l'écran Stocks : un sac par personne ou
 * par véhicule, avec son propre contenu et ses péremptions. Le contenu se
 * remplit avec les fiches habituelles ; il n'entre pas dans l'autonomie du
 * foyer (il est réservé au départ).
 */
import {
  ArrowLeft,
  Backpack,
  ChevronRight,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react-native';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { InventoryError, type Bag, type BagSummary } from '../../inventory';
import {
  Button,
  EmptyState,
  Field,
  IconTile,
  Panel,
  StatusChip,
} from '../components/controls';
import { formatDate } from '../format';
import { useSession } from '../session';
import { colors, radius, space, text } from '../theme';

type Feedback = { message: string; tone: 'ok' | 'error' };

export const BAG_COLOR = colors.purple;

function articles(count: number): string {
  return `${count} article${count > 1 ? 's' : ''}`;
}

/** État d'un sac : périmés d'abord, puis péremptions proches. */
export function bagStatus(
  bag: BagSummary,
): { tone: 'danger' | 'warn'; label: string } | null {
  if (bag.expiredLots > 0) {
    return {
      tone: 'danger',
      label: `${bag.expiredLots} périmé${bag.expiredLots > 1 ? 's' : ''}`,
    };
  }
  if (bag.soonLots > 0) {
    return { tone: 'warn', label: `${bag.soonLots} sous 30 j` };
  }
  return null;
}

/** Formulaire de création ou de modification d'un sac. */
function BagForm(props: {
  initial?: Bag;
  onSubmit: (name: string, owner: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(props.initial?.name ?? '');
  const [owner, setOwner] = useState(props.initial?.owner ?? '');
  const [error, setError] = useState<string | null>(null);
  return (
    <Panel accent={BAG_COLOR} style={styles.form}>
      <Field
        label="Nom du sac"
        value={name}
        onChangeText={setName}
        placeholder="Ex : Sac de Léa, sac voiture"
        maxLength={60}
        error={error}
      />
      <Field
        label="Pour qui (facultatif)"
        value={owner}
        onChangeText={setOwner}
        placeholder="Ex : Léa, toute la famille"
        maxLength={60}
      />
      <View style={styles.row}>
        <Button
          variant="primary"
          label={props.initial ? 'Enregistrer' : 'Créer le sac'}
          onPress={() => {
            props.onSubmit(name, owner).catch((e: unknown) => {
              setError(
                e instanceof InventoryError || e instanceof Error
                  ? e.message
                  : String(e),
              );
            });
          }}
        />
        <Button variant="ghost" label="Annuler" onPress={props.onCancel} />
      </View>
    </Panel>
  );
}

/** Liste des sacs et création d'un nouveau sac. */
export function BagsSection(props: {
  bags: readonly BagSummary[];
  onOpen: (id: string) => void;
  onChanged: (feedback: Feedback) => Promise<void>;
}) {
  const { bags } = useSession();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <Text style={text.muted}>
        Un sac par personne, prêt près de la sortie. Son contenu et ses
        péremptions sont suivis à part : il ne compte pas dans l’autonomie du
        foyer.
      </Text>
      {creating ? (
        <BagForm
          onCancel={() => setCreating(false)}
          onSubmit={async (name, owner) => {
            const bag = await bags.create({ name, owner });
            setCreating(false);
            await props.onChanged({
              message: `Sac « ${bag.name} » créé.`,
              tone: 'ok',
            });
            props.onOpen(bag.id);
          }}
        />
      ) : (
        <Button
          compact
          variant="primary"
          icon={Plus}
          label="Nouveau sac"
          onPress={() => setCreating(true)}
        />
      )}
      {props.bags.length === 0 && !creating ? (
        <EmptyState
          icon={Backpack}
          title="Aucun sac d’évacuation."
          message="Créez un sac, puis ajoutez son contenu avec les fiches habituelles."
        />
      ) : null}
      {props.bags.map(bag => {
        const status = bagStatus(bag);
        return (
          <Pressable
            key={bag.id}
            accessibilityRole="button"
            accessibilityLabel={`Sac ${bag.name} : ${articles(bag.itemCount)}${
              status ? `, ${status.label}` : ''
            }`}
            onPress={() => props.onOpen(bag.id)}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          >
            <IconTile icon={Backpack} color={BAG_COLOR} />
            <View style={styles.grow}>
              <Text style={text.h3}>{bag.name}</Text>
              <Text style={text.muted}>
                {bag.owner ? `${bag.owner} · ` : ''}
                {articles(bag.itemCount)}
              </Text>
              {bag.nextExpiration && !status ? (
                <Text style={text.subtle}>
                  Prochaine péremption : {formatDate(bag.nextExpiration)}
                </Text>
              ) : null}
            </View>
            {status ? (
              <StatusChip tone={status.tone} label={status.label} />
            ) : null}
            <ChevronRight color={colors.text} size={22} />
          </Pressable>
        );
      })}
    </>
  );
}

/** En-tête d'un sac ouvert : retour, nom, modification et suppression. */
export function BagHeader(props: {
  bag: BagSummary;
  onBack: () => void;
  onChanged: (feedback: Feedback) => Promise<void>;
  onDeleted: (feedback: Feedback) => Promise<void>;
}) {
  const { bags } = useSession();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { bag } = props;
  const status = bagStatus(bag);
  return (
    <>
      <View style={styles.back}>
        <Button
          variant="ghost"
          compact
          icon={ArrowLeft}
          label="Tous les sacs"
          onPress={props.onBack}
        />
      </View>
      {editing ? (
        <BagForm
          initial={bag}
          onCancel={() => setEditing(false)}
          onSubmit={async (name, owner) => {
            await bags.update(bag.id, { name, owner, notes: bag.notes });
            setEditing(false);
            await props.onChanged({ message: 'Sac modifié.', tone: 'ok' });
          }}
        />
      ) : (
        <View style={styles.head}>
          <IconTile icon={Backpack} color={BAG_COLOR} />
          <View style={styles.grow}>
            <Text accessibilityRole="header" style={text.h2}>
              {bag.name}
            </Text>
            <Text style={text.muted}>
              {bag.owner ? `${bag.owner} · ` : ''}
              {articles(bag.itemCount)}
            </Text>
          </View>
          {status ? (
            <StatusChip tone={status.tone} label={status.label} />
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Modifier le sac ${bag.name}`}
            onPress={() => setEditing(true)}
            hitSlop={8}
            style={styles.iconButton}
          >
            <Pencil color={colors.text} size={18} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Supprimer le sac ${bag.name}`}
            onPress={() => setConfirming(true)}
            hitSlop={8}
            style={styles.iconButton}
          >
            <Trash2 color={colors.danger} size={18} />
          </Pressable>
        </View>
      )}
      {confirming ? (
        <Panel accent={colors.danger} style={styles.form}>
          <Text style={text.body}>
            Supprimer le sac « {bag.name} » ? Son contenu (
            {articles(bag.itemCount)}) retourne dans le stock général.
          </Text>
          <View style={styles.row}>
            <Button
              variant="danger"
              label="Oui, supprimer"
              onPress={() => {
                void (async () => {
                  await bags.delete(bag.id);
                  await props.onDeleted({
                    message: `Sac « ${bag.name} » supprimé.`,
                    tone: 'ok',
                  });
                })();
              }}
            />
            <Button
              variant="ghost"
              label="Annuler"
              onPress={() => setConfirming(false)}
            />
          </View>
        </Panel>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.m },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.82 },
  back: { alignItems: 'flex-start' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    padding: space.l,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
