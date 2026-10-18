#!/usr/bin/env node
/**
 * Génère src/scanner/medicines.data.json : nom de chaque présentation de
 * médicament par code CIP 13, d'après la Base de données publique des
 * médicaments (ANSM, licence ouverte). Lancé par la compilation de l'APK.
 *
 * En cas d'échec (réseau, format inattendu), le fichier existant est gardé
 * et le script se termine sans erreur : l'application fonctionne alors sans
 * reconnaissance des médicaments.
 *
 * Usage : node scripts/build-medicines.mjs [dossier-des-fichiers-locaux]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE =
  'https://base-donnees-publique.medicaments.gouv.fr/telechargement.php?fichier=';
const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'scanner',
  'medicines.data.json',
);

/** Fichiers BDPM en Windows-1252 ; certains miroirs sont en UTF-8. */
function decode(bytes) {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  return utf8.includes('�')
    ? new TextDecoder('windows-1252').decode(bytes)
    : utf8;
}

async function fetchFile(name, localDir) {
  if (localDir) {
    return decode(await readFile(join(localDir, name)));
  }
  const response = await fetch(BASE + name, {
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    throw new Error(`${name} : HTTP ${response.status}`);
  }
  return decode(new Uint8Array(await response.arrayBuffer()));
}

function clean(value) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * CIS_bdpm.txt : CIS, dénomination, forme, voies… (tabulations).
 * CIS_CIP_bdpm.txt : CIS, CIP7, libellé de présentation, statut, état de
 * commercialisation, date, CIP13…
 */
export function buildTable(cisText, cipText) {
  const names = new Map();
  for (const line of cisText.split(/\r?\n/)) {
    const cols = line.split('\t');
    if (/^\d{8}$/.test(cols[0] ?? '') && clean(cols[1])) {
      names.set(cols[0], clean(cols[1]));
    }
  }
  const cip = {};
  for (const line of cipText.split(/\r?\n/)) {
    const cols = line.split('\t');
    const code = clean(cols[6]);
    const name = names.get(cols[0]);
    if (!/^340\d{10}$/.test(code) || name === undefined) {
      continue;
    }
    const presentation = clean(cols[2]).slice(0, 80);
    cip[code] = presentation ? `${name} — ${presentation}` : name;
  }
  return cip;
}

async function main() {
  const localDir = process.argv[2];
  try {
    const [cisText, cipText] = await Promise.all([
      fetchFile('CIS_bdpm.txt', localDir),
      fetchFile('CIS_CIP_bdpm.txt', localDir),
    ]);
    const cip = buildTable(cisText, cipText);
    const count = Object.keys(cip).length;
    if (count < 1000) {
      throw new Error(`seulement ${count} présentations reconnues`);
    }
    const generated = new Date().toISOString().slice(0, 10);
    await writeFile(OUT, JSON.stringify({ generated, cip }));
    console.log(
      `Base des médicaments : ${count} présentations (${generated}).`,
    );
  } catch (e) {
    console.warn(
      `Base des médicaments non générée (${
        e instanceof Error ? e.message : String(e)
      }) : fichier existant conservé.`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
