/**
 * Illustrations vectorielles des six fiches (en-tête, comme la maquette) :
 * nettes à toutes les densités, hors ligne, aux couleurs de la catégorie.
 * Dessins simples en trait ; l'arme n'est évoquée que par ses munitions.
 */
import type { ItemCategory } from '../../inventory';
import { colors } from '../theme';

const SCENES: Record<ItemCategory, string> = {
  water: `
    <path d="M150 140V62l14-14h46q8 0 8 8v84z"/>
    <rect x="172" y="54" width="26" height="10" rx="4" fill-opacity="0"/>
    <rect x="206" y="38" width="12" height="10" rx="2"/>
    <path d="M162 84l44 44M206 84l-44 44" stroke-opacity=".45"/>
    <path d="M240 140V72q0-12 10-18V40h10v14q10 6 10 18v68z"/>
    <rect x="248" y="32" width="14" height="8" rx="2"/>
    <path d="M241 98q7-4 14 0t14 0" stroke-opacity=".6"/>
    <path d="M290 140V64q0-12 10-18V30h12v16q10 6 10 18v76z"/>
    <rect x="298" y="22" width="16" height="8" rx="2"/>
    <path d="M291 88q8-4 15 0t15 0" stroke-opacity=".6"/>
    <path d="M118 46q-8 12 0 16t0-16z"/>
    <path d="M338 96q-6 9 0 12t0-12z"/>`,
  food: `
    <path d="M118 140V96" stroke-opacity=".7"/>
    <ellipse cx="112" cy="104" rx="5" ry="9" transform="rotate(-25 112 104)"/>
    <ellipse cx="124" cy="110" rx="5" ry="9" transform="rotate(25 124 110)"/>
    <ellipse cx="118" cy="90" rx="4" ry="8"/>
    <rect x="148" y="80" width="46" height="60" rx="4"/>
    <ellipse cx="171" cy="80" rx="23" ry="6"/>
    <rect x="148" y="96" width="46" height="20" fill-opacity=".3"/>
    <rect x="200" y="92" width="40" height="48" rx="4"/>
    <ellipse cx="220" cy="92" rx="20" ry="5"/>
    <path d="M200 108h40" stroke-opacity=".5"/>
    <path d="M250 140V78q0-8 8-10h28q8 2 8 10v62z"/>
    <rect x="254" y="56" width="36" height="12" rx="3"/>
    <circle cx="262" cy="96" r="4"/><circle cx="274" cy="104" r="4"/>
    <circle cx="284" cy="92" r="4"/><circle cx="266" cy="118" r="4"/>
    <circle cx="282" cy="124" r="4"/>
    <path d="M304 140q-6-40 8-62l-4-8h28l-4 8q14 22 8 62z"/>
    <path d="M308 70h26" stroke-width="4"/>`,
  weapon: `
    <circle cx="140" cy="52" r="18" fill-opacity="0"/>
    <path d="M140 26v14M140 64v14M114 52h14M152 52h14" stroke-opacity=".7"/>
    <path d="M170 140V96h12v44zM170 96q6-26 12 0"/>
    <path d="M188 140V96h12v44zM188 96q6-26 12 0"/>
    <path d="M206 140V96h12v44zM206 96q6-26 12 0"/>
    <path d="M224 140V96h12v44zM224 96q6-26 12 0"/>
    <path d="M168 130h70" stroke-opacity=".45"/>
    <rect x="254" y="92" width="88" height="48" rx="4"/>
    <rect x="250" y="82" width="96" height="12" rx="3"/>
    <rect x="290" y="94" width="16" height="10" rx="2"/>
    <path d="M268 120h60M268 128h40" stroke-opacity=".5"/>`,
  medical: `
    <circle cx="150" cy="124" r="15"/><circle cx="150" cy="124" r="5"/>
    <path d="M165 124h22" stroke-opacity=".6"/>
    <rect x="182" y="70" width="104" height="70" rx="10"/>
    <path d="M214 70V58h40v12" fill-opacity="0"/>
    <path d="M226 88h16v10h10v16h-10v10h-16v-10h-10V98h10z" fill-opacity=".45"/>
    <rect x="300" y="72" width="30" height="40" rx="4"/>
    <rect x="303" y="60" width="24" height="12" rx="2"/>
    <path d="M304 90h22" stroke-opacity=".5"/>
    <rect x="296" y="122" width="44" height="16" rx="8"/>
    <path d="M318 122v16" stroke-opacity=".6"/>`,
  tool: `
    <path d="M168 140L232 40" stroke-width="7"/>
    <path d="M222 36q22-12 38 4l-12 22q-14-9-30-12z"/>
    <path d="M258 140l40-58" stroke-width="7"/>
    <path d="M294 86a14 14 0 1 1 12 8l-4-8z"/>
    <path d="M330 140V72" stroke-width="7"/>
    <rect x="312" y="56" width="36" height="16" rx="3"/>
    <path d="M140 140h40M230 140h40" stroke-opacity=".4"/>`,
  energy: `
    <path d="M150 140V82q0-26 32-26t32 26v58z"/>
    <rect x="164" y="98" width="36" height="28" rx="6"/>
    <path d="M168 60q14-12 28 0" fill-opacity="0"/>
    <path d="M150 104h-8v30h8M214 104h8v30h-8" fill-opacity="0"/>
    <path d="M250 66a10 10 0 0 1 20 0" fill-opacity="0"/>
    <path d="M244 76h32l-6-10h-20z"/>
    <rect x="248" y="76" width="24" height="42" rx="4" fill-opacity=".05"/>
    <path d="M260 108q-8-10 0-20q8 10 0 20z" fill-opacity=".5"/>
    <rect x="242" y="118" width="36" height="10" rx="2"/>
    <path d="M292 140l34-62l34 62z"/>
    <path d="M326 78v62M316 140l10-24l10 24" stroke-opacity=".6"/>`,
};

/** Illustration SVG d'une catégorie, fondue vers le fond en bas et à gauche. */
export function categoryIllustration(
  category: ItemCategory,
  color: string,
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 160" preserveAspectRatio="xMaxYMid slice">
  <defs>
    <radialGradient id="glow" cx="72%" cy="45%" r="65%">
      <stop offset="0" stop-color="${color}" stop-opacity=".32"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="fadeY" x1="0" y1="0" x2="0" y2="1">
      <stop offset=".55" stop-color="${colors.surface}" stop-opacity="0"/>
      <stop offset="1" stop-color="${colors.surface}" stop-opacity="1"/>
    </linearGradient>
    <linearGradient id="fadeX" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${colors.surface}" stop-opacity=".9"/>
      <stop offset=".35" stop-color="${colors.surface}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="360" height="160" fill="url(#glow)"/>
  <path d="M0 140H360" stroke="${color}" stroke-opacity=".25" stroke-width="2"/>
  <g fill="${color}" fill-opacity=".14" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round">${SCENES[category]}
  </g>
  <rect width="360" height="160" fill="url(#fadeX)"/>
  <rect width="360" height="160" fill="url(#fadeY)"/>
</svg>`;
}
