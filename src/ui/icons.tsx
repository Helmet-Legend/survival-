/**
 * Icônes du pack graphique Fenrir (SVG 24 × 24, trait), utilisables comme
 * les icônes Lucide : mêmes propriétés `color`, `size`, `strokeWidth`.
 */
import React from 'react';
import { SvgXml } from 'react-native-svg';

export interface IconProps {
  color?: string;
  size?: number;
  strokeWidth?: number;
}

/** Toute icône de l'interface : Lucide ou pack Fenrir. */
export type Icon = React.ComponentType<IconProps>;

function fenrirIcon(name: string, body: string): Icon {
  const Component = ({
    color = 'currentColor',
    size = 24,
    strokeWidth = 1.8,
  }: IconProps) => (
    <SvgXml
      xml={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`}
      width={size}
      height={size}
    />
  );
  Component.displayName = `FenrirIcon(${name})`;
  return Component;
}

// Catégories.
export const WaterIcon = fenrirIcon(
  'water',
  '<path d="M12 2.5C9.5 6.2 5.5 10.1 5.5 14.3a6.5 6.5 0 0 0 13 0C18.5 10.1 14.5 6.2 12 2.5Z"/><path d="M8.5 15.2a3.5 3.5 0 0 0 3.5 3.2"/>',
);
export const FoodIcon = fenrirIcon(
  'food',
  '<path d="M3 20 19.5 3.5"/><path d="M6.2 16.8 3.8 14.4M9.5 13.5 7 11M12.8 10.2 10.4 7.8M16.1 6.9 13.7 4.5"/><path d="M7 20 4 17M12 15 9 12M17 10 14 7"/>',
);
export const AmmoIcon = fenrirIcon(
  'ammo',
  '<path d="M7 4v16M12 3v17M17 4v16"/><path d="M5 7h4M10 6h4M15 7h4M5 16h4M10 16h4M15 16h4"/>',
);
export const MedicalIcon = fenrirIcon(
  'medical',
  '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
);
export const ToolIcon = fenrirIcon(
  'tool',
  '<path d="M14 6a5 5 0 0 0-6.4 6.4L3 17l4 4 4.6-4.6A5 5 0 0 0 18 10l-3 3-4-4 3-3Z"/>',
);
export const EquipmentIcon = fenrirIcon(
  'equipment',
  '<rect x="4" y="7" width="16" height="14" rx="2"/><path d="M9 7V4h6v3M8 11h8M9 15h6"/>',
);

// Champs des fiches.
export const TagIcon = fenrirIcon(
  'tag',
  '<path d="M3 12V4h8l10 8-8 8-10-8Z"/><circle cx="7.5" cy="8" r="1"/>',
);
export const QuantityIcon = fenrirIcon(
  'quantity',
  '<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="7" cy="7" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="17" cy="17" r="1"/>',
);
export const BoxIcon = fenrirIcon(
  'box',
  '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="M3 8v9l9 5 9-5V8M12 13v9"/>',
);
export const VolumeIcon = fenrirIcon(
  'volume',
  '<path d="M4 7 12 3l8 4v10l-8 4-8-4V7Z"/><path d="m4 7 8 4 8-4M12 11v10"/>',
);
export const WeightIcon = fenrirIcon(
  'weight',
  '<path d="M6 8h12l2 12H4L6 8Z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
);
export const CaloriesIcon = fenrirIcon(
  'calories',
  '<path d="M12 22c4.4 0 7-3.1 7-7.1 0-3.2-1.7-5.3-4.1-7.9-.1 2.2-1 3.5-2.1 4.1C12.9 6.8 10.9 3.9 8 2c.5 4.1-1.1 6.6-3 9.4C1.4 17 5.2 22 12 22Z"/>',
);
export const DateIcon = fenrirIcon(
  'date',
  '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 10h18M8 14h3M8 17h7"/>',
);
export const ExpiryIcon = fenrirIcon(
  'expiry',
  '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 10h18M9 14l2 2 4-4"/>',
);
export const LocationIcon = fenrirIcon(
  'location',
  '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
);
export const StateIcon = fenrirIcon(
  'state',
  '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16.5 9"/>',
);
export const AlertIcon = fenrirIcon(
  'alert',
  '<path d="M12 3 22 20H2L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
);
export const NotesIcon = fenrirIcon(
  'notes',
  '<path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M7 8h10M7 12h10M7 16h6"/>',
);
export const BarcodeIcon = fenrirIcon(
  'barcode',
  '<path d="M4 5v14M7 5v14M10 5v14M14 5v14M16 5v14M20 5v14"/>',
);
export const ModelIcon = fenrirIcon(
  'model',
  '<path d="M12 3 21 8v8l-9 5-9-5V8l9-5Z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
);
export const EnergyIcon = fenrirIcon(
  'energy',
  '<path d="m13 2-9 12h7l-1 8 10-13h-7l0-7Z"/>',
);
export const BatteryIcon = fenrirIcon(
  'battery',
  '<rect x="3" y="7" width="17" height="10" rx="2"/><path d="M22 10v4M6 10h7"/>',
);
export const PhotoIcon = fenrirIcon(
  'photo',
  '<rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="3"/><path d="m7 6 1.5-3h7L17 6"/>',
);
export const CheckIcon = fenrirIcon('check', '<path d="m5 12 4 4L19 6"/>');
