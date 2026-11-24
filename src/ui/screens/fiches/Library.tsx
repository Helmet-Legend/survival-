/**
 * Bibliothèque : guides et livres en PDF, gardés entiers dans le coffre et
 * lus page par page, sans limite de pages.
 */
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FilePlus2,
  Pencil,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react-native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  LIBRARY_MAX_BYTES,
  LibraryRepository,
  type LibraryBook,
} from '../../../db/library';
import { formatBytes } from '../../../photo/pdfImport';
import {
  Button,
  EmptyState,
  Field,
  Notice,
  Panel,
  ScreenTitle,
} from '../../components/controls';
import { useSession } from '../../session';
import { colors, radius, sizes, space, text } from '../../theme';
import { useLoader } from '../../useLoader';

/** Côté des pages affichées : net à l'écran, même agrandi ×2. */
const READ_SIDE = 2000;

const jpeg = (base64: string) => ({ uri: `data:image/jpeg;base64,${base64}` });

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useLibrary(): LibraryRepository {
  const { db } = useSession();
  return useMemo(() => new LibraryRepository(db), [db]);
}

function bookMeta(book: LibraryBook): string {
  const parts = [
    `${book.pageCount} page${book.pageCount > 1 ? 's' : ''}`,
    formatBytes(book.bytes),
  ];
  if (book.lastPage > 0) {
    parts.push(`reprendre p. ${book.lastPage + 1}`);
  }
  return parts.join(' · ');
}

export function LibraryList(props: {
  onBack: () => void;
  onOpen: (id: string) => void;
}) {
  const library = useLibrary();
  const { photoSource } = useSession();
  const files = photoSource.pdf;
  const { data, error, reload } = useLoader(
    async () => ({
      books: await library.list(),
      total: await library.totalBytes(),
    }),
    [library],
  );
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const add = async () => {
    if (files === undefined) {
      return;
    }
    setFailure(null);
    setBusy(true);
    let token: string | null = null;
    try {
      const opened = await files.open();
      if (opened === null) {
        return;
      }
      token = opened.token;
      setProgress(`Copie dans le coffre : 0 / ${formatBytes(opened.bytes)}`);
      const id = await library.add(files, opened, (done, total) =>
        setProgress(
          `Copie dans le coffre : ${formatBytes(done)} / ${formatBytes(total)}`,
        ),
      );
      await reload();
      props.onOpen(id);
    } catch (e) {
      setFailure(message(e));
    } finally {
      if (token !== null) {
        await files.close(token).catch(() => undefined);
      }
      setBusy(false);
      setProgress(null);
    }
  };

  const books = data?.books ?? [];
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScreenTitle
        title="Bibliothèque"
        onBack={props.onBack}
        backLabel="Retour aux fiches"
      />
      <Text style={text.muted}>
        Vos guides et livres en PDF, gardés entiers et chiffrés dans le coffre,
        lisibles sans réseau, page par page. Aucune limite de pages (
        {formatBytes(LIBRARY_MAX_BYTES)} au plus par fichier).
      </Text>
      {error ? <Notice tone="error" message={error} /> : null}
      {failure ? <Notice tone="error" message={failure} /> : null}
      {files ? (
        <Button
          variant="primary"
          icon={FilePlus2}
          label={progress ?? (busy ? 'Patientez…' : 'Ajouter un PDF')}
          accessibilityLabel="Ajouter un PDF du téléphone à la bibliothèque"
          disabled={busy}
          onPress={() => {
            void add();
          }}
        />
      ) : (
        <Text style={text.subtle}>
          L’ajout de PDF n’est possible que dans l’application installée sur le
          téléphone.
        </Text>
      )}
      {books.length === 0 && data !== null ? (
        <EmptyState
          icon={BookOpen}
          title="Aucun livre pour l’instant"
          message="Ajoutez un guide de survie, une notice ou un livre en PDF : il restera lisible même sans réseau."
        />
      ) : null}
      {books.map(book => (
        <Pressable
          key={book.id}
          accessibilityRole="button"
          accessibilityLabel={`${book.title}, ${bookMeta(book)}`}
          onPress={() => props.onOpen(book.id)}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <View style={styles.badge}>
            <Text style={styles.badgeText}>PDF</Text>
          </View>
          <View style={styles.grow}>
            <Text style={styles.title} numberOfLines={2}>
              {book.title}
            </Text>
            <Text style={text.subtle}>{bookMeta(book)}</Text>
          </View>
          <ChevronRight color={colors.textSubtle} size={20} />
        </Pressable>
      ))}
      {books.length > 0 ? (
        <Text style={text.subtle}>
          {books.length} livre{books.length > 1 ? 's' : ''} ·{' '}
          {formatBytes(data?.total ?? 0)} sur le téléphone. Les livres ne sont
          pas dans la sauvegarde chiffrée (trop lourds) : gardez vos PDF
          d’origine ailleurs.
        </Text>
      ) : null}
    </ScrollView>
  );
}

export function LibraryReader(props: {
  id: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const library = useLibrary();
  const { photoSource } = useSession();
  const files = photoSource.pdf;
  const { width } = useWindowDimensions();
  const [book, setBook] = useState<LibraryBook | null>(null);
  const [session, setSession] = useState<{
    token: string;
    pageCount: number;
  } | null>(null);
  const [opening, setOpening] = useState<string>('Ouverture…');
  const [page, setPage] = useState(0);
  const [image, setImage] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  // Pages déjà dessinées (la courante et ses voisines).
  const cache = useRef(new Map<number, string>());

  // Ouverture : le livre est reconstitué le temps de la lecture, puis effacé.
  useEffect(() => {
    if (files === undefined) {
      setFailure('Lecture possible seulement dans l’application installée.');
      return undefined;
    }
    let live = true;
    let token: string | null = null;
    (async () => {
      const found = await library.get(props.id);
      if (!live) {
        return;
      }
      if (found === null) {
        setFailure('Livre introuvable');
        return;
      }
      setBook(found);
      const opened = await library.open(files, props.id, (done, total) => {
        if (live) {
          setOpening(`Ouverture… ${Math.round((done / total) * 100)} %`);
        }
      });
      token = opened.token;
      if (!live) {
        await files.close(opened.token).catch(() => undefined);
        return;
      }
      setPage(Math.min(found.lastPage, opened.pageCount - 1));
      setSession(opened);
    })().catch(e => {
      if (live) {
        setFailure(message(e));
      }
    });
    return () => {
      live = false;
      if (token !== null) {
        void files.close(token).catch(() => undefined);
      }
    };
  }, [files, library, props.id]);

  // Page affichée : dessinée à la demande, voisines préparées ensuite.
  useEffect(() => {
    if (session === null || files === undefined) {
      return undefined;
    }
    let live = true;
    const draw = async (index: number) => {
      const known = cache.current.get(index);
      if (known !== undefined) {
        return known;
      }
      const [img] = await files.render(session.token, index, 1, READ_SIDE);
      if (img !== undefined) {
        cache.current.set(index, img);
        // Cinq pages gardées au plus : la mémoire reste faible.
        for (const key of [...cache.current.keys()]) {
          if (Math.abs(key - index) > 2) {
            cache.current.delete(key);
          }
        }
      }
      return img ?? null;
    };
    (async () => {
      const img = await draw(page);
      if (!live) {
        return;
      }
      setImage(img);
      void library.setLastPage(props.id, page).catch(() => undefined);
      if (page + 1 < session.pageCount) {
        await draw(page + 1);
      }
    })().catch(e => {
      if (live) {
        setFailure(message(e));
      }
    });
    return () => {
      live = false;
    };
  }, [files, library, page, props.id, session]);

  const total = session?.pageCount ?? book?.pageCount ?? 0;
  const go = (next: number) => setPage(Math.max(0, Math.min(total - 1, next)));
  const pageWidth = (width - 2 * sizes.screenPadding) * (zoom ? 2 : 1);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScreenTitle
        title={book?.title ?? 'Bibliothèque'}
        onBack={props.onBack}
        backLabel="Retour à la bibliothèque"
      />
      {failure ? <Notice tone="error" message={failure} /> : null}
      {session === null && failure === null ? (
        <Text style={text.muted}>{opening}</Text>
      ) : null}
      {image !== null ? (
        <ScrollView horizontal scrollEnabled={zoom}>
          <Image
            accessibilityLabel={`Page ${page + 1} sur ${total}`}
            source={jpeg(image)}
            resizeMode="contain"
            style={[
              styles.sheet,
              { width: pageWidth, height: pageWidth * 1.414 },
            ]}
          />
        </ScrollView>
      ) : null}
      {session !== null ? (
        <>
          <View style={styles.buttons}>
            <Button
              compact
              icon={ChevronsLeft}
              label="−10"
              accessibilityLabel="Reculer de 10 pages"
              disabled={page === 0}
              onPress={() => go(page - 10)}
            />
            <Button
              compact
              icon={ChevronLeft}
              label="Préc."
              accessibilityLabel="Page précédente"
              disabled={page === 0}
              onPress={() => go(page - 1)}
              style={styles.grow}
            />
            <Text style={styles.pagePos}>
              {page + 1} / {total}
            </Text>
            <Button
              compact
              label="Suiv."
              accessibilityLabel="Page suivante"
              disabled={page >= total - 1}
              onPress={() => go(page + 1)}
              style={styles.grow}
            />
            <Button
              compact
              icon={ChevronsRight}
              label="+10"
              accessibilityLabel="Avancer de 10 pages"
              disabled={page >= total - 1}
              onPress={() => go(page + 10)}
            />
          </View>
          <Button
            compact
            variant="ghost"
            icon={zoom ? ZoomOut : ZoomIn}
            label={zoom ? 'Taille normale' : 'Agrandir ×2'}
            onPress={() => setZoom(z => !z)}
          />
        </>
      ) : null}

      {book !== null ? (
        <Panel>
          <Text style={text.subtle}>
            {book.fileName} · {formatBytes(book.bytes)} · chiffré dans le
            coffre, hors sauvegarde.
          </Text>
          {renaming !== null ? (
            <>
              <Field
                label="Titre"
                value={renaming}
                onChangeText={setRenaming}
                maxLength={200}
              />
              <View style={styles.buttons}>
                <Button
                  compact
                  variant="primary"
                  label="Enregistrer"
                  onPress={() => {
                    void library
                      .rename(book.id, renaming)
                      .then(async () => {
                        setBook(await library.get(book.id));
                        setRenaming(null);
                      })
                      .catch(e => setFailure(message(e)));
                  }}
                />
                <Button
                  compact
                  variant="ghost"
                  label="Annuler"
                  onPress={() => setRenaming(null)}
                />
              </View>
            </>
          ) : confirm ? (
            <>
              <Text style={text.body}>
                Retirer « {book.title} » de la bibliothèque ?
              </Text>
              <View style={styles.buttons}>
                <Button
                  compact
                  variant="danger"
                  label="Retirer"
                  onPress={() => {
                    void library
                      .remove(book.id)
                      .then(props.onDeleted)
                      .catch(e => setFailure(message(e)));
                  }}
                />
                <Button
                  compact
                  variant="ghost"
                  label="Annuler"
                  onPress={() => setConfirm(false)}
                />
              </View>
            </>
          ) : (
            <View style={styles.buttons}>
              <Button
                compact
                icon={Pencil}
                label="Renommer"
                onPress={() => setRenaming(book.title)}
              />
              <Button
                compact
                variant="danger"
                icon={Trash2}
                label="Retirer"
                onPress={() => setConfirm(true)}
              />
            </View>
          )}
        </Panel>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: sizes.screenPadding,
    paddingBottom: space.xl,
    gap: space.m,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    padding: space.m,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.8 },
  badge: {
    width: 40,
    height: 40,
    borderRadius: radius.m,
    backgroundColor: '#B3261E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  grow: { flex: 1 },
  title: { ...text.body, fontWeight: '700' },
  buttons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    flexWrap: 'wrap',
  },
  sheet: { backgroundColor: '#FFFFFF', borderRadius: 4 },
  pagePos: {
    minWidth: 72,
    textAlign: 'center',
    color: colors.text,
    fontWeight: '700',
  },
});
