/** Read browser-cached favicons only; no website or external favicon service is fetched. */
const PNG_PREFIX = [137, 80, 78, 71, 13, 10, 26, 10];
const encoder = new TextEncoder();

function pageIdentity(tab, hint = tab) {
  try {
    const page = new URL(tab.url || tab.pendingUrl || '');
    if (!['http:', 'https:', 'file:'].includes(page.protocol) || page.username || page.password || page.href.length > 16384) return null;
    return { pageUrl: page.href, key: JSON.stringify([page.href, String(hint?.favIconUrl || '')]) };
  } catch { return null; }
}

function pngDataURL(buffer, maxBytes) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 24 || bytes.length > maxBytes || !PNG_PREFIX.every((value, i) => bytes[i] === value)) return null;
  // Chrome's favicon route returns PNGs. Reject malformed/oversized content
  // rather than passing arbitrary cached image formats into the native panel.
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width > 128 || height > 128) return null;
  const data = `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
  return data.length <= maxBytes ? data : null;
}

export function createFaviconLoader({
  getURL = path => chrome.runtime.getURL(path),
  fetchImpl = (...args) => fetch(...args),
  now = () => Date.now(),
  timeoutMs = 1000,
  maxEntries = 200,
  concurrency = 8,
  maxIconBytes = 8192,
  maxSnapshotBytes = 600_000,
} = {}) {
  timeoutMs = Math.max(1, Math.min(1000, timeoutMs));
  maxEntries = Math.max(1, Math.min(200, maxEntries));
  concurrency = Math.max(1, Math.min(8, concurrency));
  maxIconBytes = Math.max(1, Math.min(8192, maxIconBytes));
  maxSnapshotBytes = Math.max(0, Math.min(600_000, maxSnapshotBytes));
  const cache = new Map(), inFlight = new Map(), batches = new Map(), waiting = [];
  let active = 0;

  function acquire() {
    if (active < concurrency) { active++; return Promise.resolve(); }
    return new Promise(resolve => waiting.push(resolve));
  }
  function release() {
    // Transfer an occupied permit directly, avoiding a race with new callers.
    if (waiting.length) waiting.shift()();
    else active--;
  }
  function remember(key, value) {
    cache.delete(key);
    cache.set(key, { value, expires: now() + (value ? 5 * 60_000 : 15_000) });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  }

  async function fetchIcon(pageUrl) {
    const controller = new AbortController();
    let timer;
    const expired = new Promise(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs);
    });
    try {
      const endpoint = new URL(getURL('_favicon/'));
      if (endpoint.protocol !== 'chrome-extension:' || !endpoint.hostname || endpoint.pathname !== '/_favicon/') return null;
      endpoint.searchParams.set('pageUrl', pageUrl);
      endpoint.searchParams.set('size', '32');
      const read = (async () => {
        try {
          const response = await fetchImpl(endpoint.href, {
            signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
          });
          if (!response.ok) return null;
          const declared = Number(response.headers?.get('content-length'));
          if (declared > maxIconBytes) return null;
          return pngDataURL(await response.arrayBuffer(), maxIconBytes);
        } catch { return null; }
      })();
      return await Promise.race([read, expired]);
    } catch { return null; }
    finally { clearTimeout(timer); }
  }

  function iconFor(identity) {
    if (!identity) return Promise.resolve(null);
    const hit = cache.get(identity.key);
    if (hit && hit.expires > now()) {
      cache.delete(identity.key); cache.set(identity.key, hit);
      return Promise.resolve(hit.value);
    }
    cache.delete(identity.key);
    if (inFlight.has(identity.key)) return inFlight.get(identity.key);
    const pending = (async () => {
      await acquire();
      try {
        const value = await fetchIcon(identity.pageUrl);
        remember(identity.key, value);
        return value;
      } finally { release(); }
    })();
    inFlight.set(identity.key, pending);
    pending.finally(() => inFlight.delete(identity.key));
    return pending;
  }

  async function populate(identities) {
    const values = Array(identities.length).fill(null);
    let cursor = 0;
    const deadline = Date.now() + timeoutMs + 50;
    async function worker() {
      while (cursor < identities.length && Date.now() < deadline) {
        const index = cursor++;
        values[index] = await iconFor(identities[index]);
      }
    }
    // Only eight workers exist even for hundreds of tabs. A slow/unavailable
    // favicon service also cannot delay the whole snapshot by N timeouts.
    await Promise.all(Array.from({ length: Math.min(concurrency, identities.length) }, worker));
    return values;
  }

  async function loadTabs(tabs, hints = tabs) {
    const identities = tabs.map((tab, i) => pageIdentity(tab, hints[i]));
    const key = JSON.stringify(identities.map(value => value?.key ?? null));
    let batch = batches.get(key);
    if (!batch) {
      batch = populate(identities);
      batches.set(key, batch);
      batch.finally(() => { if (batches.get(key) === batch) batches.delete(key); });
    }
    const values = await batch;
    // Leave headroom for the native-message envelope and faviconDataUrl keys.
    // If unusually large tab metadata consumes the budget, send no icons.
    let remaining = maxSnapshotBytes - encoder.encode(JSON.stringify(tabs)).length - 16_384 - tabs.length * 32;
    return values.map(value => {
      if (!value || value.length > remaining) return null;
      remaining -= value.length;
      return value;
    });
  }

  return { loadTabs };
}

const defaultLoader = createFaviconLoader();
export const getTabFavicons = (tabs, hints) => defaultLoader.loadTabs(tabs, hints);
