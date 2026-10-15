/**
 * Photos d'une arme ou d'un document : vignettes, affichage en grand,
 * suppression confirmée, ajout depuis l'appareil photo ou la galerie.
 */
import { Camera, ImagePlus, Trash2, X } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  PHOTOS_PER_OWNER_MAX,
  type Photo,
  type PhotoOwner,
} from '../../inventory';
import { useSession } from '../session';
import { colors, radius, space, text } from '../theme';
import { useLoader } from '../useLoader';
import { Button, Notice } from './controls';

function uri(photo: Photo): string {
  return `data:${photo.mime};base64,${photo.base64}`;
}

export function PhotoStrip(props: {
  owner: PhotoOwner;
  ownerId: string;
  /** Nom de l'arme ou du document, pour les libellés d'accessibilité. */
  label: string;
}) {
  const { photos, photoSource } = useSession();
  const [open, setOpen] = useState<Photo | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, reload } = useLoader(
    () => photos.list(props.owner, props.ownerId),
    [props.owner, props.ownerId],
  );
  const list = data ?? [];
  const full = list.length >= PHOTOS_PER_OWNER_MAX;

  const add = async (from: 'take' | 'pick') => {
    setError(null);
    setBusy(true);
    try {
      const base64 = await photoSource[from]();
      if (base64 !== null) {
        await photos.add(props.owner, props.ownerId, base64);
        await reload();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (photo: Photo) => {
    await photos.remove(photo.id);
    setConfirmDelete(false);
    setOpen(null);
    await reload();
  };

  return (
    <View style={styles.wrap}>
      <Text style={text.label}>
        Photos{list.length > 0 ? ` (${list.length})` : ''}
      </Text>
      {list.length > 0 ? (
        <ScrollView horizontal contentContainerStyle={styles.thumbs}>
          {list.map((photo, i) => (
            <Pressable
              key={photo.id}
              accessibilityRole="imagebutton"
              accessibilityLabel={`Photo ${i + 1} de ${props.label}`}
              onPress={() => {
                setConfirmDelete(false);
                setOpen(photo);
              }}
            >
              <Image source={{ uri: uri(photo) }} style={styles.thumb} />
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <Text style={text.subtle}>
          {photoSource.available
            ? 'Aucune photo. Photographiez par exemple le numéro de série.'
            : 'Aucune photo.'}
        </Text>
      )}
      {error ? <Notice tone="error" message={error} /> : null}
      {photoSource.available ? (
        <View style={styles.row}>
          <Button
            compact
            icon={Camera}
            label="Photographier"
            disabled={busy || full}
            onPress={() => {
              void add('take');
            }}
          />
          <Button
            compact
            variant="ghost"
            icon={ImagePlus}
            label="Galerie"
            accessibilityLabel="Choisir une image dans la galerie"
            disabled={busy || full}
            onPress={() => {
              void add('pick');
            }}
          />
        </View>
      ) : null}
      {full ? (
        <Text style={text.subtle}>
          {PHOTOS_PER_OWNER_MAX} photos au maximum.
        </Text>
      ) : null}

      <Modal
        visible={open !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(null)}
      >
        <View style={styles.viewer}>
          {open ? (
            <Image
              source={{ uri: uri(open) }}
              style={styles.full}
              resizeMode="contain"
              accessibilityLabel={`Photo de ${props.label}`}
            />
          ) : null}
          {confirmDelete && open ? (
            <View style={styles.confirm}>
              <Text style={text.body}>Supprimer cette photo ?</Text>
              <View style={styles.row}>
                <Button
                  variant="danger"
                  label="Supprimer"
                  onPress={() => {
                    void remove(open);
                  }}
                />
                <Button
                  variant="ghost"
                  label="Annuler"
                  onPress={() => setConfirmDelete(false)}
                />
              </View>
            </View>
          ) : (
            <View style={styles.row}>
              <Button
                variant="danger"
                icon={Trash2}
                label="Supprimer la photo"
                onPress={() => setConfirmDelete(true)}
              />
              <Button icon={X} label="Fermer" onPress={() => setOpen(null)} />
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.s },
  thumbs: { gap: space.s },
  thumb: {
    width: 88,
    height: 88,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  row: { flexDirection: 'row', gap: space.s, flexWrap: 'wrap' },
  viewer: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: space.l,
    gap: space.l,
    justifyContent: 'center',
  },
  full: { flex: 1, width: '100%' },
  confirm: {
    gap: space.m,
    padding: space.l,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.bgElevated,
  },
});
