import test from 'node:test';
import assert from 'node:assert/strict';
import {
  navigationURL, navigationIntent, completionCandidate, directURLSuggestion,
  safeFaviconDataURL, shortcutLabel, SHORTCUT_ALPHABET,
} from '../extension/core.mjs';

test('website intent is immediately available without suggestions', () => {
  assert.equal(directURLSuggestion('twitter.com').url, 'https://twitter.com/');
  assert.equal(directURLSuggestion('https://intranet/weekly goals').url, 'https://intranet/weekly%20goals');
  assert.equal(navigationURL('localhost:3059/notes and goals'), 'http://localhost:3059/notes%20and%20goals');
  assert.equal(navigationURL('example.com:8080/path'), 'https://example.com:8080/path');
  assert.equal(navigationIntent('cats and dogs').type, 'search');
});

test('explicit unsupported schemes never become a search intent', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,test', 'ftp://example.com/a', 'mailto:a@example.com', 'https://']) {
    assert.equal(navigationIntent(value).type, 'blocked', value);
  }
});

test('hostname completion keeps the typed prefix and never replaces an explicit domain', () => {
  const source = [{ title: 'Figma', url: 'https://figma.com/design/123' }];
  const completion = completionCandidate('fig', source);
  assert.equal(completion.display, 'figma.com');
  assert.equal(completion.typed, 'fig');
  assert.equal(directURLSuggestion('fig', completion, source).url, 'https://figma.com/');
  assert.equal(completionCandidate('f', source), null);
  assert.equal(completionCandidate('fig ma', source), null);
  assert.equal(completionCandidate('figma.com', [{ url: 'https://figma.community/' }]), null);
});

test('favicons accept raster PNG bytes only and never remote or executable sources', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2HO8AAAAASUVORK5CYII=';
  assert.equal(safeFaviconDataURL(png), png);
  for (const source of ['https://example.com/favicon.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,AAAA', 'data:image/png;base64,PHN2Zz4=']) assert.equal(safeFaviconDataURL(source), null);
});

test('Cmd+T remains reserved and overflow shortcut labels remain unique', () => {
  assert.equal(SHORTCUT_ALPHABET.includes('T'), false);
  assert.deepEqual(Array.from({ length: 10 }, (_, i) => shortcutLabel(i)), ['1','2','3','4','5','6','7','8','9','0']);
  const labels = Array.from({ length: 5000 }, (_, i) => shortcutLabel(i));
  assert.equal(new Set(labels).size, labels.length);
});
