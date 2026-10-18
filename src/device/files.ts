/**
 * Fichiers choisis par l'utilisateur (module natif Android `ResiliosFiles`) :
 * enregistrer une sauvegarde ou un export, ouvrir une sauvegarde. Absent sur
 * iOS, dans les tests et l'aperçu web.
 */
import { NativeModules, Platform } from 'react-native';

import { whileAway } from '../photo/photoSource';

export interface FileAccess {
  available: boolean;
  /** Propose l'enregistrement ; true si le fichier a été écrit. */
  saveText(fileName: string, mime: string, text: string): Promise<boolean>;
  /** Propose l'ouverture d'un fichier ; son texte, ou null si annulé. */
  openText(): Promise<string | null>;
}

interface NativeFilesModule {
  saveText(fileName: string, mime: string, text: string): Promise<boolean>;
  openText(): Promise<string | null>;
}

export function nativeFiles(): FileAccess {
  const native =
    Platform.OS === 'android'
      ? (NativeModules.ResiliosFiles as NativeFilesModule | undefined)
      : undefined;
  if (native === undefined) {
    return {
      available: false,
      saveText: async () => false,
      openText: async () => null,
    };
  }
  // Le sélecteur du système passe l'application en arrière-plan : le
  // verrouillage automatique est suspendu le temps du choix.
  return {
    available: true,
    saveText: (fileName, mime, text) =>
      whileAway(() => native.saveText(fileName, mime, text)),
    openText: () => whileAway(() => native.openText()),
  };
}
