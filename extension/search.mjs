import { navigationURL, navigationIntent } from './core.mjs';
export { navigationURL } from './core.mjs';
export const normalize = (value = '') => String(value).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

export function allowedURL(value) {
  if (typeof value !== 'string') return null;
  if (/^(https?:|file:)/i.test(value)) {
    try { const url = new URL(value); return url.username || url.password ? null : url.href; } catch { return null; }
  }
  return navigationURL(value)?.startsWith('chrome://') || value === 'about:blank' ? value : null;
}

export function relevance(item, query, now = Date.now()) {
  const tokens = normalize(query).trim().split(/\s+/).filter(Boolean);
  const title = normalize(item.title);
  const url = normalize(item.url);
  let hostname = '';
  try { hostname = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  if (!tokens.every(token => `${title} ${url}`.includes(token))) return -1;
  const needle = normalize(query).trim();
  let score = 0;
  if (hostname === needle) score += 120;
  else if (hostname.startsWith(needle)) score += 80;
  if (title.startsWith(needle)) score += 45;
  if (title.includes(needle)) score += 24;
  if (item.type === 'bookmark') score += 12;
  score += Math.min(14, Math.log2(1 + (item.visitCount || 0)) * 2);
  if (item.lastVisitTime) score += Math.max(0, 10 - (now - item.lastVisitTime) / 86400000 / 4);
  return score;
}

export function buildSuggestions(query, history = [], bookmarks = [], openTabs = []) {
  const text = String(query).trim().slice(0, 1000);
  if (!text) return [];
  if (navigationIntent(text).type === 'blocked') return [];
  const openURLs = new Set(openTabs.map(tab => tab.url));
  const unique = new Map();
  for (const item of [...bookmarks.map(x => ({...x, type:'bookmark'})), ...history.map(x => ({...x,type:'history'}))]) {
    const url = allowedURL(item.url);
    if (!url || openURLs.has(url)) continue;
    const score = relevance(item, text);
    if (score < 0) continue;
    const previous = unique.get(url);
    if (!previous || score > previous.score) unique.set(url, {id:`${item.type}:${url}`, type:item.type, title:item.title || url, url, score});
  }
  const direct = navigationURL(text);
  const rows = [...unique.values()].sort((a,b) => b.score-a.score || a.title.localeCompare(b.title)).slice(0,8);
  if (direct) {
    const duplicate = rows.findIndex(row => row.url === direct);
    const matching = duplicate >= 0 ? rows.splice(duplicate, 1)[0] : null;
    rows.unshift({id:`url:${direct}`,type:'url',title:matching?.title || direct,url:direct});
  }
  rows.push({id:`search:${text}`,type:'search',title:`Search for “${text}”`,query:text});
  return rows;
}
