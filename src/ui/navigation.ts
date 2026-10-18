import { createContext, useContext } from 'react';

import type { ItemCategory } from '../inventory';

/** Les quatre sections de la barre de navigation basse. */
export type Tab = 'home' | 'stock' | 'map' | 'guides';

/** Écrans secondaires ouverts par-dessus une section. */
export type Overlay = 'plan' | 'settings' | 'stockForm' | 'emergency';

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
}

/** Catégorie et message à afficher en arrivant sur les Stocks. */
export interface StockFocus {
  category?: ItemCategory | 'documents' | 'bags';
  message?: string;
  /** Sac d'évacuation à rouvrir (retour de fiche). */
  bagId?: string;
}

export interface Navigation {
  goTo(tab: Tab, focus?: StockFocus): void;
  open(overlay: Overlay): void;
  openStockForm(target: StockFormTarget): void;
  close(): void;
  /** Focus demandé pour l'écran Stocks (après un enregistrement). */
  stockFocus?: StockFocus;
}

export const NavigationContext = createContext<Navigation | null>(null);

export function useNavigation(): Navigation {
  const navigation = useContext(NavigationContext);
  if (navigation === null) {
    throw new Error('Navigation indisponible');
  }
  return navigation;
}
