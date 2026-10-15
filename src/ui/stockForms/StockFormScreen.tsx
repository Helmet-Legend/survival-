/**
 * Fiche « Ajouter un stock » (pack « fiches ») : un seul écran, configuré
 * par catégorie (`config.ts`), traduit en données par `mapping.ts`,
 * enregistré par les dépôts existants. Les valeurs saisies sont conservées
 * en cas d'erreur ; chaque erreur s'affiche sous son champ.
 */
import {
  ArrowLeft,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Trash2,
} from 'lucide-react-native';
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
import { APP_NAME } from '../brand';
import { IconButton, Notice } from '../components/controls';
import { PhotoStrip } from '../components/PhotoStrip';
import { CATEGORY_TITLES } from '../format';
import { useNavigation, type StockFormTarget } from '../navigation';
import { useSession } from '../session';
import { colors, fonts, radius, sizes, space, text, tint } from '../theme';
import { useLoader } from '../useLoader';
import {
  COMMON_CALIBERS,
  ESSENTIAL,
  fieldId,
  FORMS,
  QUICK_PICKS,
  type Field,
  type Values,
} from './config';
import {
  ChoiceRow,
  DateRow,
  MeasureRow,
  Suggestions,
  TextRow,
} from './FormRows';
import {
  CATEGORY_ILLUSTRATIONS,
  ILLUSTRATION_FADE_SIDE,
} from './illustrations';
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
  const visible = config.fields
    .filter(f => !f.visible || f.visible(values))
    .filter(f => !(isEdit && f.type === 'date' && f.key === 'expiry'));
  const essential = new Set(ESSENTIAL[category]);
  const isEssential = (f: Field) =>
    essential.has(fieldId(f)) || (f.type === 'text' && f.required === true);
  const main = visible.filter(isEssential);
  const details = visible.filter(f => !isEssential(f));
  const detailKeys = new Set(
    details.flatMap(f =>
      f.type === 'quantity'
        ? ['quantity', 'unit']
        : f.type === 'threshold'
        ? ['minStock']
        : f.type === 'measure'
        ? [f.key, f.unitKey]
        : [f.key],
    ),
  );
  const [showDetails, setShowDetails] = useState(
    () =>
      isEdit &&
      [...detailKeys].some(k => k !== 'unit' && (values[k] ?? '') !== ''),
  );
  const filledDetails = [...detailKeys].filter(
    k => k !== 'unit' && k !== 'energyBasis' && (values[k] ?? '') !== '',
  ).length;
  const picks = isEdit ? [] : QUICK_PICKS[category];

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
        setShowDetails(open => open || detailKeys.has(e.field));
      } else if (e instanceof InventoryError && e.field) {
        const field = formFieldFor(e.field);
        setErrors({ [field]: e.message });
        setShowDetails(open => open || detailKeys.has(field));
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
        if (field.key === 'caliber') {
          return (
            <View key={key} style={styles.withSuggestions}>
              <TextRow
                icon={field.icon}
                color={color}
                label={field.required ? `${field.label} *` : field.label}
                value={values.caliber ?? ''}
                onChange={set('caliber')}
                placeholder={field.placeholder}
                maxLength={field.maxLength}
                error={errors.caliber}
              />
              <Suggestions
                label="Calibres courants"
                color={color}
                items={COMMON_CALIBERS}
                current={values.caliber}
                onPick={i => set('caliber')(COMMON_CALIBERS[i])}
              />
            </View>
          );
        }
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
          <ChoiceRow
            key={key}
            icon={field.icon}
            color={color}
            label={field.label}
            value={values[field.key] ?? ''}
            options={field.options}
            onChange={set(field.key)}
            error={errors[field.key]}
          />
        );
      case 'date':
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
              unitOnly
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
            stepper
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

  const photoButton =
    photoOwner !== null && photoOwnerId ? (
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
        style={({ pressed }) => [styles.photo, pressed && styles.pressed]}
      >
        <Camera color={color} size={20} />
        <Text style={[text.body, styles.grow]}>
          Ajouter une photo <Text style={text.subtle}>(optionnel)</Text>
        </Text>
        {pendingPhotos.map((photo, i) => (
          <Pressable
            key={i}
            accessibilityRole="button"
            accessibilityLabel={`Retirer la photo ${i + 1}`}
            onPress={() => setPendingPhotos(p => p.filter((_, j) => j !== i))}
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
      </Pressable>
    ) : null;

  return (
    <View style={styles.screen}>
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

        <View style={[styles.hero, { borderColor: tint(color, '55') }]}>
          <Image
            source={CATEGORY_ILLUSTRATIONS[category]}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
            style={styles.heroImage}
          />
          <SvgXml
            xml={ILLUSTRATION_FADE_SIDE}
            width="100%"
            height="100%"
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              styles.badge,
              { borderColor: color, backgroundColor: tint(colors.bg, 'd9') },
            ]}
          >
            <Icon color={color} size={26} strokeWidth={2.2} />
          </View>
          <View style={styles.grow}>
            <Text accessibilityRole="header" style={styles.title}>
              {isEdit ? config.editTitle : config.title}
            </Text>
            {isEdit ? (
              <Text style={styles.subtitle}>{CATEGORY_TITLES[category]}</Text>
            ) : null}
          </View>
        </View>

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
                    style={[
                      styles.segmentText,
                      selected && styles.segmentTextOn,
                    ]}
                  >
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {picks.length > 0 ? (
          <View style={styles.quick}>
            <Text style={styles.quickTitle}>Saisie rapide</Text>
            <Suggestions
              label="Saisie rapide"
              color={color}
              items={picks.map(p => p.label)}
              current={values.name}
              onPick={i => {
                setValues(v => ({ ...v, ...picks[i].values }));
                setErrors({});
              }}
            />
          </View>
        ) : null}

        <View style={styles.fields}>{main.map(renderField)}</View>

        {details.length > 0 ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showDetails }}
              accessibilityLabel={
                showDetails ? 'Masquer les détails' : 'Plus de détails'
              }
              onPress={() => setShowDetails(open => !open)}
              style={({ pressed }) => [styles.more, pressed && styles.pressed]}
            >
              <View style={styles.grow}>
                <Text style={styles.moreText}>
                  {showDetails ? 'Masquer les détails' : 'Plus de détails'}
                </Text>
                <Text style={text.subtle}>
                  {filledDetails > 0
                    ? `${filledDetails} renseigné${
                        filledDetails > 1 ? 's' : ''
                      } sur ${details.length} · facultatif`
                    : `${details.length} champs facultatifs : ${details
                        .slice(0, 3)
                        .map(f => (f.type === 'threshold' ? 'seuil' : f.label))
                        .join(', ')
                        .toLowerCase()}…`}
                </Text>
              </View>
              {showDetails ? (
                <ChevronUp color={colors.textMuted} size={22} />
              ) : (
                <ChevronDown color={colors.textMuted} size={22} />
              )}
            </Pressable>
            {showDetails ? (
              <View style={styles.fields}>{details.map(renderField)}</View>
            ) : null}
          </>
        ) : null}

        {photoButton}

        {isEdit ? (
          <Text style={text.subtle}>
            Les quantités et les dates de péremption se gèrent par lots, sur la
            fiche de l’article (ajout et retrait).
          </Text>
        ) : null}

        {Object.values(errors).some(Boolean) ? (
          <Notice
            tone="error"
            message="Vérifiez les champs signalés en rouge : rien n’a été enregistré."
          />
        ) : null}
        {formError ? <Notice tone="error" message={formError} /> : null}
      </ScrollView>

      <View style={styles.footer}>
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: {
    paddingHorizontal: 16,
    paddingBottom: space.xl,
    gap: 14,
  },
  grow: { flex: 1, minWidth: 0 },
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
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 2,
  },
  brandBar: { width: 28, height: 3, borderRadius: 2 },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: 84,
    padding: space.l,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  heroImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: '70%',
    height: '100%',
  },
  badge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 21,
    fontWeight: '800',
  },
  subtitle: { color: colors.textMuted, fontSize: 14, lineHeight: 19 },
  quick: { gap: space.s },
  quickTitle: { color: colors.textMuted, fontSize: 13 },
  withSuggestions: { gap: space.s },
  more: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: 56,
    paddingHorizontal: space.l,
    paddingVertical: space.s,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  moreText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  photo: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.m,
    minHeight: 54,
    paddingHorizontal: space.l,
    paddingVertical: space.s,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  thumb: { width: 44, height: 44, borderRadius: radius.s },
  thumbRemove: {
    position: 'absolute',
    right: 2,
    top: 2,
    borderRadius: 8,
    padding: 2,
    backgroundColor: colors.dangerSurface,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: space.s,
    paddingBottom: space.s,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
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
  },
  saveText: { fontSize: 17, fontWeight: '700' },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
});
