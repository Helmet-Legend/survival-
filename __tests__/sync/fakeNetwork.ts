/** Faux Wi-Fi local pour les tests : plusieurs téléphones, connexions en mémoire. */
import type { FoundPeer, LocalNetwork } from '../../src/device/net';
import { memoryChannelPair, type Channel } from '../../src/sync';

export class FakeWifi {
  private readonly servers = new Map<string, (channel: Channel) => void>();
  private readonly ads = new Map<string, FoundPeer>();
  private readonly watchers = new Set<(peer: FoundPeer) => void>();
  private nextPort = 40000;

  phone(host: string): LocalNetwork {
    return {
      available: true,
      listen: async onChannel => {
        const port = this.nextPort++;
        const key = `${host}:${port}`;
        this.servers.set(key, onChannel);
        return { port, stop: () => this.servers.delete(key) };
      },
      connect: async (h, port) => {
        const handler = this.servers.get(`${h}:${port}`);
        if (!handler) {
          throw new Error('Connection refused');
        }
        const [mine, theirs] = memoryChannelPair();
        handler(theirs);
        return mine;
      },
      advertise: async (name, port) => {
        const peer = { name, host, port };
        this.ads.set(name, peer);
        this.watchers.forEach(w => w(peer));
        return () => this.ads.delete(name);
      },
      discover: async onFound => {
        this.watchers.add(onFound);
        this.ads.forEach(ad => onFound(ad));
        return () => this.watchers.delete(onFound);
      },
      addresses: async () => [host],
    };
  }
}
