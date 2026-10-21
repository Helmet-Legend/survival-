/* eslint-disable no-bitwise -- comparaison en temps constant, nonce */
/**
 * Chiffrement de bout en bout entre deux téléphones du foyer.
 *
 * Même sur un Wi-Fi local ou un partage de connexion, rien ne circule en
 * clair : un tiers sur le réseau ne peut ni lire, ni modifier, ni rejouer
 * les échanges, ni se faire passer pour l'un des téléphones.
 *
 * - Chaque téléphone a une clé d'identité X25519 durable, rangée dans le
 *   coffre chiffré.
 * - Association : le QR code (canal visuel, impossible à intercepter à
 *   distance) transmet la clé publique du téléphone qui l'affiche et un
 *   secret à usage unique. L'autre téléphone prouve qu'il l'a lu.
 * - Chaque échange : clés éphémères des deux côtés (confidentialité
 *   persistante) combinées aux clés d'identité (authentification mutuelle),
 *   dérivées par HKDF-SHA256 avec la clé d'association.
 * - Messages : ChaCha20-Poly1305, une clé par sens, compteur dans le nonce :
 *   tout message modifié, rejoué ou réordonné est refusé.
 */
import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils';

import { utf8ToText } from '../backup/base64';
import { wipe } from '../crypto/bytes';
import type { RandomSource } from '../crypto/types';
import { fromBase64Url, toBase64Url } from './encoding';

export const PROTOCOL = 'fenrir-sync-1';
const KEY_BYTES = 32;

export type SecureErrorCode =
  /** Message illisible ou incomplet. */
  | 'INVALID_MESSAGE'
  /** Clés différentes : ce n'est pas le téléphone associé (ou code faux). */
  | 'AUTH_FAILED'
  /** Message modifié, rejoué ou dans le désordre. */
  | 'TAMPERED';

export class SecureError extends Error {
  constructor(readonly code: SecureErrorCode, message: string) {
    super(message);
    this.name = 'SecureError';
  }
}

export interface KeyPair {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

export function keyPairFrom(secretKey: Uint8Array): KeyPair {
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

export function generateKeyPair(random: RandomSource): KeyPair {
  return keyPairFrom(random.bytes(KEY_BYTES));
}

/** Ce que chaque côté sait de l'autre avant l'échange. */
export type HandshakeMode =
  /** Première fois : secret lu dans le QR code. */
  | { kind: 'pair'; secret: Uint8Array }
  /** Téléphones déjà associés : clé d'association enregistrée. */
  | { kind: 'sync'; pairKey: Uint8Array };

export interface Hello {
  v: string;
  mode: 'pair' | 'sync';
  device: string;
  /** Clé d'identité de l'initiateur. */
  id: string;
  eph: string;
  /** Association : preuve de lecture du QR code. */
  proof?: string;
}

export interface Reply {
  device: string;
  eph: string;
  confirm: string;
}

export interface Finish {
  confirm: string;
}

const b = (text: unknown): Uint8Array => {
  if (typeof text !== 'string') {
    throw new SecureError('INVALID_MESSAGE', 'Champ manquant');
  }
  try {
    return fromBase64Url(text);
  } catch {
    throw new SecureError('INVALID_MESSAGE', 'Champ illisible');
  }
};

function key32(text: unknown): Uint8Array {
  const k = b(text);
  if (k.length !== KEY_BYTES) {
    throw new SecureError('INVALID_MESSAGE', 'Clé de longueur invalide');
  }
  return k;
}

function device(text: unknown): string {
  if (typeof text !== 'string' || !/^[0-9a-f]{1,32}$/.test(text)) {
    throw new SecureError('INVALID_MESSAGE', 'Appareil invalide');
  }
  return text;
}

/** Comparaison en temps constant. */
function sameBytes(x: Uint8Array, y: Uint8Array): boolean {
  if (x.length !== y.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < x.length; i++) {
    diff |= x[i] ^ y[i];
  }
  return diff === 0;
}

function dh(secretKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  const shared = x25519.getSharedSecret(secretKey, publicKey);
  // Clé publique « faible » (point d'ordre faible) : secret nul, refusé.
  if (shared.every(x => x === 0)) {
    throw new SecureError('AUTH_FAILED', 'Clé publique refusée');
  }
  return shared;
}

function transcript(hello: Hello, replyDevice: string, replyEph: string) {
  return sha256(
    utf8ToBytes(
      [
        PROTOCOL,
        hello.mode,
        hello.device,
        hello.id,
        hello.eph,
        hello.proof ?? '',
        replyDevice,
        replyEph,
      ].join('|'),
    ),
  );
}

interface Derived {
  initiatorToResponder: Uint8Array;
  responderToInitiator: Uint8Array;
  initiatorConfirm: Uint8Array;
  responderConfirm: Uint8Array;
  pairKey: Uint8Array;
}

function derive(ikm: Uint8Array, salt: Uint8Array, th: Uint8Array): Derived {
  const okm = hkdf(
    sha256,
    ikm,
    salt,
    concatBytes(utf8ToBytes(PROTOCOL), th),
    160,
  );
  wipe(ikm);
  return {
    initiatorToResponder: okm.slice(0, 32),
    responderToInitiator: okm.slice(32, 64),
    initiatorConfirm: okm.slice(64, 96),
    responderConfirm: okm.slice(96, 128),
    pairKey: okm.slice(128, 160),
  };
}

const saltOf = (mode: HandshakeMode) =>
  mode.kind === 'pair' ? mode.secret : mode.pairKey;

function pairProof(
  secret: Uint8Array,
  hello: Pick<Hello, 'device' | 'id' | 'eph'>,
) {
  return hmac(
    sha256,
    secret,
    utf8ToBytes(
      [PROTOCOL, 'pair', hello.device, hello.id, hello.eph].join('|'),
    ),
  );
}

// --- Session chiffrée -----------------------------------------------------

/** Canal établi : chiffre ce qui part, déchiffre et vérifie ce qui arrive. */
export class SecureSession {
  private sent = 0;
  private received = 0;

  constructor(
    private readonly sendKey: Uint8Array,
    private readonly receiveKey: Uint8Array,
    /** Clé d'association à enregistrer (après une association). */
    readonly pairKey: Uint8Array,
    /** Téléphone de l'autre côté et sa clé d'identité. */
    readonly peer: { device: string; identity: Uint8Array },
  ) {}

  private static nonce(counter: number): Uint8Array {
    const n = new Uint8Array(12);
    new DataView(n.buffer).setUint32(4, Math.floor(counter / 2 ** 32));
    new DataView(n.buffer).setUint32(8, counter >>> 0);
    return n;
  }

  /** Message chiffré (texte base64) pour un objet JSON. */
  seal(message: unknown): string {
    const counter = this.sent++;
    const aad = utf8ToBytes(`${PROTOCOL}|${counter}`);
    const box = chacha20poly1305(
      this.sendKey,
      SecureSession.nonce(counter),
      aad,
    );
    return toBase64Url(box.encrypt(utf8ToBytes(JSON.stringify(message))));
  }

  /** Déchiffre le message suivant ; refuse tout message altéré ou rejoué. */
  open(frame: string): unknown {
    const counter = this.received;
    const aad = utf8ToBytes(`${PROTOCOL}|${counter}`);
    const box = chacha20poly1305(
      this.receiveKey,
      SecureSession.nonce(counter),
      aad,
    );
    let plain: Uint8Array;
    try {
      plain = box.decrypt(b(frame));
    } catch (error) {
      if (error instanceof SecureError) {
        throw error;
      }
      throw new SecureError('TAMPERED', 'Message modifié ou rejoué');
    }
    this.received++;
    try {
      return JSON.parse(utf8ToText(plain));
    } catch {
      throw new SecureError('INVALID_MESSAGE', 'Contenu illisible');
    }
  }

  close(): void {
    wipe(this.sendKey, this.receiveKey);
  }
}

// --- Poignée de main ------------------------------------------------------

export interface Initiator {
  hello: Hello;
  /** À appeler avec la réponse de l'autre téléphone. */
  finish(reply: unknown): { finish: Finish; session: SecureSession };
}

/**
 * Côté qui se connecte : le téléphone qui a scanné le QR code (association)
 * ou n'importe lequel des deux ensuite. `peerIdentity` : clé d'identité
 * attendue de l'autre côté (lue dans le QR code ou enregistrée).
 */
export function initiate(options: {
  device: string;
  identity: KeyPair;
  peerIdentity: Uint8Array;
  mode: HandshakeMode;
  random: RandomSource;
}): Initiator {
  const eph = generateKeyPair(options.random);
  const base = {
    v: PROTOCOL,
    mode: options.mode.kind,
    device: options.device,
    id: toBase64Url(options.identity.publicKey),
    eph: toBase64Url(eph.publicKey),
  };
  const hello: Hello =
    options.mode.kind === 'pair'
      ? { ...base, proof: toBase64Url(pairProof(options.mode.secret, base)) }
      : base;

  return {
    hello,
    finish(input: unknown) {
      const reply = input as Partial<Reply>;
      const replyDevice = device(reply?.device);
      const replyEph = key32(reply?.eph);
      const th = transcript(hello, replyDevice, toBase64Url(replyEph));
      const keys = derive(
        concatBytes(
          dh(eph.secretKey, replyEph),
          dh(options.identity.secretKey, replyEph),
          dh(eph.secretKey, options.peerIdentity),
        ),
        saltOf(options.mode),
        th,
      );
      wipe(eph.secretKey);
      if (
        !sameBytes(b(reply?.confirm), hmac(sha256, keys.responderConfirm, th))
      ) {
        throw new SecureError(
          'AUTH_FAILED',
          'Ce n’est pas le téléphone attendu.',
        );
      }
      return {
        finish: {
          confirm: toBase64Url(hmac(sha256, keys.initiatorConfirm, th)),
        },
        session: new SecureSession(
          keys.initiatorToResponder,
          keys.responderToInitiator,
          keys.pairKey,
          { device: replyDevice, identity: options.peerIdentity },
        ),
      };
    },
  };
}

export interface Responder {
  reply: Reply;
  /** Téléphone qui se présente, avant vérification finale. */
  peer: { device: string; identity: Uint8Array };
  /** À appeler avec le dernier message de l'initiateur. */
  accept(finish: unknown): SecureSession;
}

/** Lecture du premier message, avant de savoir quelle clé utiliser. */
export function readHello(input: unknown): Hello {
  const h = input as Partial<Hello>;
  if (h?.v !== PROTOCOL) {
    throw new SecureError(
      'INVALID_MESSAGE',
      'Versions de Fenrir différentes : mettez les deux téléphones à jour.',
    );
  }
  if (h.mode !== 'pair' && h.mode !== 'sync') {
    throw new SecureError('INVALID_MESSAGE', 'Mode inconnu');
  }
  key32(h.id);
  key32(h.eph);
  if (h.mode === 'pair') {
    b(h.proof);
  }
  return {
    v: PROTOCOL,
    mode: h.mode,
    device: device(h.device),
    id: h.id as string,
    eph: h.eph as string,
    ...(h.mode === 'pair' ? { proof: h.proof as string } : {}),
  };
}

/**
 * Côté qui attend la connexion. `mode` dépend du premier message : secret
 * de l'invitation en cours (association) ou clé de l'appareil connu.
 * `expectedIdentity` : clé d'identité enregistrée de l'appareil (absente
 * pour une association, où elle est apprise et prouvée par le secret).
 */
export function respond(options: {
  device: string;
  identity: KeyPair;
  hello: Hello;
  mode: HandshakeMode;
  expectedIdentity?: Uint8Array;
  random: RandomSource;
}): Responder {
  const { hello, mode } = options;
  if (hello.mode !== mode.kind) {
    throw new SecureError('AUTH_FAILED', 'Mode inattendu');
  }
  const peerIdentity = key32(hello.id);
  if (mode.kind === 'pair') {
    if (!sameBytes(b(hello.proof), pairProof(mode.secret, hello))) {
      throw new SecureError(
        'AUTH_FAILED',
        'Code d’association invalide ou expiré : affichez un nouveau QR code.',
      );
    }
  } else if (
    !options.expectedIdentity ||
    !sameBytes(options.expectedIdentity, peerIdentity)
  ) {
    throw new SecureError('AUTH_FAILED', 'Téléphone inconnu.');
  }

  const eph = generateKeyPair(options.random);
  const replyEph = toBase64Url(eph.publicKey);
  const th = transcript(hello, options.device, replyEph);
  const helloEph = key32(hello.eph);
  const keys = derive(
    concatBytes(
      dh(eph.secretKey, helloEph),
      dh(eph.secretKey, peerIdentity),
      dh(options.identity.secretKey, helloEph),
    ),
    saltOf(mode),
    th,
  );
  wipe(eph.secretKey);
  const peer = { device: hello.device, identity: peerIdentity };

  return {
    reply: {
      device: options.device,
      eph: replyEph,
      confirm: toBase64Url(hmac(sha256, keys.responderConfirm, th)),
    },
    peer,
    accept(input: unknown) {
      const finish = input as Partial<Finish>;
      if (
        !sameBytes(b(finish?.confirm), hmac(sha256, keys.initiatorConfirm, th))
      ) {
        throw new SecureError(
          'AUTH_FAILED',
          'Ce n’est pas le téléphone attendu.',
        );
      }
      return new SecureSession(
        keys.responderToInitiator,
        keys.initiatorToResponder,
        keys.pairKey,
        peer,
      );
    },
  };
}
