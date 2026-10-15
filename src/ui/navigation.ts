import { createContext, useContext } from 'react';

/** Les quatre sections de la barre de navigation basse. */
export type Tab = 'home' | 'stock' | 'map' | 'guides';

/** Écrans secondaires ouverts par-dessus une section. */
export type Overlay = 'plan' | 'settings';

export interface Navigation {
  goTo(tab: Tab): void;
  open(overlay: Overlay): void;
  close(): void;
}

export const NavigationContext = createContext<Navigation | null>(null);

export function useNavigation(): Navigation {
  const navigation = useContext(NavigationContext);
  if (navigation === null) {
    throw new Error('Navigation indisponible');
  }
  return navigation;
}
