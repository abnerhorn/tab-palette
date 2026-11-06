import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../extension/core.mjs';

const source = (await fs.readFile(new URL('../extension/palette.js', import.meta.url), 'utf8'))
  .replace(/^import\s*\{[\s\S]*?\}\s*from\s*['"]\.\/core\.mjs['"];?\s*/, `const {${Object.keys(core).join(',')}} = globalThis.__core;\n`);

async function harness() {
  const ids = new Map();
  class Node {
    constructor(tag = 'div', id = '') {
      this.tagName = tag; this.childNodes = []; this.attrs = new Map(); this.listeners = new Map(); this.dataset = {};
      this.style = { setProperty() {} }; this.hidden = false; this.scrollTop = 0; this._text = ''; this._value = '';
      if (id) this.id = id;
    }
    set id(value) { this._id = value; ids.set(value, this); }
    get id() { return this._id || ''; }
    set value(value) { this._value = value; this.selectionStart = this.selectionEnd = value.length; }
    get value() { return this._value; }
    set textContent(value) { this._text = String(value ?? ''); this.childNodes = []; }
    get textContent() { return this._text + this.childNodes.map(child => child.textContent ?? '').join(''); }
    append(...children) { this.childNodes.push(...children); }
    replaceChildren(...children) { this._text = ''; this.childNodes = children; }
    setAttribute(key, value) { this.attrs.set(key, String(value)); }
    getAttribute(key) { return this.attrs.get(key); }
    removeAttribute(key) { this.attrs.delete(key); }
    addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(callback); }
    dispatch(type, event = {}) { for (const callback of this.listeners.get(type) || []) callback({ type, target: this, preventDefault() {}, stopPropagation() {}, ...event }); }
    focus() { document.activeElement = this; }
    blur() { if (document.activeElement === this) document.activeElement = null; }
    setSelectionRange(from, to) { this.selectionStart = from; this.selectionEnd = to; }
    scrollIntoView() {}
  }
  const document = new Node('document');
  document.body = new Node('body'); document.documentElement = new Node('html');
  document.getElementById = id => ids.get(id);
  document.createElement = tag => new Node(tag);
  document.createElementNS = (_, tag) => new Node(tag);
  document.createTextNode = text => { const node = new Node('#text'); node.textContent = text; return node; };
  document.createDocumentFragment = () => new Node('#fragment');
  document.querySelector = () => new Node('shell');
  for (const id of ['query','results','results-scroll','help-button','help-modifier','close-button','keyboard-help','error-banner','action-label','action-symbol','status','announcer','empty-state','empty-title','empty-description','backdrop']) new Node('div', id);
  let clock = 0, timerId = 0;
  const timers = new Map();
  const requests = [];
  const chrome = { runtime: { sendMessage(message) {
    if (message.type === 'snapshot') return Promise.resolve({ tabs: [], mode: 'extension', shortcutModifier: '⌥', sourceWindowId: 1 });
    if (message.type === 'execute') { requests.push({ message }); return Promise.resolve({ ok: true }); }
    return new Promise((resolve, reject) => requests.push({ message, resolve, reject }));
  } } };
  const window = new Node('window'); window.close = () => {};
  const context = vm.createContext({ __core: core, document, window, chrome, URLSearchParams, location: { search: '' },
    getComputedStyle: () => ({ display: 'block' }),
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: clock + delay }); return id; },
    clearTimeout(id) { timers.delete(id); }, console });
  vm.runInContext(source, context, { filename: 'palette.js' });
  const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  await settle();
  const input = ids.get('query');
  return {
    ids, requests, window,
    async advance(ms) {
      const until = clock + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]); clock = next[1].at; next[1].callback(); await settle();
      }
      clock = until; await settle();
    },
    type(value, inputType = 'insertText') { input.value = value; input.dispatch('input', { inputType }); },
    key(key, extra = {}) { document.dispatch('keydown', { key, code: key, ...extra }); },
    local() { return requests.filter(entry => entry.message.type === 'search' && entry.message.phase === 'local').at(-1); },
    history() { return requests.filter(entry => entry.message.type === 'search' && entry.message.phase === 'history').at(-1); },
    web() { return requests.filter(entry => entry.message.type === 'search' && entry.message.phase === 'web').at(-1); },
    text() { return ids.get('results').textContent; },
    selectedText() { return [...ids.values()].find(node => node.getAttribute('aria-selected') === 'true' && node.className === 'result')?.textContent || ''; },
    async resolve(entry, response) { entry.resolve(response); await settle(); },
  };
}

const figma = { id: 'h-figma', type: 'history', title: 'Figma Design', url: 'https://figma.com/design/components' };
const firebase = { id: 'b-firebase', type: 'bookmark', title: 'Firebase Console', url: 'https://firebase.google.com/' };

test('lookup starts after 40ms and narrower typing immediately retains only matching local rows', async () => {
  const ui = await harness(); ui.type('fi');
  await ui.advance(39); assert.equal(ui.requests.length, 0);
  await ui.advance(1); assert.equal(ui.local().message.query, 'fi');
  await ui.resolve(ui.local(), { suggestions: [figma, firebase, { type: 'search', title: 'old remote text', query: 'fi examples' }], webSuggestionsEnabled: false });
  ui.type('fig');
  assert.match(ui.text(), /Figma Design/); assert.doesNotMatch(ui.text(), /Firebase Console|old remote text/);
  assert.equal(ui.ids.get('query').value, 'figma.com');
  assert.equal(ui.ids.get('query').selectionStart, 3);
  assert.equal(ui.requests.length, 1);
});

test('deleting or resetting clears retained rows and prevents completion from being reinserted', async () => {
  const ui = await harness(); ui.type('fig'); await ui.advance(40);
  await ui.resolve(ui.local(), { suggestions: [figma], webSuggestionsEnabled: false });
  ui.type('fi', 'deleteContentBackward');
  assert.doesNotMatch(ui.text(), /Figma Design/); assert.equal(ui.ids.get('query').value, 'fi');
  await ui.advance(40); await ui.resolve(ui.local(), { suggestions: [figma], webSuggestionsEnabled: false });
  assert.equal(ui.ids.get('query').value, 'fi');
  ui.window.dispatch('palette-open');
  assert.doesNotMatch(ui.text(), /Figma Design/); assert.equal(ui.ids.get('query').value, '');
});

test('local rows render before optional web response and merging web rows does not steal explicit selection', async () => {
  const ui = await harness(); ui.type('fig'); await ui.advance(40);
  await ui.resolve(ui.local(), { suggestions: [figma], webSuggestionsEnabled: true });
  assert.match(ui.text(), /Figma Design/); assert.ok(ui.web());
  assert.doesNotMatch(ui.ids.get('status').textContent, /Searching/);
  ui.key('ArrowDown');
  assert.match(ui.selectedText(), /Figma Design/);
  await ui.resolve(ui.web(), { suggestions: [{ type: 'search', title: 'fig examples', query: 'fig examples' }, { type: 'search', title: 'duplicate query', query: 'FIG' }] });
  assert.match(ui.text(), /Figma Design|fig examples/); assert.doesNotMatch(ui.text(), /duplicate query/);
  assert.match(ui.selectedText(), /Figma Design/);
});

test('late web and local responses cannot restore another query or a deleted completion', async () => {
  const ui = await harness(); ui.type('fig'); await ui.advance(40);
  const first = ui.local(); ui.type('vercel'); await ui.advance(40);
  await ui.resolve(first, { suggestions: [figma], webSuggestionsEnabled: true });
  assert.doesNotMatch(ui.text(), /Figma Design/); assert.equal(ui.web(), undefined);
  await ui.resolve(ui.local(), { suggestions: [{ type: 'history', title: 'Vercel Console', url: 'https://vercel.com/' }], webSuggestionsEnabled: true });
  const web = ui.web(); ui.type('ver', 'deleteContentBackward');
  await ui.resolve(web, { suggestions: [{ type: 'search', title: 'stale remote answer', query: 'vercel examples' }] });
  assert.doesNotMatch(ui.text(), /Vercel Console|stale remote answer/); assert.equal(ui.ids.get('query').value, 'ver');
});

test('Enter on a typed website before the debounce navigates directly instead of searching', async () => {
  const ui = await harness(); ui.type('twitter.com'); ui.key('Enter');
  const execute = ui.requests.find(entry => entry.message.type === 'execute');
  assert.equal(execute.message.item.type, 'url');
  assert.equal(execute.message.item.url, 'https://twitter.com/');
  assert.equal(ui.requests.some(entry => entry.message.type === 'search'), false);
});

test('full history refinement never blocks the first local rows', async () => {
  const ui = await harness(); ui.type('fig'); await ui.advance(40);
  await ui.resolve(ui.local(), { suggestions: [figma], needsHistoryRefresh: true, webSuggestionsEnabled: false });
  assert.ok(ui.history());
  assert.match(ui.text(), /Figma Design/);
  assert.doesNotMatch(ui.ids.get('status').textContent, /Searching/);
  await ui.advance(500);
  assert.match(ui.text(), /Figma Design/);
});

test('fresh history replaces only local rows while keeping arrived web rows and explicit selection', async () => {
  const ui = await harness(); ui.type('fig'); await ui.advance(40);
  await ui.resolve(ui.local(), { suggestions: [figma], needsHistoryRefresh: true, webSuggestionsEnabled: true });
  await ui.resolve(ui.web(), { suggestions: [{ type: 'search', title: 'fig examples', query: 'fig examples' }] });
  for (let i = 0; i < 8 && !ui.selectedText().includes('fig examples'); i++) ui.key('ArrowDown');
  assert.match(ui.selectedText(), /fig examples/);
  await ui.resolve(ui.history(), { suggestions: [
    { id: 'h-figma-help', type: 'history', title: 'Figma Help', url: 'https://help.figma.com/design' },
    { id: 'b-figma-docs', type: 'bookmark', title: 'Figma Docs', url: 'https://figma.com/docs' },
  ] });
  assert.match(ui.text(), /Figma Help/); assert.match(ui.text(), /Figma Docs/); assert.match(ui.text(), /fig examples/);
  assert.doesNotMatch(ui.text(), /Figma Design/);
  assert.match(ui.selectedText(), /fig examples/);
});

test('late or superseded full-history answers cannot erase current results or revive deleted completion', async () => {
  const ui = await harness(); ui.type('fig'); await ui.advance(40);
  await ui.resolve(ui.local(), { suggestions: [figma], needsHistoryRefresh: true });
  const oldHistory = ui.history();
  ui.type('fi', 'deleteContentBackward'); await ui.advance(40);
  await ui.resolve(ui.local(), { suggestions: [firebase], needsHistoryRefresh: true });
  const currentHistory = ui.history();
  await ui.resolve(oldHistory, { suggestions: [figma] });
  assert.doesNotMatch(ui.text(), /Figma Design/);
  assert.match(ui.text(), /Firebase Console/); assert.equal(ui.ids.get('query').value, 'fi');
  await ui.resolve(currentHistory, { suggestions: [], superseded: true });
  assert.match(ui.text(), /Firebase Console/); assert.equal(ui.ids.get('query').value, 'fi');
});

test('web enrichment arriving after fresh history merges against the fresh local rows', async () => {
  const ui = await harness(); ui.type('fig'); await ui.advance(40);
  await ui.resolve(ui.local(), { suggestions: [figma], needsHistoryRefresh: true, webSuggestionsEnabled: true });
  await ui.resolve(ui.history(), { suggestions: [{ type: 'history', title: 'Figma Help', url: 'https://help.figma.com/design' }] });
  await ui.resolve(ui.web(), { suggestions: [{ type: 'search', title: 'fig examples', query: 'fig examples' }] });
  assert.match(ui.text(), /Figma Help/); assert.match(ui.text(), /fig examples/);
  assert.doesNotMatch(ui.text(), /Figma Design/);
});
