/**
 * Liaison réseau locale entre deux téléphones (module natif Android
 * `ResiliosNet`) : écoute, connexion, découverte sur le Wi-Fi. Absente sur
 * iOS, dans les tests et l'aperçu web.
 *
 * Les messages qui passent ici sont déjà chiffrés par `src/sync/secure.ts`.
 */
import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

import {
  ChannelClosedError,
  MessageQueue,
  type Channel,
} from '../sync/channel';

export interface FoundPeer {
  name: string;
  host: string;
  port: number;
}

export interface LocalNetwork {
  available: boolean;
  /** Écoute les connexions ; `onChannel` reçoit chaque téléphone qui se connecte. */
  listen(onChannel: (channel: Channel) => void): Promise<{
    port: number;
    stop(): void;
  }>;
  connect(host: string, port: number): Promise<Channel>;
  /** Annonce ce téléphone sur le Wi-Fi sous un nom neutre. */
  advertise(name: string, port: number): Promise<() => void>;
  /** Cherche les téléphones qui s'annoncent. */
  discover(onFound: (peer: FoundPeer) => void): Promise<() => void>;
  /** Adresses IPv4 locales (Wi-Fi, partage de connexion). */
  addresses(): Promise<string[]>;
}

interface NativeNet {
  startServer(): Promise<number>;
  stopServer(): void;
  connect(host: string, port: number): Promise<number>;
  send(id: number, text: string): Promise<void>;
  close(id: number): void;
  advertise(name: string, port: number): Promise<string>;
  stopAdvertise(): void;
  discover(): Promise<void>;
  stopDiscovery(): void;
  localAddresses(): Promise<string[]>;
}

type NetEvent =
  | { type: 'open'; id: number; incoming: boolean }
  | { type: 'message'; id: number; text: string }
  | { type: 'close'; id: number; error?: string }
  | { type: 'found'; name: string; host: string; port: number };

const EVENT = 'ResiliosNet';

const UNAVAILABLE: LocalNetwork = {
  available: false,
  listen: async () => {
    throw new Error('Réseau local indisponible sur cet appareil');
  },
  connect: async () => {
    throw new Error('Réseau local indisponible sur cet appareil');
  },
  advertise: async () => () => undefined,
  discover: async () => () => undefined,
  addresses: async () => [],
};

export function nativeNetwork(): LocalNetwork {
  const native =
    Platform.OS === 'android'
      ? (NativeModules.ResiliosNet as NativeNet | undefined)
      : undefined;
  if (native === undefined) {
    return UNAVAILABLE;
  }

  // Une file de messages par connexion, alimentée par les évènements natifs.
  const queues = new Map<number, MessageQueue>();
  const queueOf = (id: number) => {
    let q = queues.get(id);
    if (!q) {
      q = new MessageQueue();
      queues.set(id, q);
    }
    return q;
  };
  let onIncoming: ((channel: Channel) => void) | null = null;
  let onFound: ((peer: FoundPeer) => void) | null = null;

  const channelFor = (id: number): Channel => ({
    send: text => native.send(id, text),
    receive: timeoutMs => queueOf(id).next(timeoutMs),
    close: () => {
      native.close(id);
      queueOf(id).fail(new ChannelClosedError());
      queues.delete(id);
    },
  });

  DeviceEventEmitter.addListener(EVENT, (event: NetEvent) => {
    switch (event.type) {
      case 'open':
        queueOf(event.id);
        if (event.incoming) {
          if (onIncoming) {
            onIncoming(channelFor(event.id));
          } else {
            native.close(event.id);
          }
        }
        break;
      case 'message':
        queueOf(event.id).push(event.text);
        break;
      case 'close':
        queueOf(event.id).fail(
          new ChannelClosedError(
            event.error
              ? `Connexion interrompue : ${event.error}`
              : 'L’autre téléphone a fermé la connexion.',
          ),
        );
        break;
      case 'found':
        onFound?.({ name: event.name, host: event.host, port: event.port });
        break;
    }
  });

  return {
    available: true,
    listen: async handler => {
      onIncoming = handler;
      const port = await native.startServer();
      return {
        port,
        stop: () => {
          onIncoming = null;
          native.stopServer();
        },
      };
    },
    connect: async (host, port) => channelFor(await native.connect(host, port)),
    advertise: async (name, port) => {
      await native.advertise(name, port);
      return () => native.stopAdvertise();
    },
    discover: async handler => {
      onFound = handler;
      await native.discover();
      return () => {
        onFound = null;
        native.stopDiscovery();
      };
    },
    addresses: async () => {
      try {
        return await native.localAddresses();
      } catch {
        return [];
      }
    },
  };
}
