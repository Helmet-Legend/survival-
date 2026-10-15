/**
 * Fonds vectoriels du kit de design (04-FONDS), embarqués en texte pour
 * être rendus par react-native-svg sans fichier ni réseau.
 */

/** Lignes topographiques cyan très discrètes, fond transparent. */
export const TOPOGRAPHIC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" preserveAspectRatio="xMidYMid slice">
<g fill="none" stroke="#35D9FF" stroke-width="2" opacity=".12">
<path d="M-80 170 Q110 40 240 160 T500 150 T740 120 T1160 190"/>
<path d="M-100 210 Q100 80 250 200 T510 190 T760 160 T1170 230"/>
<path d="M-120 255 Q90 125 260 245 T525 235 T780 205 T1180 275"/>
<path d="M-100 700 C80 520 250 610 330 740 S570 900 690 710 940 540 1170 730"/>
<path d="M-120 745 C60 565 230 655 310 785 S550 945 670 755 920 585 1150 775"/>
<path d="M-140 790 C40 610 210 700 290 830 S530 990 650 800 900 630 1130 820"/>
<path d="M-100 1300 C100 1120 240 1180 350 1310 S600 1480 740 1300 980 1160 1180 1350"/>
<path d="M-120 1350 C80 1170 220 1230 330 1360 S580 1530 720 1350 960 1210 1160 1400"/>
<path d="M-140 1400 C60 1220 200 1280 310 1410 S560 1580 700 1400 940 1260 1140 1450"/>
</g></svg>`;

/** Fond abstrait technique (dégradé radial et lignes), opaque. */
export const TECH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" preserveAspectRatio="xMidYMid slice">
<defs>
 <radialGradient id="g" cx="78%" cy="12%" r="75%"><stop offset="0" stop-color="#0A3040"/><stop offset=".5" stop-color="#07131B"/><stop offset="1" stop-color="#05090D"/></radialGradient>
 <linearGradient id="line" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#35D9FF" stop-opacity=".35"/><stop offset="1" stop-color="#FF9D1C" stop-opacity=".15"/></linearGradient>
</defs>
<rect width="1080" height="1920" fill="url(#g)"/>
<g fill="none" stroke="url(#line)" stroke-width="2" opacity=".45">
 <path d="M-100 420 Q150 250 360 390 T800 330 T1200 400"/>
 <path d="M-100 470 Q150 300 360 440 T800 380 T1200 450"/>
 <path d="M-100 520 Q150 350 360 490 T800 430 T1200 500"/>
 <path d="M-100 570 Q150 400 360 540 T800 480 T1200 550"/>
 <path d="M-100 620 Q150 450 360 590 T800 530 T1200 600"/>
 <circle cx="850" cy="250" r="110"/><circle cx="850" cy="250" r="145"/><circle cx="850" cy="250" r="180"/>
 <path d="M0 1200 L1080 850 M0 1280 L1080 930 M0 1360 L1080 1010 M0 1440 L1080 1090"/>
</g>
</svg>`;
