import {
  decorateTabs, filterTabs, displayDomain, normalizedSuggestion,
  physicalShortcutCharacter, selectionAfterUpdate,
  safeFaviconDataURL, navigationURL, navigationIntent, completionCandidate, directURLSuggestion,
} from './core.mjs';

const $ = id => document.getElementById(id);
const input = $('query');
const results = $('results');
const scroll = $('results-scroll');
const params = new URLSearchParams(location.search);
const isDemo = params.get('demo') === '1';
const nativeBridge = window.webkit?.messageHandlers?.palette;
const configuredMode = window.TAB_PALETTE_MODE || params.get('mode');
const isNative = configuredMode === 'native' || Boolean(nativeBridge);
let mode = isNative ? 'native' : 'extension';
let modifier = isNative ? '⌘' : '⌥';
let tabs = [];
let suggestions = [];
let rows = [];
let selected = -1;
let loading = true;
let searching = false;
let executing = false;
let searchVersion = 0;
let debounceTimer;
let announceTimer;
let requestCounter = 0;
let shortcutBuffer = '';
let shortcutTimer;
let sourceWindowId;
let paletteGeneration = 0;
let typedQuery = '';
let inlineCompletion = null;
let completionSuppressed = false;
let selectionExplicit = false;
const pending = new Map();
const GROUP_COLORS = { blue: '#8cafff', purple: '#b6a1ef', pink: '#dba8cb', red: '#d89494', orange: '#d7ad82', yellow: '#d4c984', green: '#99c5a4', cyan: '#8cc5cf', grey: '#a2a6b2', gray: '#a2a6b2' };

document.body.dataset.mode = mode;

const demoTabs = [
  ['GitHub', 'https://github.com/', '', true],
  ['Linear — Product roadmap', 'https://linear.app/', 'Product', false],
  ['Vercel Dashboard', 'https://vercel.com/', 'Development', false],
  ['Interface kit — Figma', 'https://figma.com/', 'Design', false],
  ['Supabase Dashboard', 'https://supabase.com/dashboard', 'Development', false],
  ['Local development', 'http://localhost:3000/', 'Development', false],
  ['MDN Web Docs', 'https://developer.mozilla.org/', 'Development', false],
  ['Product notes — Notion', 'https://www.notion.so/', 'Product', false],
  ['Stripe Dashboard', 'https://dashboard.stripe.com/', 'Product', false],
  ['Redis Cloud', 'https://cloud.redis.io/', 'Development', false],
  ['Docker Docs', 'https://docs.docker.com/', 'Development', false],
  ['Hacker News', 'https://news.ycombinator.com/', '', false],
  ['Chrome for Developers', 'https://developer.chrome.com/', '', false],
  ['Web Platform Status', 'https://webstatus.dev/', '', false],
].map(([title, url, groupTitle, active], index) => ({ id: index + 1, index, windowId: 1, title, url, groupTitle, active, groupColor: groupTitle === 'Product' ? 'purple' : groupTitle === 'Development' ? 'green' : 'blue' }));

function demoSearch(query) {
  const q = query.trim();
  if (!q) return [];
  const fixtures = [
    { id: 'd-h1', type: 'history', title: 'Twitter. It’s what’s happening / X', url: 'https://twitter.com/' },
    { id: 'd-b1', type: 'bookmark', title: 'Twist — Async team communication', url: 'https://twist.com/' },
    { id: 'd-h2', type: 'history', title: 'Design inspiration and portfolios', url: 'https://www.designspiration.com/' },
    { id: 'd-b2', type: 'bookmark', title: 'Chrome Extensions — Documentation', url: 'https://developer.chrome.com/docs/extensions/' },
  ].filter(item => `${item.title} ${item.url}`.toLowerCase().includes(q.toLowerCase()));
  return [
    { id: 'd-search', type: 'search', title: `Search the web for “${q}”`, query: q },
    ...fixtures,
    { id: 'd-suggest1', type: 'search', title: `${q} inspiration`, query: `${q} inspiration` },
    { id: 'd-suggest2', type: 'search', title: `${q} examples`, query: `${q} examples` },
  ];
}

async function request(message) {
  if (isDemo) {
    if (message.type === 'snapshot') return { tabs: demoTabs, mode, shortcutModifier: modifier };
    if (message.type === 'search') return { requestId: message.requestId, suggestions: demoSearch(message.query) };
    return { ok: true };
  }
  if (isNative && nativeBridge) {
    // A snapshot and the first search can overlap. Transport IDs must not
    // collide with the search-version counter or native unsolicited requests.
    const requestId = `ui-${++requestCounter}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(message.type === 'search' ? 'Suggestions are taking a little longer. Try again.' : 'The browser connection is unavailable. Open Chrome and try again.'));
      }, 7000);
      pending.set(requestId, { resolve, reject, timeout, type: message.type });
      nativeBridge.postMessage({ ...message, requestId });
    });
  }
  if (globalThis.chrome?.runtime?.sendMessage) return chrome.runtime.sendMessage(message);
  throw new Error('Open this palette from the Chrome extension.');
}

function unwrapResponse(response) {
  return response?.payload ?? response?.data ?? response;
}

function receive(response) {
  if (!response || typeof response !== 'object') return;
  const record = pending.get(response.requestId);
  if (record) {
    clearTimeout(record.timeout);
    pending.delete(response.requestId);
    if (response.type === 'error' || response.error) record.reject(new Error(response.error?.message || response.error || response.payload?.message || 'The browser connection could not complete that action.'));
    else record.resolve(unwrapResponse(response));
    return;
  }
  if (response.type === 'snapshot' || response.type === 'show') {
    const snapshot = unwrapResponse(response);
    // Native hosts can push a fresh snapshot whenever the panel is shown.
    for (const [id, waiting] of pending) {
      if (waiting.type !== 'snapshot') continue;
      clearTimeout(waiting.timeout); pending.delete(id); waiting.resolve(snapshot);
    }
    if (response.type === 'show') resetPalette();
    applySnapshot(snapshot);
  } else if (response.type === 'search') {
    // Accept native push-style results if the native bridge does not echo IDs.
    const payload = unwrapResponse(response);
    if (payload.query === typedQuery.trim()) {
      searching = false;
      suggestions = (payload.suggestions || []).map(normalizedSuggestion);
      maybeCompleteInput();
      render();
    }
  } else if (response.type === 'error') showError(response.error || response.payload?.message || 'Something went wrong. Please try again.');
}

window.paletteReceive = receive;
window.addEventListener('palette-response', event => receive(event.detail));
window.addEventListener('palette-open', () => { resetPalette(); loadSnapshot(); });
window.paletteShow = snapshot => { resetPalette(); if (snapshot) applySnapshot(snapshot); else loadSnapshot(); };
window.paletteFocus = () => { input.focus(); input.select(); };

function resetPalette() {
  paletteGeneration++;
  clearTimeout(debounceTimer); clearTimeout(shortcutTimer);
  input.value = ''; typedQuery = ''; inlineCompletion = null; completionSuppressed = false; selectionExplicit = false;
  suggestions = []; selected = 0; shortcutBuffer = '';
  searchVersion++; executing = false; searching = false;
  document.body.dataset.executing = 'false';
  $('error-banner').hidden = true;
  $('keyboard-help').hidden = true;
  $('help-button').setAttribute('aria-expanded', 'false');
  render(); input.focus();
}

function applySnapshot(snapshot) {
  if (!snapshot) return;
  const content = snapshot.snapshot || snapshot;
  if (Number.isInteger(content.sourceWindowId)) sourceWindowId = content.sourceWindowId;
  tabs = decorateTabs(content.tabs || []);
  if (content.mode) mode = content.mode;
  modifier = content.shortcutModifier || (mode === 'native' ? '⌘' : '⌥');
  document.body.dataset.mode = mode;
  $('help-modifier').textContent = modifier;
  loading = false;
  $('error-banner').hidden = true;
  maybeCompleteInput();
  render();
}

async function loadSnapshot() {
  loading = tabs.length === 0; render();
  try {
    const snapshot = unwrapResponse(await request({ type: 'snapshot' }));
    if (snapshot?.error) throw new Error(snapshot.error);
    applySnapshot(snapshot);
  } catch (error) {
    loading = false; render(); showError(error.message);
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(type) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const paths = {
    search: ['M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z', 'm15.3 15.3 4.5 4.5'],
    history: ['M3 11a9 9 0 1 1 2.6 7.2', 'M3 5v6h6', 'M12 7v5l3 2'],
    bookmark: ['M6 3h12v18l-6-4-6 4V3Z'],
    url: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M3 12h18', 'M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z'],
  };
  for (const d of paths[type] || paths.search) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', d); svg.append(path);
  }
  return svg;
}

function titleWithMatches(text, query) {
  const fragment = document.createDocumentFragment();
  const tokens = query.trim().split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!tokens.length) { fragment.append(document.createTextNode(text)); return fragment; }
  const lower = text.toLocaleLowerCase();
  const ranges = [];
  for (const token of tokens) {
    let at = lower.indexOf(token.toLocaleLowerCase());
    while (at >= 0) { ranges.push([at, at + token.length]); at = lower.indexOf(token.toLocaleLowerCase(), at + token.length); }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let cursor = 0;
  for (const [from, to] of ranges) {
    if (from < cursor) continue;
    if (from > cursor) fragment.append(document.createTextNode(text.slice(cursor, from)));
    fragment.append(element('mark', '', text.slice(from, to))); cursor = to;
  }
  if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
  return fragment;
}

function maybeCompleteInput() {
  if (completionSuppressed || !typedQuery || document.activeElement !== input) return;
  if (!inlineCompletion && (input.selectionStart !== input.value.length || input.selectionEnd !== input.value.length)) return;
  const candidate = completionCandidate(typedQuery, [...tabs, ...suggestions]);
  if (!candidate) return;
  inlineCompletion = candidate;
  input.value = candidate.display;
  input.setSelectionRange(typedQuery.length, candidate.display.length);
}

function currentSuggestionRows() {
  if (!typedQuery.trim() || navigationIntent(typedQuery).type === 'blocked') return [];
  const direct = directURLSuggestion(typedQuery, inlineCompletion, [...tabs, ...suggestions]);
  const items = direct ? [direct] : [];
  for (const item of suggestions) {
    if (direct && item.url === direct.url) continue;
    if (items.some(previous => previous.key === item.key || (item.type === 'search' && previous.type === 'search' && previous.query === item.query))) continue;
    items.push(item);
  }
  if (!items.some(item => item.type === 'search' && item.query === typedQuery.trim())) {
    items.push(normalizedSuggestion({ id: `search:${typedQuery.trim()}`, type: 'search', title: `Search for “${typedQuery.trim()}”`, query: typedQuery.trim() }, items.length));
  }
  return items;
}

function rowElement(item, index) {
  const row = element('div', 'result');
  row.id = `result-${index}`;
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', String(index === selected));
  row.dataset.row = String(index);
  row.title = item.type === 'tab' ? `${item.title}\n${item.url}` : item.url || item.title;
  const rowIcon = element('div', `row-icon ${item.type === 'tab' ? 'tab-icon' : ''}`);
  rowIcon.setAttribute('aria-hidden', 'true');
  const cachedFavicon = safeFaviconDataURL(item.faviconDataUrl);
  if (cachedFavicon) {
    const image = element('img', 'site-favicon'); image.alt = ''; image.src = cachedFavicon;
    image.addEventListener('error', () => rowIcon.replaceChildren(icon('url')), { once: true });
    rowIcon.append(image);
  } else rowIcon.append(icon(item.type === 'tab' ? 'url' : item.type));
  const copy = element('div', 'row-copy');
  const titleLine = element('div', 'row-title-line');
  const title = element('span', 'row-title'); title.append(titleWithMatches(item.title, typedQuery)); titleLine.append(title);
  if (item.type === 'tab' && item.active) titleLine.append(element('span', 'current-tag', 'Current'));
  if (item.domain) titleLine.append(element('span', 'row-separator', '—'), element('span', 'row-domain', item.domain));
  if (item.groupTitle) {
    const dot = element('span', 'group-dot'); dot.style.background = GROUP_COLORS[item.groupColor] || '#a1a8ba';
    titleLine.append(dot, element('span', 'row-group', item.groupTitle));
  }
  copy.append(titleLine);
  row.append(rowIcon, copy);
  if (item.type === 'tab') {
    const shortcut = element('span', 'shortcut'); shortcut.setAttribute('aria-hidden', 'true');
    shortcut.append(element('kbd', 'shortcut-modifier', modifier), element('kbd', '', item.shortcut)); row.append(shortcut);
    row.setAttribute('aria-label', `${item.title}, ${item.domain}${item.groupTitle ? `, ${item.groupTitle}` : ''}, ${modifier} ${item.shortcut}${item.active ? ', current tab' : ''}`);
  } else row.append(element('span', 'row-kind', { history: 'History', bookmark: 'Bookmark', search: 'Search', url: 'Website' }[item.type]));
  row.addEventListener('pointermove', event => { if (event.movementX || event.movementY) setSelected(index, false); });
  row.addEventListener('mousedown', event => event.preventDefault());
  row.addEventListener('click', event => { setSelected(index, false); executeSelected(event.shiftKey ? 'new' : 'current'); });
  return row;
}

function sectionHeader(title, count, trailing = '') {
  const label = element('div', `section-label ${title === 'Suggestions' ? 'suggestions-label' : ''}`);
  label.setAttribute('role', 'presentation');
  label.append(element('span', '', title), element('span', 'section-count', String(count)));
  if (trailing) label.append(element('span', 'section-trailing', trailing));
  return label;
}

function render() {
  const previousKey = rows[selected]?.key;
  const matched = filterTabs(tabs, typedQuery).map(tab => ({ ...tab, key: `tab:${tab.id}` }));
  const suggestionRows = currentSuggestionRows();
  rows = [...matched, ...suggestionRows];
  const defaultURL = directURLSuggestion(typedQuery, inlineCompletion, [...tabs, ...suggestions]);
  selected = selectionExplicit ? selectionAfterUpdate(rows, previousKey, selected) : defaultURL ? rows.findIndex(row => row.key === defaultURL.key) : rows.length ? 0 : -1;
  const content = document.createDocumentFragment();
  if (matched.length) {
    content.append(sectionHeader(typedQuery.trim() ? 'Matching tabs' : 'Open tabs', matched.length, typedQuery.trim() ? '' : `${modifier} + shortcut`));
    matched.forEach((item, index) => content.append(rowElement(item, index)));
  }
  if (suggestionRows.length && typedQuery.trim()) {
    content.append(sectionHeader('Suggestions', suggestionRows.length));
    suggestionRows.forEach((item, index) => content.append(rowElement(item, matched.length + index)));
  }
  results.replaceChildren(content);
  $('empty-state').hidden = rows.length > 0;
  if (loading) {
    $('empty-title').textContent = 'Getting your tabs…';
    $('empty-description').textContent = 'Your open tabs will appear here in browser order.';
  } else if (searching) {
    $('empty-title').textContent = 'Looking for matches…';
    $('empty-description').textContent = 'Searching your tabs, bookmarks, and history.';
  } else {
    const blocked = navigationIntent(typedQuery).type === 'blocked';
    $('empty-title').textContent = blocked ? 'That address is not supported' : typedQuery.trim() ? 'No matches yet' : 'No open tabs';
    $('empty-description').textContent = blocked ? 'Use a valid website address. This input will not be sent to search.' : typedQuery.trim() ? 'Try a title, website, or a different search.' : 'Start typing to search the web or open a website.';
  }
  document.body.dataset.busy = String(loading || searching);
  $('status').textContent = shortcutBuffer ? `${modifier} ${shortcutBuffer}…` : loading ? 'Loading tabs' : searching ? 'Searching…' : `${matched.length} ${matched.length === 1 ? 'tab' : 'tabs'}${typedQuery.trim() && suggestionRows.length ? ` · ${suggestionRows.length} suggestions` : ''}`;
  updateSelectionDetails();
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => { $('announcer').textContent = loading ? 'Loading tabs' : `${matched.length} matching tabs${suggestionRows.length && typedQuery.trim() ? ` and ${suggestionRows.length} suggestions` : ''}`; }, 250);
}

function updateSelectionDetails() {
  const item = rows[selected];
  if (item) input.setAttribute('aria-activedescendant', `result-${selected}`);
  else input.removeAttribute('aria-activedescendant');
  $('action-label').textContent = !item || item.type === 'tab' ? 'Switch tab' : item.type === 'search' ? 'Search the web' : 'Open page';
  $('action-symbol').textContent = !item || item.type === 'tab' ? '⇥' : item.type === 'search' ? '⌕' : '↗';
}

function setSelected(index, shouldScroll = true) {
  if (!rows.length) return;
  selectionExplicit = true;
  const next = (index + rows.length) % rows.length;
  if (selected !== next) {
    document.getElementById(`result-${selected}`)?.setAttribute('aria-selected', 'false');
    selected = next;
    const node = document.getElementById(`result-${selected}`); node?.setAttribute('aria-selected', 'true');
    updateSelectionDetails();
  }
  if (shouldScroll) document.getElementById(`result-${selected}`)?.scrollIntoView({ block: 'nearest' });
}

function showError(message) {
  $('error-banner').textContent = String(message || 'Something went wrong. Please try again.');
  $('error-banner').hidden = false;
  $('announcer').textContent = $('error-banner').textContent;
}

async function executeItem(item, disposition = 'current') {
  if (!item || executing) return;
  executing = true; document.body.dataset.executing = 'true';
  const generation = paletteGeneration;
  $('error-banner').hidden = true;
  try {
    const outgoing = item.type === 'tab' ? { type: 'tab', tabId: item.tabId } : { id: item.id, type: item.type, title: item.title, url: item.url, query: item.query };
    const result = await request({ type: 'execute', item: outgoing, disposition, sourceWindowId });
    if (generation !== paletteGeneration) return;
    if (result?.error) throw new Error(result.error);
    if (isDemo) {
      $('status').textContent = `${item.type === 'tab' ? 'Switched to' : 'Opened'} ${item.title}`;
      $('announcer').textContent = $('status').textContent;
    }
  } catch (error) { if (generation === paletteGeneration) showError(error.message); }
  finally { if (generation === paletteGeneration) { executing = false; document.body.dataset.executing = 'false'; } }
}

function executeSelected(disposition = 'current') {
  if (!selectionExplicit) {
    const direct = directURLSuggestion(typedQuery, inlineCompletion, [...tabs, ...suggestions]);
    if (direct) return executeItem(direct, disposition);
    const intent = navigationIntent(typedQuery);
    if (intent.type === 'blocked') { showError(intent.message); return; }
  }
  const selectedItem = rows[selected];
  if (selectedItem) return executeItem(selectedItem, disposition);
  const query = typedQuery.trim();
  const intent = navigationIntent(query);
  if (intent.type === 'blocked') { showError(intent.message); return; }
  if (intent.type === 'url') return executeItem({ type: 'url', title: query, url: intent.url }, disposition);
  if (query) return executeItem({ type: 'search', title: query, query }, disposition);
}

async function closePalette() {
  if (isDemo) { $('announcer').textContent = 'Palette closed'; $('status').textContent = 'Press any key to continue'; input.blur(); return; }
  try { await request({ type: 'close' }); }
  catch { window.close(); }
}

function clearShortcut() {
  clearTimeout(shortcutTimer); shortcutBuffer = ''; render();
}

function handleShortcut(event) {
  const held = mode === 'native' ? event.metaKey : event.altKey && !event.metaKey;
  if (!held || event.ctrlKey || event.shiftKey || event.isComposing) return false;
  const character = physicalShortcutCharacter(event);
  if (!character) return false;
  event.preventDefault(); event.stopPropagation();
  clearTimeout(shortcutTimer);
  const next = shortcutBuffer + character;
  const candidates = tabs.filter(tab => tab.shortcut.startsWith(next));
  if (!candidates.length) {
    shortcutBuffer = '';
    $('announcer').textContent = `No tab has shortcut ${next}`;
    render(); return true;
  }
  shortcutBuffer = next;
  const exact = candidates.find(tab => tab.shortcut === next);
  const longer = candidates.some(tab => tab.shortcut.length > next.length);
  if (exact && !longer) { shortcutBuffer = ''; executeItem(exact); }
  else {
    render();
    shortcutTimer = setTimeout(() => {
      if (exact) executeItem(exact);
      clearShortcut();
    }, 650);
  }
  return true;
}

document.addEventListener('keydown', event => {
  if ((mode === 'native' ? event.metaKey : event.altKey && !event.metaKey) && physicalShortcutCharacter(event) === 'T') {
    event.preventDefault(); event.stopPropagation(); closePalette(); return;
  }
  if (handleShortcut(event)) return;
  if (event.isComposing) return;
  if (inlineCompletion && document.activeElement === input && !event.metaKey && !event.ctrlKey && !event.altKey) {
    if (['ArrowRight', 'End', 'Tab'].includes(event.key)) {
      event.preventDefault(); input.value = inlineCompletion.display;
      queryChanged(null, true); input.setSelectionRange(input.value.length, input.value.length); return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault(); input.value = typedQuery; inlineCompletion = null; completionSuppressed = true;
      input.setSelectionRange(typedQuery.length, typedQuery.length); render(); return;
    }
  }
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation();
    if (!$('keyboard-help').hidden) { $('keyboard-help').hidden = true; $('help-button').setAttribute('aria-expanded', 'false'); input.focus(); }
    else if (shortcutBuffer) clearShortcut();
    else closePalette();
    return;
  }
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.metaKey && !event.altKey) {
    event.preventDefault(); setSelected(selected + (event.key === 'ArrowDown' ? 1 : -1)); return;
  }
  if (event.ctrlKey && !event.metaKey && !event.altKey && ['n', 'p'].includes(event.key.toLowerCase())) {
    event.preventDefault(); setSelected(selected + (event.key.toLowerCase() === 'n' ? 1 : -1)); return;
  }
  if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); executeSelected(event.shiftKey ? 'new' : 'current'); return; }
  if ((event.key === 'PageDown' || event.key === 'PageUp') && !event.metaKey) { event.preventDefault(); setSelected(selected + (event.key === 'PageDown' ? 6 : -6)); return; }
  if (event.key === 'Tab') {
    const controls = [input, $('help-button'), $('close-button')].filter(control => getComputedStyle(control).display !== 'none');
    const position = controls.indexOf(document.activeElement);
    const next = (position + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
    event.preventDefault(); controls[next].focus();
    return;
  }
  if (document.activeElement !== input && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) input.focus();
}, true);

document.addEventListener('keyup', event => {
  if (!shortcutBuffer) return;
  if ((mode === 'native' && event.key === 'Meta') || (mode !== 'native' && event.key === 'Alt')) {
    const exact = tabs.find(tab => tab.shortcut === shortcutBuffer);
    if (exact) executeItem(exact);
    clearShortcut();
  }
}, true);

function queryChanged(event, suppressCompletion = false) {
  clearTimeout(debounceTimer); clearTimeout(shortcutTimer); shortcutBuffer = '';
  typedQuery = input.value;
  inlineCompletion = null;
  completionSuppressed = suppressCompletion || Boolean(event?.isComposing) || String(event?.inputType || '').startsWith('delete');
  selectionExplicit = false;
  const query = typedQuery.trim();
  const version = ++searchVersion;
  selected = 0; suggestions = []; searching = Boolean(query);
  $('error-banner').hidden = true;
  maybeCompleteInput();
  render(); scroll.scrollTop = 0;
  if (!query) return;
  const intent = navigationIntent(query);
  if (intent.type === 'blocked') { searching = false; render(); return; }
  debounceTimer = setTimeout(async () => {
    const requestId = ++requestCounter;
    try {
      const result = unwrapResponse(await request({ type: 'search', query, requestId, sourceWindowId }));
      if (version !== searchVersion || query !== typedQuery.trim()) return;
      if (result?.error) throw new Error(result.error);
      suggestions = (result?.suggestions || []).map(normalizedSuggestion);
      maybeCompleteInput();
    } catch (error) {
      if (version !== searchVersion) return;
      suggestions = [normalizedSuggestion({ id: `fallback:${query}`, type: 'search', title: `Search the web for “${query}”`, query }, 0)];
      showError(error.message);
    } finally {
      if (version === searchVersion) { searching = false; render(); }
    }
  }, 100);
}

input.addEventListener('input', queryChanged);

$('help-button').addEventListener('click', () => {
  const visible = $('keyboard-help').hidden;
  $('keyboard-help').hidden = !visible;
  $('help-button').setAttribute('aria-expanded', String(visible));
  if (!visible) input.focus();
});
$('close-button').addEventListener('click', closePalette);
$('backdrop').addEventListener('click', closePalette);
document.querySelector('.shell')?.addEventListener('mousedown', event => {
  if (mode === 'native' && event.target === event.currentTarget) closePalette();
});
window.addEventListener('focus', () => input.focus());
input.focus();
document.documentElement.dataset.ready = 'true';
loadSnapshot();

// Keep tab changes current without disturbing the user's query or selection.
if (!isDemo && !isNative && globalThis.chrome?.tabs) {
  let refreshTimer;
  const refresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(loadSnapshot, 80); };
  for (const name of ['onCreated', 'onRemoved', 'onMoved', 'onActivated', 'onUpdated', 'onAttached', 'onDetached']) chrome.tabs[name]?.addListener(refresh);
}
