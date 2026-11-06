/** Pure shared palette logic. No Chrome, DOM, or network dependencies. */
export const SHORTCUT_ALPHABET = '1234567890ABCDEFGHIJKLMNOPQRSUVWXYZ';

export function shortcutLabel(index) {
  if (!Number.isSafeInteger(index) || index < 0) return '';
  if (index < SHORTCUT_ALPHABET.length) return SHORTCUT_ALPHABET[index];
  let n = index - SHORTCUT_ALPHABET.length;
  // All single-character labels come first; longer labels use spreadsheet-like
  // base-36, starting at 11. The UI resolves an ambiguous prefix on key release.
  let length = 2;
  while (n >= SHORTCUT_ALPHABET.length ** length) {
    n -= SHORTCUT_ALPHABET.length ** length;
    length += 1;
  }
  let label = '';
  for (let i = 0; i < length; i++) {
    label = SHORTCUT_ALPHABET[n % SHORTCUT_ALPHABET.length] + label;
    n = Math.floor(n / SHORTCUT_ALPHABET.length);
  }
  return label;
}

export function normalizeText(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
}

export function displayDomain(url) {
  try {
    const value = new URL(url);
    if (value.protocol === 'file:') return 'Local file';
    if (value.protocol === 'chrome-extension:') return 'Extension';
    if (value.protocol === 'chrome:') return `Chrome · ${value.hostname}`;
    if (value.protocol === 'about:') return value.href;
    return value.hostname.replace(/^www\./i, '') || value.protocol.replace(':', '');
  } catch { return String(url ?? '').slice(0, 120); }
}

export function decorateTabs(tabs = []) {
  const seen = new Set();
  return tabs.filter(tab => {
    if (!tab || tab.id === undefined || tab.id === null || seen.has(String(tab.id))) return false;
    seen.add(String(tab.id));
    return true;
  }).map((tab, position) => ({
    ...tab,
    type: 'tab',
    tabId: tab.id,
    title: String(tab.title || displayDomain(tab.url) || 'Untitled tab'),
    url: String(tab.url || ''),
    domain: displayDomain(tab.url),
    shortcut: String(tab.shortcutLabel || tab.shortcut || shortcutLabel(position)).toUpperCase(),
    position,
  }));
}

export function filterTabs(tabs, query) {
  const tokens = normalizeText(query).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return tabs;
  return tabs.filter(tab => {
    const text = normalizeText(`${tab.title} ${tab.url} ${tab.groupTitle || ''}`);
    return tokens.every(token => text.includes(token));
  });
}

export function physicalShortcutCharacter(event) {
  const code = String(event.code || '');
  if (/^Digit[0-9]$/.test(code)) return code.slice(-1);
  if (/^Numpad[0-9]$/.test(code)) return code.slice(-1);
  if (/^Key[A-Z]$/.test(code)) return code.slice(-1);
  const key = String(event.key || '').toUpperCase();
  return /^[A-Z0-9]$/.test(key) ? key : '';
}

export function safeLocalFavicon(url) {
  // Never cause a third-party favicon request while looking through private tabs.
  return /^(chrome:\/\/_favicon\/|chrome-extension:\/\/[^/]+\/_favicon\/)/i.test(String(url || '')) ? url : null;
}

export function safeFaviconDataURL(value) {
  // Only already-cached raster PNGs cross the native bridge. Never load a tab's
  // remote favIconUrl, SVG payload, HTML, or arbitrary data URL in the palette.
  if (typeof value !== 'string' || value.length > 262144) return null;
  const prefix = 'data:image/png;base64,';
  if (!value.startsWith(prefix)) return null;
  const encoded = value.slice(prefix.length);
  if (encoded.length < 44 || encoded.length % 4 !== 0 || !/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null;
  return value;
}

export function navigationURL(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (/^about:blank$/i.test(text)) return 'about:blank';
  if (/^chrome:\/\/(settings|history|bookmarks|downloads|extensions|newtab|flags|version)(?:[/?#]|$)/i.test(text)) {
    try { return new URL(text).href; } catch { return null; }
  }
  const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(text);
  const hostWithPort = /^(?:[^:/?#\s]+\.)+[^:/?#\s]+:\d+(?:[/?#]|$)/.test(text);
  const explicitScheme = /^[a-z][a-z\d+.-]*:/i.test(text) && !localHost && !hostWithPort;
  if (explicitScheme && !/^(https?:|file:)/i.test(text)) return null;
  try {
    const url = new URL(explicitScheme ? text : `${localHost ? 'http' : 'https'}://${text}`);
    if (!['http:', 'https:', 'file:'].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    if (url.protocol !== 'file:') {
      if (!url.hostname) return null;
      // An explicit http(s) URL may name an intranet host. Bare words remain
      // search queries; a bare hostname needs a dot, localhost, or IPv6 syntax.
      if (!explicitScheme && !url.hostname.includes('.') && !['localhost', '[::1]'].includes(url.hostname)) return null;
      if (!explicitScheme && /\s/.test(text.split(/[/?#]/, 1)[0])) return null;
    }
    return url.href;
  } catch { return null; }
}

export function navigationIntent(value) {
  const query = String(value ?? '').trim();
  if (!query) return { type: 'empty' };
  const url = navigationURL(query);
  if (url) return { type: 'url', url };
  // Never silently send an explicit, unsupported URL to the search engine.
  const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(query);
  const hostWithPort = /^(?:[^:/?#\s]+\.)+[^:/?#\s]+:\d+(?:[/?#]|$)/.test(query);
  if (/^[a-z][a-z\d+.-]*:/i.test(query) && !localHost && !hostWithPort) {
    return { type: 'blocked', message: 'That URL cannot be opened here. Use a valid website address.' };
  }
  return { type: 'search', query };
}

export function completionCandidate(value, sources = []) {
  const typed = String(value ?? '');
  if (typed.length < 2 || typed !== typed.trim() || /[\s/:?#@]/.test(typed)) return null;
  if (navigationURL(typed)) return null;
  const needle = typed.toLowerCase();
  const seen = new Set();
  for (const source of sources) {
    try {
      const url = new URL(source.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
      const hostname = needle.startsWith('www.') ? url.hostname : url.hostname.replace(/^www\./i, '');
      const displayHost = `${hostname}${url.port ? `:${url.port}` : ''}`;
      if (seen.has(displayHost) || !displayHost.toLowerCase().startsWith(needle) || displayHost.length <= typed.length) continue;
      seen.add(displayHost);
      return { typed, display: `${typed}${displayHost.slice(typed.length)}`, url: `${url.protocol}//${url.host}/` };
    } catch { /* A malformed history entry is not an autocomplete candidate. */ }
  }
  return null;
}

export function directURLSuggestion(value, completion = null, sources = []) {
  const url = completion?.url || navigationURL(value);
  if (!url) return null;
  const matching = sources.find(source => source.url === url && source.title);
  const title = matching?.title || url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return normalizedSuggestion({ id: `url:${url}`, type: 'url', title, url, faviconDataUrl: matching?.faviconDataUrl }, 0);
}

export function selectionAfterUpdate(rows, previousKey, previousIndex = 0) {
  const matching = rows.findIndex(row => row.key === previousKey);
  if (matching >= 0) return matching;
  return rows.length ? Math.min(Math.max(previousIndex, 0), rows.length - 1) : -1;
}

export function normalizedSuggestion(item, index) {
  const type = ['history', 'bookmark', 'search', 'url'].includes(item.type) ? item.type : 'search';
  return {
    ...item,
    type,
    title: String(item.title || item.query || displayDomain(item.url) || 'Suggestion'),
    url: item.url ? String(item.url) : undefined,
    query: item.query ? String(item.query) : undefined,
    domain: item.url ? displayDomain(item.url) : '',
    key: `suggestion:${item.id ?? `${type}:${item.url || item.query || item.title}:${index}`}`,
  };
}
