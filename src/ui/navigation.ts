import { createContext, useContext } from 'react';

import type { ItemCategory } from '../inventory';
import type { CrisisId } from '../plan/crisis';

/** Les cinq sections de la barre de navigation basse. */
export type Tab = 'home' | 'stock' | 'prepare' | 'guides' | 'map';

/** Écrans secondaires ouverts par-dessus une section. */
export type Overlay =
  | 'plan'
  | 'settings'
  | 'stockForm'
  | 'emergency'
  | 'familyPlan'
  | 'preparation'
  | 'alerts'
  | 'calculators'
  | 'scan'
  | 'history'
  | 'readiness'
  | 'purchases'
  | 'crisis'
  | 'household'
  | 'sync'
  | 'privacy';

/** Fiche de stock à ouvrir : création dans une catégorie, ou modification. */
export interface StockFormTarget {
  category: ItemCategory;
  recordType?: 'weapon' | 'ammo' | 'accessory';
  itemId?: string;
  weaponId?: string;
  /** Valeurs préremplies d'une nouvelle fiche (ex. calibre d'une arme). */
  prefill?: Record<string, string>;
  /** Nouvel article rangé dans ce sac d'évacuation. */
  bagId?: string;
  /** Code-barres scanné : associé à la fiche créée, retiré du panier. */
  barcode?: string;
}

/** Catégorie et message à afficher en arrivant sur les Stocks. */
export interface StockFocus {
  category?: ItemCategory | 'watch' | 'documents' | 'bags' | 'boxes';
  message?: string;
  /** Sac d'évacuation à rouvrir (retour de fiche). */
  bagId?: string;
  /** Boîte à ouvrir (étiquette lue par le scanner). */
  boxId?: string;
}

export interface Navigation {
  goTo(tab: Tab, focus?: StockFocus): void;
  open(overlay: Overlay): void;
  openStockForm(target: StockFormTarget): void;
  /** Ouvre le simulateur de crise sur ce scénario. */
  openCrisis(scenario: CrisisId): void;
  /** Revient à l'écran d'où l'on vient (écran secondaire précédent ou section). */
  close(): void;
  /** Libellé du retour de `close()` (« Retour au plan d'action »…). */
  backLabel: string;
  /** Focus demandé pour l'écran Stocks (après un enregistrement). */
  stockFocus?: StockFocus;
  /** Scénario demandé à l'ouverture du simulateur de crise. */
  crisisScenario?: CrisisId;
}

export const NavigationContext = createContext<Navigation | null>(null);

export function useNavigation(): Navigation {
  const navigation = useContext(NavigationContext);
  if (navigation === null) {
    throw new Error('Navigation indisponible');
  }
  return navigation;
}

const TAB_BACK: Record<Tab, string> = {
  home: 'Retour à l’accueil',
  stock: 'Retour aux stocks',
  prepare: 'Retour à Préparer',
  guides: 'Retour aux fiches',
  map: 'Retour à la position',
};

const OVERLAY_BACK: Record<Overlay, string> = {
  plan: 'Retour au plan d’action',
  settings: 'Retour aux réglages',
  stockForm: 'Retour à la fiche',
  emergency: 'Retour à l’urgence',
  familyPlan: 'Retour au plan familial',
  preparation: 'Retour au kit et matériel',
  alerts: 'Retour aux alertes',
  calculators: 'Retour aux calculateurs',
  scan: 'Retour au scanner',
  history: 'Retour à l’historique',
  readiness: 'Retour à l’indice',
  purchases: 'Retour au plan d’achats',
  crisis: 'Retour au simulateur',
  household: 'Retour à Mon foyer',
  sync: 'Retour au partage',
  privacy: 'Retour à la confidentialité',
};

/** Libellé du retour vers l'écran précédent (écran secondaire, sinon section). */
export function backLabelFor(previous: Overlay | undefined, tab: Tab): string {
  return previous === undefined ? TAB_BACK[tab] : OVERLAY_BACK[previous];
}
