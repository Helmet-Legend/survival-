/**
 * Mes fiches : liste, saisie (titre, famille, photos, PDF, texte) et
 * lecture des fiches écrites par l'utilisateur. Tout reste dans le coffre
 * chiffré ; les PDF sont convertis en images sur le téléphone.
 */
import {
  AlertTriangle,
  Camera,
  ChevronLeft,
  ChevronRight,
  FileText,
  ImagePlus,
  type LucideIcon,
  Pencil,
  Plus,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { GUIDE_FOLDERS } from '../../../content/fiches/fiche';
import {
  isRiskyFamily,
  USER_FICHE_PDF_PAGES_MAX,
  USER_FICHE_PDFS_MAX,
  USER_FICHE_PHOTOS_MAX,
  UserFicheRepository,
  type UserFiche,
  type UserFicheSummary,
} from '../../../db/userFiches';
import { InventoryError } from '../../../inventory/inventoryRepository';
import { isoToFr } from '../../../lib/dates';
import {
  Button,
  Chip,
  EmptyState,
  Field,
  Notice,
  Panel,
  ScreenTitle,
} from '../../components/controls';
import { useSession } from '../../session';
import { colors, radius, sizes, space, text } from '../../theme';
import { useLoader } from '../../useLoader';

export type FamilyStyle = (family: string) => [LucideIcon, string];

const jpeg = (base64: string) => ({ uri: `data:image/jpeg;base64,${base64}` });

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useUserFiches(): UserFicheRepository {
  const { db } = useSession();
  return useMemo(() => new UserFicheRepository(db), [db]);
}

/** « 2 photos · 1 PDF » */
export function ficheContents(f: UserFicheSummary): string {
  const parts: string[] = [];
  if (f.photoCount > 0) {
    parts.push(`${f.photoCount} photo${f.photoCount > 1 ? 's' : ''}`);
  }
  if (f.pdfCount > 0) {
    parts.push(`${f.pdfCount} PDF`);
  }
  return parts.join(' · ');
}

/** Ligne d'une fiche perso dans une liste (vignette, famille, contenu). */
export function UserFicheRow(props: {
  fiche: UserFicheSummary;
  thumb?: string;
  styleOf: FamilyStyle;
  onPress: () => void;
}) {
  const { fiche } = props;
  const [Icon, color] = fiche.family
    ? props.styleOf(fiche.family)
    : [FileText, colors.textMuted];
  const contents = ficheContents(fiche);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Fiche perso : ${fiche.title}`}
      onPress={props.onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {props.thumb ? (
        <Image source={jpeg(props.thumb)} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]}>
          <Icon color={color} size={22} />
        </View>
      )}
      <View style={styles.grow}>
        <Text style={[text.label, { color }]}>
          {fiche.family ?? 'Sans famille'} · PERSO
        </Text>
        <Text style={styles.title} numberOfLines={2}>
          {fiche.title}
        </Text>
        {contents ? <Text style={text.subtle}>{contents}</Text> : null}
      </View>
      <ChevronRight color={colors.textMuted} size={20} />
    </Pressable>
  );
}

export function UserFicheList(props: {
  styleOf: FamilyStyle;
  onBack: () => void;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const fiches = useUserFiches();
  const { data, error } = useLoader(
    async () => ({
      list: await fiches.list(),
      thumbs: await fiches.thumbnails(),
    }),
    [fiches],
  );
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScreenTitle
        title="Mes fiches"
        onBack={props.onBack}
        backLabel="Retour aux fiches"
      />
      <Text style={text.muted}>
        Tout ce qui vous est propre : lieux, consignes de la mairie, contacts,
        astuces, plantes de votre région, documents en PDF. Chiffrées dans le
        coffre, sur ce téléphone.
      </Text>
      {error ? <Notice tone="error" message={error} /> : null}
      {data?.list.map(f => (
        <UserFicheRow
          key={f.id}
          fiche={f}
          thumb={data.thumbs.get(f.id)}
          styleOf={props.styleOf}
          onPress={() => props.onOpen(f.id)}
        />
      ))}
      {data?.list.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Aucune fiche pour l’instant"
          message="Créez votre première fiche : un texte, des photos, un PDF."
        />
      ) : null}
      <Button
        variant="primary"
        icon={Plus}
        label="Nouvelle fiche"
        onPress={props.onCreate}
      />
    </ScrollView>
  );
}

interface DraftPdf {
  /** Déjà enregistré (id) ou à enregistrer. */
  pdfId?: string;
  name: string;
  pageCount: number;
  pages?: string[];
  /** Pages ignorées au-delà de la limite. */
  skipped?: number;
}

export function UserFicheEditor(props: {
  fiche: UserFiche | null;
  styleOf: FamilyStyle;
  onCancel: () => void;
  onSaved: (id: string) => void;
}) {
  const { photoSource } = useSession();
  const fiches = useUserFiches();
  const initial = props.fiche;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [family, setFamily] = useState<string | null>(initial?.family ?? null);
  const [body, setBody] = useState(initial?.body ?? '');
  const [photos, setPhotos] = useState<Array<{ id?: string; base64: string }>>(
    initial?.photos ?? [],
  );
  const [pdfs, setPdfs] = useState<DraftPdf[]>(initial?.pdfs ?? []);
  const [removedPhotos, setRemovedPhotos] = useState<string[]>([]);
  const [removedPdfs, setRemovedPdfs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const addPhoto = async (how: 'take' | 'pick') => {
    setErrors({});
    try {
      const base64 = await (how === 'take'
        ? photoSource.take()
        : photoSource.pick());
      if (base64 !== null) {
        setPhotos(p => [...p, { base64 }]);
      }
    } catch (e) {
      setErrors({ photo: message(e) });
    }
  };

  const addPdf = async () => {
    if (photoSource.pickPdf === undefined) {
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const pdf = await photoSource.pickPdf(USER_FICHE_PDF_PAGES_MAX);
      if (pdf !== null) {
        if (pdf.pages.length === 0) {
          setErrors({ pdf: 'Aucune page lisible dans ce PDF.' });
        } else {
          setPdfs(p => [
            ...p,
            {
              name: pdf.name,
              pageCount: pdf.pages.length,
              pages: pdf.pages,
              skipped: Math.max(0, pdf.pageCount - pdf.pages.length),
            },
          ]);
        }
      }
    } catch (e) {
      setErrors({ pdf: message(e) });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setErrors({});
    setBusy(true);
    try {
      const input = { title, family, body };
      let id: string;
      if (initial) {
        id = initial.id;
        await fiches.update(id, input);
      } else {
        id = await fiches.create(input);
      }
      for (const photoId of removedPhotos) {
        await fiches.removePhoto(id, photoId);
      }
      for (const pdfId of removedPdfs) {
        await fiches.removePdf(id, pdfId);
      }
      for (const photo of photos) {
        if (photo.id === undefined) {
          await fiches.addPhoto(id, photo.base64);
        }
      }
      for (const pdf of pdfs) {
        if (pdf.pdfId === undefined && pdf.pages) {
          await fiches.addPdf(id, pdf.name, pdf.pages);
        }
      }
      props.onSaved(id);
    } catch (e) {
      if (e instanceof InventoryError && e.field) {
        setErrors({ [e.field]: e.message });
      } else {
        setErrors({ form: message(e) });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenTitle
        title={initial ? 'Modifier la fiche' : 'Nouvelle fiche'}
        onBack={props.onCancel}
        backLabel="Annuler"
      />
      <Field
        label="Titre"
        value={title}
        onChangeText={setTitle}
        placeholder="Ex. : Point d’eau du hameau, consignes de la mairie…"
        maxLength={120}
        error={errors.title}
      />

      <Text style={styles.fieldLabel}>Ranger dans (facultatif)</Text>
      <View style={styles.wrap}>
        <Chip
          label="Sans famille"
          selected={family === null}
          onPress={() => setFamily(null)}
        />
        {GUIDE_FOLDERS.map(f => (
          <Chip
            key={f}
            label={f}
            selected={family === f}
            onPress={() => setFamily(f)}
          />
        ))}
      </View>
      <Text style={text.subtle}>
        La fiche apparaît aussi dans sa famille, marquée « perso ».
      </Text>
      {isRiskyFamily(family) ? (
        <Text style={styles.warn}>
          {family} : la fiche affichera un avertissement renforcé (non vérifiée,
          ne rien consommer ni soigner sans certitude).
        </Text>
      ) : null}

      <Text style={styles.fieldLabel}>
        Photos ({photos.length} / {USER_FICHE_PHOTOS_MAX})
      </Text>
      {photos.length > 0 ? (
        <View style={styles.wrap}>
          {photos.map((photo, i) => (
            <Pressable
              key={photo.id ?? `new-${i}`}
              accessibilityRole="button"
              accessibilityLabel={`Retirer la photo ${i + 1}`}
              onPress={() => {
                if (photo.id) {
                  setRemovedPhotos(r => [...r, photo.id as string]);
                }
                setPhotos(p => p.filter((_, j) => j !== i));
              }}
            >
              <Image source={jpeg(photo.base64)} style={styles.photoThumb} />
              <View style={styles.remove}>
                <X color={colors.text} size={14} />
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
      {errors.photo ? <Text style={styles.error}>{errors.photo}</Text> : null}
      {photoSource.available ? (
        <View style={styles.buttons}>
          <Button
            compact
            icon={Camera}
            label="Photographier"
            disabled={busy || photos.length >= USER_FICHE_PHOTOS_MAX}
            onPress={() => {
              void addPhoto('take');
            }}
            style={styles.grow}
          />
          <Button
            compact
            variant="ghost"
            icon={ImagePlus}
            label="Galerie"
            accessibilityLabel="Choisir une image dans la galerie"
            disabled={busy || photos.length >= USER_FICHE_PHOTOS_MAX}
            onPress={() => {
              void addPhoto('pick');
            }}
            style={styles.grow}
          />
        </View>
      ) : (
        <Text style={text.subtle}>
          Appareil photo indisponible sur cet appareil.
        </Text>
      )}

      <Text style={styles.fieldLabel}>
        PDF joints ({pdfs.length} / {USER_FICHE_PDFS_MAX})
      </Text>
      {pdfs.map((pdf, i) => (
        <View key={pdf.pdfId ?? `new-${i}`} style={styles.pdfRow}>
          <View style={styles.pdfBadge}>
            <Text style={styles.pdfBadgeText}>PDF</Text>
          </View>
          <View style={styles.grow}>
            <Text style={styles.pdfName} numberOfLines={1}>
              {pdf.name}
            </Text>
            <Text style={text.subtle}>
              {pdf.pageCount} page{pdf.pageCount > 1 ? 's' : ''}
              {pdf.pages ? ' convertie' + (pdf.pageCount > 1 ? 's' : '') : ''}
              {pdf.skipped
                ? ` · ${pdf.skipped} page${
                    pdf.skipped > 1 ? 's' : ''
                  } au-delà de ${USER_FICHE_PDF_PAGES_MAX} non importée${
                    pdf.skipped > 1 ? 's' : ''
                  }`
                : ''}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Retirer ${pdf.name}`}
            onPress={() => {
              if (pdf.pdfId) {
                setRemovedPdfs(r => [...r, pdf.pdfId as string]);
              }
              setPdfs(p => p.filter((_, j) => j !== i));
            }}
            style={styles.pdfRemove}
          >
            <X color={colors.text} size={18} />
          </Pressable>
        </View>
      ))}
      {errors.pdf ? <Text style={styles.error}>{errors.pdf}</Text> : null}
      {photoSource.pickPdf ? (
        <>
          <Button
            icon={FileText}
            label={
              busy ? 'Conversion des pages…' : 'Joindre un PDF du téléphone'
            }
            disabled={busy || pdfs.length >= USER_FICHE_PDFS_MAX}
            onPress={() => {
              void addPdf();
            }}
          />
          <Text style={text.subtle}>
            Chaque page est convertie en image sur le téléphone, sans internet,
            puis chiffrée dans le coffre ({USER_FICHE_PDF_PAGES_MAX} pages au
            plus par PDF).
          </Text>
        </>
      ) : (
        <Text style={text.subtle}>
          Import de PDF indisponible sur cet appareil.
        </Text>
      )}

      <Field
        label="Texte"
        value={body}
        onChangeText={setBody}
        placeholder="Ce qu’il faut savoir : lieu, étapes, contacts, précautions…"
        multiline
        maxLength={20000}
        style={styles.bodyInput}
        textAlignVertical="top"
        error={errors.body}
      />
      {errors.family ? <Notice tone="error" message={errors.family} /> : null}
      {errors.form ? <Notice tone="error" message={errors.form} /> : null}
      <Button
        variant="primary"
        label={busy ? 'Enregistrement…' : 'Enregistrer la fiche'}
        disabled={busy}
        onPress={() => {
          void save();
        }}
      />
    </ScrollView>
  );
}

/** Pages d'un PDF joint, une à la fois, avec un zoom ×2. */
function PdfReader(props: {
  ficheId: string;
  pdfId: string;
  name: string;
  onBack: () => void;
}) {
  const fiches = useUserFiches();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(false);
  const { data, error } = useLoader(
    () => fiches.pdfPages(props.ficheId, props.pdfId),
    [fiches, props.ficheId, props.pdfId],
  );
  const pages = data ?? [];
  const pageWidth = (width - 2 * sizes.screenPadding) * (zoom ? 2 : 1);
  const current = pages[Math.min(page, pages.length - 1)];
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScreenTitle
        title={props.name}
        onBack={props.onBack}
        backLabel="Retour à la fiche"
      />
      {error ? <Notice tone="error" message={error} /> : null}
      {current ? (
        <ScrollView horizontal scrollEnabled={zoom}>
          <Image
            accessibilityLabel={`Page ${page + 1} sur ${pages.length}`}
            source={jpeg(current)}
            resizeMode="contain"
            style={[
              styles.pdfPage,
              { width: pageWidth, height: pageWidth * 1.414 },
            ]}
          />
        </ScrollView>
      ) : null}
      <View style={styles.buttons}>
        <Button
          compact
          icon={ChevronLeft}
          label="Précédente"
          disabled={page === 0}
          onPress={() => setPage(p => Math.max(0, p - 1))}
          style={styles.grow}
        />
        <Text style={styles.pagePos}>
          {pages.length ? `${page + 1} / ${pages.length}` : '…'}
        </Text>
        <Button
          compact
          label="Suivante"
          disabled={page >= pages.length - 1}
          onPress={() => setPage(p => Math.min(pages.length - 1, p + 1))}
          style={styles.grow}
        />
      </View>
      <Button
        compact
        variant="ghost"
        icon={zoom ? ZoomOut : ZoomIn}
        label={zoom ? 'Taille normale' : 'Agrandir ×2'}
        onPress={() => setZoom(z => !z)}
      />
    </ScrollView>
  );
}

export function UserFicheReader(props: {
  id: string;
  styleOf: FamilyStyle;
  backLabel?: string;
  onBack: () => void;
  onEdit: (fiche: UserFiche) => void;
  onDeleted: () => void;
}) {
  const fiches = useUserFiches();
  const { width } = useWindowDimensions();
  const { data: fiche, error } = useLoader(
    () => fiches.get(props.id),
    [fiches, props.id],
  );
  const [photo, setPhoto] = useState(0);
  const [pdf, setPdf] = useState<{ pdfId: string; name: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (pdf !== null) {
    return (
      <PdfReader
        ficheId={props.id}
        pdfId={pdf.pdfId}
        name={pdf.name}
        onBack={() => setPdf(null)}
      />
    );
  }
  if (fiche === null) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <ScreenTitle title="Fiche" onBack={props.onBack} />
        {error ? <Notice tone="error" message={error} /> : null}
      </ScrollView>
    );
  }
  const [Icon, color] = fiche.family
    ? props.styleOf(fiche.family)
    : [FileText, colors.textMuted];
  const shown = fiche.photos[Math.min(photo, fiche.photos.length - 1)];
  const photoWidth = width - 2 * sizes.screenPadding;
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScreenTitle
        title={fiche.title}
        onBack={props.onBack}
        backLabel={props.backLabel ?? 'Retour'}
      />
      <View style={styles.familyLine}>
        <Icon color={color} size={16} />
        <Text style={[text.label, { color }]}>
          {fiche.family ?? 'Mes fiches'} · FICHE PERSONNELLE
        </Text>
      </View>
      {isRiskyFamily(fiche.family) ? (
        <Panel accent={colors.warning}>
          <View style={styles.familyLine}>
            <AlertTriangle color={colors.warning} size={18} />
            <Text style={[styles.warn, styles.grow]}>
              Fiche personnelle, non vérifiée par Fenrir. Ne consommez rien et
              ne soignez personne sur la seule foi de cette fiche sans
              certitude.
            </Text>
          </View>
        </Panel>
      ) : (
        <Text style={text.subtle}>
          Fiche écrite par vous, non vérifiée par Fenrir.
        </Text>
      )}

      {shown ? (
        <View style={styles.gallery}>
          <Image
            accessibilityLabel={`Photo ${photo + 1} sur ${fiche.photos.length}`}
            source={jpeg(shown.base64)}
            resizeMode="cover"
            style={[styles.bigPhoto, { width: photoWidth }]}
          />
          {fiche.photos.length > 1 ? (
            <ScrollView horizontal contentContainerStyle={styles.wrapRow}>
              {fiche.photos.map((p, i) => (
                <Pressable
                  key={p.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Voir la photo ${i + 1}`}
                  onPress={() => setPhoto(i)}
                >
                  <Image
                    source={jpeg(p.base64)}
                    style={[
                      styles.photoThumb,
                      i === photo && { borderColor: colors.primary },
                    ]}
                  />
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
        </View>
      ) : null}

      {fiche.body ? (
        <Text selectable style={styles.body}>
          {fiche.body}
        </Text>
      ) : null}

      {fiche.pdfs.length > 0 ? (
        <>
          <Text style={styles.fieldLabel}>PDF joints</Text>
          {fiche.pdfs.map(p => (
            <Pressable
              key={p.pdfId}
              accessibilityRole="button"
              accessibilityLabel={`Lire ${p.name}`}
              onPress={() => setPdf({ pdfId: p.pdfId, name: p.name })}
              style={({ pressed }) => [
                styles.pdfRow,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.pdfBadge}>
                <Text style={styles.pdfBadgeText}>PDF</Text>
              </View>
              <View style={styles.grow}>
                <Text style={styles.pdfName} numberOfLines={1}>
                  {p.name}
                </Text>
                <Text style={text.subtle}>
                  {p.pageCount} page{p.pageCount > 1 ? 's' : ''}
                </Text>
              </View>
              <Text style={styles.read}>Lire</Text>
              <ChevronRight color={colors.cyan} size={18} />
            </Pressable>
          ))}
        </>
      ) : null}

      <Text style={text.subtle}>
        Modifiée le {isoToFr(fiche.updatedAt.slice(0, 10))} · chiffrée dans le
        coffre
      </Text>
      <View style={styles.buttons}>
        <Button
          compact
          icon={Pencil}
          label="Modifier"
          onPress={() => props.onEdit(fiche)}
          style={styles.grow}
        />
        <Button
          compact
          variant="danger"
          icon={Trash2}
          label="Supprimer"
          onPress={() => setConfirm(true)}
          style={styles.grow}
        />
      </View>
      {confirm ? (
        <Panel accent={colors.danger}>
          <Text style={text.body}>
            Supprimer « {fiche.title} », ses photos et ses PDF ?
          </Text>
          <View style={styles.buttons}>
            <Button
              compact
              label="Annuler"
              onPress={() => setConfirm(false)}
              style={styles.grow}
            />
            <Button
              compact
              variant="danger"
              label="Supprimer"
              onPress={() => {
                fiches
                  .remove(fiche.id)
                  .then(props.onDeleted)
                  .catch(e => setFailure(message(e)));
              }}
              style={styles.grow}
            />
          </View>
        </Panel>
      ) : null}
      {failure ? <Notice tone="error" message={failure} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: sizes.screenPadding,
    paddingBottom: space.xl,
    gap: space.m,
  },
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.82 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    padding: space.s,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
  },
  thumb: { width: 56, height: 56, borderRadius: radius.m },
  thumbEmpty: {
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  wrapRow: { flexDirection: 'row', gap: space.s },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  photoThumb: {
    width: 84,
    height: 84,
    borderRadius: radius.m,
    borderWidth: 2,
    borderColor: colors.border,
  },
  remove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(3,9,13,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { color: colors.danger, fontSize: 13 },
  warn: { color: colors.warning, fontSize: 14, lineHeight: 20 },
  pdfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    minHeight: 56,
    padding: space.s,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
  },
  pdfBadge: {
    width: 38,
    height: 38,
    borderRadius: radius.m,
    backgroundColor: '#B3261E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pdfBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  pdfName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  pdfRemove: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  read: { color: colors.cyan, fontSize: 14, fontWeight: '700' },
  bodyInput: { minHeight: 140 },
  familyLine: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  gallery: { gap: space.s },
  bigPhoto: { height: 230, borderRadius: radius.card },
  body: { ...text.body, lineHeight: 24 },
  pdfPage: { backgroundColor: '#FFFFFF', borderRadius: 4 },
  pagePos: {
    minWidth: 64,
    textAlign: 'center',
    color: colors.text,
    fontWeight: '700',
  },
});
