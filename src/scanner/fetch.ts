import type { ProductFetch } from './products';

const TIMEOUT_MS = 8000;

/** `fetch` avec délai maximal : un réseau qui ne répond pas vaut hors ligne. */
export const defaultProductFetch: ProductFetch = async (url, init) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Délai dépassé')), TIMEOUT_MS);
  });
  try {
    return await Promise.race([fetch(url, init), timeout]);
  } finally {
    clearTimeout(timer);
  }
};
