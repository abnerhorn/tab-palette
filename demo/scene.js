/* Deterministic, offline product film. All fixtures below are public examples. */
(() => {
  'use strict';
  const { curve, install } = window.CaseStudyMotion;
  const $ = id => document.getElementById(id);
  const app = $('app-window');
  const panelLayer = $('palette-layer');
  const input = $('query');
  const paletteResults = $('palette-results');
  const cue = $('key-cue');
  const tabs = [
    { name: 'GitHub', title: 'Next.js · GitHub', url: 'github.com/vercel/next.js', icon: 'github', shortcut: '1' },
    { name: 'Linear', title: 'Product — Linear', url: 'linear.app', icon: 'linear', shortcut: '2' },
    { name: 'Vercel', title: 'Vercel Dashboard', url: 'vercel.com', icon: 'vercel', shortcut: '3' },
    { name: 'Figma', title: 'Interface kit — Figma', url: 'figma.com', icon: 'figma', shortcut: '4' },
    { name: 'Supabase', title: 'Supabase Dashboard', url: 'supabase.com/dashboard', icon: 'supabase', shortcut: '5' },
    { name: 'localhost', title: 'Local development', url: 'localhost:3000', icon: 'localhost', shortcut: '6' },
    { name: 'MDN', title: 'MDN Web Docs', url: 'developer.mozilla.org', icon: 'mdnwebdocs', shortcut: '7' },
    { name: 'Notion', title: 'Product notes — Notion', url: 'notion.so', icon: 'notion', shortcut: '8' },
    { name: 'Stripe', title: 'Stripe Dashboard', url: 'dashboard.stripe.com', icon: 'stripe', shortcut: '9' },
    { name: 'Redis', title: 'Redis Cloud', url: 'cloud.redis.io', icon: 'redis', shortcut: '0' },
    { name: 'Docker', title: 'Docker Hub', url: 'hub.docker.com', icon: 'docker', shortcut: 'A' },
  ];
  const docsTab = { name: 'Supabase Docs', title: 'Supabase Docs', url: 'supabase.com/docs', icon: 'supabase' };
  const allTabs = [...tabs, docsTab];
  const tabNodes = allTabs.map((tab, index) => {
    const node = document.createElement('div');
    node.className = 'browser-tab';
    node.dataset.index = String(index);
    node.innerHTML = `<img src="assets/${tab.icon}.svg" alt=""><span class="browser-tab-name"></span><span class="browser-tab-close">×</span>`;
    node.querySelector('.browser-tab-name').textContent = tab.name;
    $('browser-tabs').append(node);
    return node;
  });

  const figmaPage = `
    <div class="figma-shell">
      <aside class="figma-sidebar">
        <div class="workspace-logo"><img src="assets/figma.svg" alt="">Design workspace</div>
        <div class="side-item">⌕&nbsp;&nbsp; Search</div><div class="side-item">◷&nbsp;&nbsp; Recents</div><div class="side-item active">▧&nbsp;&nbsp; Projects</div><div class="side-item">◇&nbsp;&nbsp; Community</div>
        <div class="side-item gap">Your projects</div><div class="side-item active">Interface kit</div><div class="side-item">Website</div><div class="side-item">Explorations</div>
      </aside>
      <div class="figma-content">
        <div class="page-breadcrumb"><span>Projects</span><span>›</span><span>Interface kit</span></div>
        <div class="figma-titlebar"><h1>Interface kit</h1><div class="new-design">＋&nbsp; New design file</div></div>
        <div class="file-tabs"><span>All files</span><span>Design</span><span>FigJam</span><span>Slides</span></div>
        <div class="design-grid">
          <div class="design-card"><div class="design-card-preview foundations"><div class="mini-heading">Foundations</div><div class="swatches"><i></i><i></i><i></i><i></i></div><div class="type-sample">Aa &nbsp; Typography & color</div></div><div class="design-card-caption">Foundations <span>Design file</span></div></div>
          <div class="design-card"><div class="design-card-preview components">${Array.from({length:4},() => '<div class="mini-widget"><div class="mini-line"></div><div class="mini-line"></div><div class="mini-pill"></div></div>').join('')}</div><div class="design-card-caption">Components <span>Design file</span></div></div>
          <div class="design-card"><div class="design-card-preview prototype"><div class="phone-small"><div class="mini-line"></div><div class="mini-line"></div><div class="phone-block"></div><div class="mini-line"></div></div><div class="phone-small alt"><div class="mini-line"></div><div class="mini-line"></div><div class="phone-block"></div><div class="mini-line"></div></div></div><div class="design-card-caption">Prototype <span>Design file</span></div></div>
        </div>
        <div class="recent-label">Recently viewed</div><div class="recent-row">Landing page exploration <span>Design file</span></div><div class="recent-row">Navigation patterns <span>Design file</span></div>
      </div>
    </div>`;

  const githubPage = `
    <div class="github-page">
      <div class="github-top"><img src="assets/github.svg" alt="GitHub"><strong>Dashboard</strong><span>Pull requests</span><span>Issues</span><div class="github-search">Type / to search</div></div>
      <div class="repo-title">vercel <span>/</span> <strong>next.js</strong><span class="public-pill">Public</span></div>
      <div class="repo-nav"><span>⌘&nbsp; Code</span><span>Issues</span><span>Pull requests</span><span>Actions</span><span>Security</span><span>Insights</span></div>
      <div class="repo-body"><div class="repo-files"><div class="repo-head"><strong>⑂&nbsp; canary</strong><span>Go to file &nbsp;&nbsp; Code ▾</span></div>${['.github','examples','packages','test','README.md','package.json'].map((name, i) => `<div class="repo-file"><i>${i < 4 ? '▱' : '▤'}</i><span>${name}</span><span>${i < 4 ? 'Browse source' : 'View file'}</span></div>`).join('')}</div><aside class="repo-about"><h2>About</h2><p>The React Framework for the Web.</p><div class="repo-link">↗ nextjs.org</div><div class="topic-chips"><span>react</span><span>framework</span><span>javascript</span><span>typescript</span></div></aside></div>
    </div>`;

  const docsPage = `
    <div class="docs-page">
      <header class="docs-header"><img src="assets/supabase.svg" alt="Supabase">supabase <span>docs</span><div class="docs-search">Search the docs &nbsp;&nbsp; ⌘ K</div></header>
      <div class="docs-layout"><aside class="docs-sidebar"><div>Getting started</div><div>Database</div><div>Authentication</div><div>Storage</div><div>Realtime</div><div>Edge Functions</div><div>Client libraries</div></aside><div class="docs-content"><div class="docs-eyebrow">GETTING STARTED</div><h1>Start building with Supabase</h1><p>Create a project and connect your application to a Postgres database, authentication, storage, and realtime APIs.</p><h2>Connect your application</h2><p>Install the JavaScript client and initialize your project.</p><div class="code-example"><span style="color:#688779">// Initialize the client</span><br><span style="color:#b49ed2">import</span> { createClient } <span style="color:#b49ed2">from</span> <span style="color:#a5c2a1">'@supabase/supabase-js'</span><br><br><span style="color:#b49ed2">const</span> supabase = createClient(url, key)</div></div></div>
    </div>`;

  let pageKey = '';
  function showPage(key) {
    if (pageKey === key) return;
    $('browser-page').innerHTML = key === 'github' ? githubPage : key === 'docs' ? docsPage : figmaPage;
    pageKey = key;
  }

  function item(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function addHeading(label, count, trailing = '') {
    const node = item('div', `section-label ${label === 'Suggestions' ? 'suggestions-label' : ''}`);
    node.append(item('span', '', label), item('span', 'section-count', String(count)));
    if (trailing) node.append(item('span', 'section-trailing', trailing));
    paletteResults.append(node);
  }

  function addResult(row, selected, query) {
    const node = item('div', 'result');
    node.setAttribute('aria-selected', String(selected));
    const iconBox = item('div', 'row-icon');
    if (row.icon) {
      const img = item('img', 'site-favicon'); img.src = `assets/${row.icon}.svg`; img.alt = ''; iconBox.append(img);
    } else {
      const glass = item('img', 'search-icon'); glass.src = 'assets/search.png'; glass.alt = ''; iconBox.append(glass);
    }
    const copy = item('div', 'row-copy');
    const line = item('div', 'row-title-line');
    const title = item('span', 'row-title');
    const at = query && row.title.toLowerCase().indexOf(query.toLowerCase());
    if (query && at >= 0) {
      title.append(document.createTextNode(row.title.slice(0, at)), item('mark', '', row.title.slice(at, at + query.length)), document.createTextNode(row.title.slice(at + query.length)));
    } else title.textContent = row.title;
    line.append(title);
    if (row.url) line.append(item('span', 'row-separator', '—'), item('span', 'row-domain', row.url));
    copy.append(line); node.append(iconBox, copy);
    if (row.shortcut) {
      const badge = item('span', 'shortcut'); badge.append(item('kbd', 'shortcut-modifier', '⌘'), item('kbd', '', row.shortcut)); node.append(badge);
    } else node.append(item('span', 'row-kind', row.type === 'search' ? 'Search' : row.type === 'history' ? 'History' : 'Website'));
    paletteResults.append(node);
  }

  let paletteKey = '';
  function showPalette({query, completed, chooseTab = false, second = false}) {
    const key = `${query}|${completed}|${chooseTab}|${second}`;
    if (paletteKey !== key) {
      paletteResults.replaceChildren();
      const matches = tabs.filter(tab => !query || `${tab.title} ${tab.url}`.toLowerCase().includes(query));
      if (matches.length) {
        addHeading(query ? 'Matching tabs' : 'Open tabs', matches.length, query ? '' : '⌘ + shortcut');
        matches.forEach((tab, index) => addResult(tab, !query ? index === 0 : chooseTab && index === 0, query));
      }
      if (query) {
        const suggestions = second
          ? [{title: query.includes('/docs') ? 'Supabase Docs' : 'Supabase', url: completed || query, icon:'supabase', type:'url'}, {title:`Search for “${query}”`, type:'search'}, ...(query.includes('/docs') ? [{title:'JavaScript Client Library',url:'supabase.com/docs/reference/javascript',icon:'supabase',type:'history'},{title:'Database — Supabase Docs',url:'supabase.com/docs/guides/database',icon:'supabase',type:'history'}] : [])]
          : [{title:'GitHub',url:completed || 'github.com',icon:'github',type:'url'},{title:`Search for “${query}”`,type:'search'},{title:'GitHub Docs',url:'docs.github.com',icon:'github',type:'history'},{title:'Next.js Discussions',url:'github.com/vercel/next.js/discussions',icon:'github',type:'history'}];
        addHeading('Suggestions', suggestions.length);
        suggestions.forEach((row, index) => addResult(row, !chooseTab && index === 0, query));
      }
      paletteKey = key;
    }
    input.value = completed || query;
    input.focus({preventScroll:true});
    if (completed && completed.length > query.length) input.setSelectionRange(query.length, completed.length);
    else input.setSelectionRange(input.value.length, input.value.length);
    $('palette-action-label').textContent = query && !chooseTab ? 'Open page' : 'Switch tab';
    $('palette-action-symbol').textContent = query && !chooseTab ? '↗' : '⇥';
  }

  function typeAt(time, start, interval, text) {
    const count = Math.max(0, Math.min(text.length, Math.floor((time - start) / interval) + 1));
    return text.slice(0, count);
  }

  function cueAt(time, start, end, key) {
    const opacity = curve(time, start, .12) * (1 - curve(time, end - .16, .16));
    return { opacity, key };
  }

  install({
    durationMs: 19000,
    posterMs: 5700,
    render(ms) {
      const t = ms / 1000;
      app.style.opacity = String(curve(t, 0, .5) * (1 - curve(t, 18.25, .5)));
      $('loop-veil').style.opacity = '0';
      const isDocs = t >= 14.93;
      const isGitHub = t >= 6.87 && !isDocs;
      const active = isDocs ? 11 : isGitHub ? 0 : 3;
      tabNodes.forEach((node, index) => {
        node.hidden = index === 11 && !isDocs;
        node.classList.toggle('active', index === active);
      });
      $('browser-url').textContent = isDocs ? 'supabase.com/docs' : isGitHub ? 'github.com/vercel/next.js' : 'figma.com/files/project/interface-kit';
      showPage(isDocs ? 'docs' : isGitHub ? 'github' : 'figma');

      const firstOpen = curve(t, 2.05, .2) * (1 - curve(t, 6.72, .15));
      const secondOpen = curve(t, 9.75, .2) * (1 - curve(t, 14.78, .15));
      const openness = Math.max(firstOpen, secondOpen);
      panelLayer.style.opacity = String(openness);
      panelLayer.style.transform = `translateY(${(1 - openness) * -5}px)`;
      $('page-dim').style.opacity = String(openness);
      if (t < 9.75) {
        const query = typeAt(t, 4.3, .22, 'git');
        showPalette({query, completed:query.length >= 2 ? 'github.com' : '', chooseTab:t >= 6.5, second:false});
      } else {
        const query = typeAt(t, 10.65, .106, 'supabase.com/docs');
        const complete = query.length >= 2 && query.length < 'supabase.com'.length ? 'supabase.com' : '';
        showPalette({query, completed:complete, second:true});
      }
      const list = paletteResults.parentElement;
      const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
      const scrollPosition = t >= 3 && t < 4.3 ? maxScroll * curve(t, 3, .5) : 0;
      list.scrollTop = scrollPosition;
      const fadeTop = scrollPosition > 1;
      const fadeBottom = maxScroll - scrollPosition > 1;
      const mask = `linear-gradient(to bottom, ${fadeTop ? 'transparent 0, #000 13px' : '#000 0'}, ${fadeBottom ? '#000 calc(100% - 15px), transparent 100%' : '#000 100%'})`;
      list.style.maskImage = mask;
      list.style.webkitMaskImage = mask;
      if (openness === 0) input.blur();

      const cues = [cueAt(t,1.55,2.5,'T'),cueAt(t,6.38,7.16,'1'),cueAt(t,9.25,10.1,'T'),cueAt(t,14.4,15.18,'↵')];
      const visibleCue = cues.reduce((best, candidate) => candidate.opacity > best.opacity ? candidate : best, {opacity:0,key:'T'});
      cue.style.opacity = String(visibleCue.opacity);
      cue.style.transform = `translateX(-50%) translateY(${(1 - visibleCue.opacity) * 3}px)`;
      $('cue-modifier').hidden = visibleCue.key === '↵';
      $('cue-key').textContent = visibleCue.key;
    },
  });
})();
