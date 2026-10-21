/**
 * Horloge logique hybride (HLC) : l'heure du téléphone, corrigée pour
 * respecter l'ordre des échanges. Une modification faite après avoir reçu
 * celle de l'autre téléphone est toujours datée après elle, même si son
 * horloge retarde.
 *
 * Forme texte triable : `mmmmmmmmmmmmmmm:ccccc:appareil` (millisecondes sur
 * 15 chiffres, compteur sur 5, identifiant de l'appareil pour départager).
 */
export interface Hlc {
  wall: number;
  counter: number;
  node: string;
}

const PATTERN = /^(\d{15}):(\d{5}):([0-9a-f]{1,32})$/;
const MAX_COUNTER = 99999;

export function encodeHlc(h: Hlc): string {
  return `${String(h.wall).padStart(15, '0')}:${String(h.counter).padStart(
    5,
    '0',
  )}:${h.node}`;
}

export function decodeHlc(text: string): Hlc | null {
  const m = PATTERN.exec(text);
  if (!m) {
    return null;
  }
  return { wall: Number(m[1]), counter: Number(m[2]), node: m[3] };
}

export function isHlc(text: unknown): text is string {
  return typeof text === 'string' && PATTERN.test(text);
}

/** Horodatage d'un événement local survenu à `physical` (ms). */
export function tick(last: Hlc | null, physical: number, node: string): Hlc {
  const wall = Math.max(Math.floor(physical), last?.wall ?? 0);
  const counter = last && wall === last.wall ? last.counter + 1 : 0;
  if (counter > MAX_COUNTER) {
    return { wall: wall + 1, counter: 0, node };
  }
  return { wall, counter, node };
}

/** Horloge après réception d'un horodatage distant : jamais en arrière. */
export function receive(last: Hlc | null, remote: Hlc, node: string): Hlc {
  if (
    last &&
    (last.wall > remote.wall ||
      (last.wall === remote.wall && last.counter >= remote.counter))
  ) {
    return last;
  }
  return { wall: remote.wall, counter: remote.counter, node };
}
