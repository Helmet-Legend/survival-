/**
 * Canal de messages texte entre deux téléphones (connexion TCP du module
 * natif, ou paire en mémoire pour les tests). Les messages arrivent dans
 * l'ordre ; `receive` attend le suivant.
 */
export interface Channel {
  send(text: string): Promise<void>;
  /** Message suivant ; rejette si la connexion se ferme ou après `timeoutMs`. */
  receive(timeoutMs?: number): Promise<string>;
  close(): void;
}

export class ChannelClosedError extends Error {
  constructor(message = 'Connexion fermée') {
    super(message);
    this.name = 'ChannelClosedError';
  }
}

/** File d'attente : relie des messages poussés à des `receive` en attente. */
export class MessageQueue {
  private readonly items: string[] = [];
  private readonly waiting: {
    resolve: (text: string) => void;
    reject: (error: Error) => void;
  }[] = [];
  private closed: Error | null = null;

  push(text: string): void {
    const waiter = this.waiting.shift();
    if (waiter) {
      waiter.resolve(text);
    } else {
      this.items.push(text);
    }
  }

  fail(error: Error): void {
    this.closed = error;
    for (const waiter of this.waiting.splice(0)) {
      waiter.reject(error);
    }
  }

  next(timeoutMs = 60_000): Promise<string> {
    const item = this.items.shift();
    if (item !== undefined) {
      return Promise.resolve(item);
    }
    if (this.closed) {
      return Promise.reject(this.closed);
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: (text: string) => {
          clearTimeout(timer);
          resolve(text);
        },
        reject: (error: Error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      const timer = setTimeout(() => {
        const i = this.waiting.indexOf(waiter);
        if (i >= 0) {
          this.waiting.splice(i, 1);
        }
        reject(new ChannelClosedError('L’autre téléphone ne répond plus.'));
      }, timeoutMs);
      this.waiting.push(waiter);
    });
  }
}

/** Deux bouts reliés en mémoire (tests, aperçu). */
export function memoryChannelPair(): [Channel, Channel] {
  const queues = [new MessageQueue(), new MessageQueue()];
  const end = (mine: MessageQueue, theirs: MessageQueue): Channel => ({
    send: async text => {
      theirs.push(text);
    },
    receive: timeoutMs => mine.next(timeoutMs),
    close: () => {
      mine.fail(new ChannelClosedError());
      theirs.fail(new ChannelClosedError());
    },
  });
  return [end(queues[0], queues[1]), end(queues[1], queues[0])];
}
