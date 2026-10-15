/**
 * Fiche « Ajouter un stock » (pack « fiches ») : un seul écran, configuré
 * par catégorie (`config.ts`), traduit en données par `mapping.ts`,
 * enregistré par les dépôts existants. Les valeurs saisies sont conservées
 * en cas d'erreur ; chaque erreur s'affiche sous son champ.
 */
import { ArrowLeft, Camera, Check, Trash2 } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SvgXml } from 'react-native-svg';

import {
  InventoryError,
  type InventoryItem,
  type Weapon,
} from '../../inventory';
import { TOPOGRAPHIC_SVG } from '../assets/backgrounds';
import { APP_NAME } from '../brand';
import { Backdrop, IconButton, Notice } from '../components/controls';
import { PhotoStrip } from '../components/PhotoStrip';
import { CATEGORY_TITLES } from '../format';
import { useNavigation, type StockFormTarget } from '../navigation';
import { useSession } from '../session';
import { colors, fonts, radius, sizes, space, text, tint } from '../theme';
import { useLoader } from '../useLoader';
import { FORMS, type Field, type Values } from './config';
import { DateRow, MeasureRow, SelectRow, TextRow } from './FormRows';
import { categoryIllustration } from './illustrations';
import {
  FormError,
  formFieldFor,
  initialValues,
  toItemDraft,
  toWeaponInput,
  valuesFromItem,
  valuesFromWeapon,
} from './mapping';

const RECORD_TYPES = [
  { value: 'weapon', label: 'Arme' },
  { value: 'ammo', label: 'Munition' },
  { value: 'accessory', label: 'Accessoire' },
] as const;

export function StockFormScreen({ target }: { target: StockFormTarget }) {
  const { repo, armory } = useSession();
  const { data, error } = useLoader(async () => {
    if (target.itemId) {
      return { item: (await repo.getItem(target.itemId)).item };
    }
    if (target.weaponId) {
      const weapon = (await armory.listWeapons()).find(
        w => w.id === target.weaponId,
      );
      if (!weapon) {
        throw new Error('Arme introuvable');
      }
      return { weapon };
    }
    return {};
  }, [target.itemId, target.weaponId]);

  if (error) {
    return (
      <View style={styles.page}>
        <Notice tone="error" message={error} />
      </View>
    );
  }
  if (data === null) {
    return null;
  }
  return (
    <StockForm
      target={target}
      item={'item' in data ? data.item : undefined}
      weapon={'weapon' in data ? data.weapon : undefined}
    />
  );
}

function StockForm(props: {
  target: StockFormTarget;
  item?: InventoryItem;
  weapon?: Weapon;
}) {
  const { repo, armory, photos, photoSource } = useSession();
  const navigation = useNavigation();
  const { category } = props.target;
  const config = FORMS[category];
  const isEdit = props.item !== undefined || props.weapon !== undefined;
  const [values, setValues] = useState<Values>(() =>
    props.item
      ? valuesFromItem(props.item)
      : props.weapon
      ? valuesFromWeapon(props.weapon)
      : initialValues(category, props.target.recordType),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingPhotos, setPendingPhotos] = useState<string[]>([]);
  const color = config.color;
  const Icon = config.icon;

  const set = (key: string) => (value: string) => {
    setValues(v => ({ ...v, [key]: value }));
    if (errors[key]) {
      setErrors(e => ({ ...e, [key]: '' }));
    }
  };
  const unitLabel =
    config.units.find(x => x.value === values.unit)?.label ?? '';
  const visible = config.fields.filter(f => !f.visible || f.visible(values));

  const takePhoto = async () => {
    try {
      const base64 = await photoSource.take();
      if (base64 !== null) {
        setPendingPhotos(p => [...p, base64]);
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    }
  };

  const save = async () => {
    setErrors({});
    setFormError(null);
    setSaving(true);
    try {
      let name: string;
      if (category === 'weapon' && values.recordType === 'weapon') {
        const input = toWeaponInput(values);
        const weapon = props.weapon
          ? await armory.updateWeapon(props.weapon.id, input)
          : await armory.createWeapon(input);
        for (const photo of pendingPhotos) {
          await photos.add('weapon', weapon.id, photo);
        }
        name = weapon.model;
      } else {
        const draft = toItemDraft(category, values, isEdit);
        const item = props.item
          ? await repo.updateItem(props.item.id, draft.input)
          : await repo.createItem(draft.input, draft.lot ?? undefined);
        for (const photo of pendingPhotos) {
          await photos.add('item', item.id, photo);
        }
        name = item.name;
      }
      navigation.goTo('stock', {
        category,
        message: `« ${name} » ${isEdit ? 'modifié' : 'enregistré'}.`,
      });
    } catch (e) {
      setSaving(false);
      if (e instanceof FormError) {
        setErrors({ [e.field]: e.message });
      } else if (e instanceof InventoryError && e.field) {
        setErrors({ [formFieldFor(e.field)]: e.message });
      } else {
        setFormError(
          `Enregistrement impossible : ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
  };

  const renderField = (field: Field, index: number) => {
    const key = `${field.type}-${index}`;
    switch (field.type) {
      case 'text':
        return (
          <TextRow
            key={key}
            icon={field.icon}
            color={color}
            label={field.required ? `${field.label} *` : field.label}
            value={values[field.key] ?? ''}
            onChange={set(field.key)}
            placeholder={field.placeholder}
            multiline={field.multiline}
            maxLength={field.maxLength}
            error={errors[field.key]}
          />
        );
      case 'number':
        return (
          <TextRow
            key={key}
            icon={field.icon}
            color={color}
            label={field.label}
            value={values[field.key] ?? ''}
            onChange={set(field.key)}
            placeholder={field.placeholder}
            keyboardType="number-pad"
            suffix={field.suffix}
            error={errors[field.key]}
          />
        );
      case 'select':
        return (
          <SelectRow
            key={key}
            icon={field.icon}
            color={color}
            label={field.label}
            value={values[field.key] ?? ''}
            options={field.options}
            onChange={set(field.key)}
            placeholder={field.placeholder}
            error={errors[field.key]}
          />
        );
      case 'date':
        if (isEdit && field.key === 'expiry') {
          return null; // la date appartient aux lots : gérée sur la fiche
        }
        return (
          <DateRow
            key={key}
            icon={field.icon}
            color={color}
            label={field.label}
            value={values[field.key] ?? ''}
            onChange={set(field.key)}
            error={errors[field.key]}
          />
        );
      case 'measure':
        return (
          <MeasureRow
            key={key}
            icon={field.icon}
            color={color}
            label={field.label}
            value={values[field.key] ?? ''}
            onChange={set(field.key)}
            unit={values[field.unitKey] || field.units[0].value}
            units={field.units}
            onUnit={set(field.unitKey)}
            placeholder={field.placeholder}
            error={errors[field.key] || errors[field.unitKey]}
          />
        );
      case 'quantity':
        if (isEdit) {
          return (
            <MeasureRow
              key={key}
              icon={field.icon}
              color={color}
              label="Unité"
              value=""
              onChange={() => undefined}
              unit={values.unit}
              units={config.units}
              onUnit={set('unit')}
              placeholder="Quantité gérée sur la fiche"
              error={errors.unit}
            />
          );
        }
        return (
          <MeasureRow
            key={key}
            icon={field.icon}
            color={color}
            label={`${field.label} *`}
            value={values.quantity ?? ''}
            onChange={set('quantity')}
            unit={values.unit}
            units={config.units}
            onUnit={set('unit')}
            error={errors.quantity || errors.unit}
          />
        );
      case 'threshold':
        return (
          <TextRow
            key={key}
            icon={field.icon}
            color={color}
            label={field.label}
            value={values.minStock ?? ''}
            onChange={set('minStock')}
            placeholder="Aucun"
            keyboardType="decimal-pad"
            suffix={unitLabel}
            error={errors.minStock}
          />
        );
    }
  };

  const recordType = values.recordType;
  const photoOwner =
    props.weapon !== undefined ? 'weapon' : props.item ? 'item' : null;
  const photoOwnerId = props.weapon?.id ?? props.item?.id;

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <IconButton
          icon={ArrowLeft}
          label="Retour"
          onPress={() => navigation.goTo('stock', { category })}
        />
        <View style={styles.headerTitle}>
          <Text style={styles.brand}>{APP_NAME.toUpperCase()}</Text>
          <View
            style={[styles.brandBar, { backgroundColor: colors.primary }]}
          />
          <Text style={text.muted}>
            {isEdit ? 'Modifier un stock' : 'Ajouter un stock'}
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <View style={[styles.hero, { borderColor: tint(color, '40') }]}>
        <Backdrop svg={TOPOGRAPHIC_SVG} opacity={0.3} />
        <View pointerEvents="none" style={styles.illustration}>
          <SvgXml
            xml={categoryIllustration(category, color)}
            width="100%"
            height="100%"
          />
        </View>
        <View
          style={[
            styles.badge,
            { borderColor: color, backgroundColor: tint(color, '1f') },
          ]}
        >
          <Icon color={color} size={34} strokeWidth={2.2} />
        </View>
        <Text accessibilityRole="header" style={styles.title}>
          {isEdit ? config.editTitle : config.title}
        </Text>
        <Text style={styles.subtitle}>
          {isEdit ? CATEGORY_TITLES[category] : config.subtitle}
        </Text>
      </View>

      {photoOwner !== null && photoOwnerId ? (
        <PhotoStrip
          owner={photoOwner}
          ownerId={photoOwnerId}
          label={values.name ?? ''}
        />
      ) : photoSource.available ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ajouter une photo (optionnel)"
          onPress={() => {
            void takePhoto();
          }}
          style={({ pressed }) => [
            styles.photo,
            { borderColor: color },
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.photoIcon}>
            <Camera color={colors.text} size={22} />
          </View>
          <Text style={text.body}>
            Ajouter une photo{'\n'}
            <Text style={text.subtle}>(optionnel)</Text>
          </Text>
          {pendingPhotos.length > 0 ? (
            <View style={styles.pending}>
              {pendingPhotos.map((photo, i) => (
                <Pressable
                  key={i}
                  accessibilityRole="button"
                  accessibilityLabel={`Retirer la photo ${i + 1}`}
                  onPress={() =>
                    setPendingPhotos(p => p.filter((_, j) => j !== i))
                  }
                >
                  <Image
                    source={{ uri: `data:image/jpeg;base64,${photo}` }}
                    style={styles.thumb}
                  />
                  <View style={styles.thumbRemove}>
                    <Trash2 color={colors.text} size={12} />
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}
        </Pressable>
      ) : null}

      {category === 'weapon' && !isEdit ? (
        <View style={styles.segments} accessibilityRole="tablist">
          {RECORD_TYPES.map(t => {
            const selected = recordType === t.value;
            return (
              <Pressable
                key={t.value}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => {
                  setValues(v => ({ ...v, recordType: t.value }));
                  setErrors({});
                }}
                style={[
                  styles.segment,
                  selected && { backgroundColor: color, borderColor: color },
                ]}
              >
                <Text
                  style={[styles.segmentText, selected && styles.segmentTextOn]}
                >
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={styles.fields}>{visible.map(renderField)}</View>
      {isEdit ? (
        <Text style={text.subtle}>
          Les quantités et les dates de péremption se gèrent par lots, sur la
          fiche de l’article (ajout et retrait).
        </Text>
      ) : null}
      <Text style={text.subtle}>* champ obligatoire</Text>

      {Object.keys(errors).length > 0 ? (
        <Notice
          tone="error"
          message="Vérifiez les champs signalés en rouge : rien n’a été enregistré."
        />
      ) : null}
      {formError ? <Notice tone="error" message={formError} /> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Enregistrer le stock"
        accessibilityState={{ disabled: saving, busy: saving }}
        disabled={saving}
        onPress={() => {
          void save();
        }}
        style={({ pressed }) => [
          styles.save,
          { borderColor: color, backgroundColor: tint(color, '26') },
          pressed && styles.pressed,
          saving && styles.disabled,
        ]}
      >
        <Check color={color} size={22} strokeWidth={2.6} />
        <Text style={[styles.saveText, { color }]}>
          {saving ? 'Enregistrement…' : 'Enregistrer le stock'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

/** Hauteur de l'illustration d'en-tête (le badge chevauche son bas). */
const ILLUSTRATION_HEIGHT = 150;

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: 16,
    paddingBottom: space.xxl,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { alignItems: 'center', gap: 2 },
  headerSpacer: { width: sizes.touch },
  brand: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 2,
  },
  brandBar: { width: 28, height: 3, borderRadius: 2 },
  hero: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    padding: space.l,
    paddingTop: ILLUSTRATION_HEIGHT - 52,
    gap: space.s,
    backgroundColor: colors.surface,
  },
  illustration: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: ILLUSTRATION_HEIGHT,
  },
  badge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  title: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 26,
    fontWeight: '800',
  },
  subtitle: { color: colors.textMuted, fontSize: 15, lineHeight: 21 },
  photo: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.l,
    minHeight: 64,
    padding: space.m,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  photoIcon: {
    width: 48,
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pending: { flexDirection: 'row', gap: space.s, flexWrap: 'wrap' },
  thumb: { width: 56, height: 56, borderRadius: radius.s },
  thumbRemove: {
    position: 'absolute',
    right: 2,
    top: 2,
    borderRadius: 8,
    padding: 2,
    backgroundColor: colors.dangerSurface,
  },
  segments: { flexDirection: 'row', gap: space.s },
  segment: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  segmentTextOn: { color: colors.text, fontWeight: '700' },
  segmentText: { color: colors.textMuted, fontSize: 15 },
  fields: { gap: 10 },
  save: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.s,
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    marginTop: space.s,
  },
  saveText: { fontSize: 17, fontWeight: '700' },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
});
