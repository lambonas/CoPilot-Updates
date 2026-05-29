/* ============================================================
   Microsoft 365 Copilot Updates — app.js
   Vanilla JS. Fetches data/updates.json, renders cards,
   handles filtering, theming, URL-hash state, keyboard shortcuts.
   ============================================================ */

(() => {
  'use strict';

  // ---- Constants ----
  const DATA_URL = './data/updates.json';

  // Canonical app order (used as a stable fallback ordering)
  const APPS = [
    'Word', 'Excel', 'PowerPoint', 'Outlook', 'Teams', 'OneNote',
    'OneDrive', 'SharePoint', 'Loop', 'Whiteboard', 'Copilot Chat',
    'Copilot Studio', 'Microsoft 365 Copilot'
  ];

  // Map app name -> CSS var for the badge colour
  const APP_COLOR_VAR = {
    'Word': '--app-word',
    'Excel': '--app-excel',
    'PowerPoint': '--app-powerpoint',
    'Outlook': '--app-outlook',
    'Teams': '--app-teams',
    'OneNote': '--app-onenote',
    'OneDrive': '--app-onedrive',
    'SharePoint': '--app-sharepoint',
    'Loop': '--app-loop',
    'Whiteboard': '--app-whiteboard',
    'Copilot Chat': '--app-copilot-chat',
    'Copilot Studio': '--app-copilot-studio',
    'Microsoft 365 Copilot': '--app-m365'
  };

  // Short labels for the most verbose app names (badge real estate)
  const APP_BADGE_LABEL = {
    'Microsoft 365 Copilot': 'M365 Copilot'
  };

  const STATUSES = [
    { value: 'Launched', label: 'Launched', pill: 'launched' },
    { value: 'Rolling out', label: 'Rolling out', pill: 'rolling' },
    { value: 'In development', label: 'In development', pill: 'dev' }
  ];

  const RELEASED_STATUSES = ['Launched'];
  const UPCOMING_STATUSES = ['Rolling out', 'In development'];

  // ---- State ----
  let allItems = [];
  let generatedAt = null;
  let lastVisitedAt = null; // captured before render so NEW ribbons are accurate

  const filters = {
    q: '',
    apps: new Set(),      // empty set is interpreted in code as "all apps"
    statuses: new Set(STATUSES.map(s => s.value)),
    window: '30'
  };

  // ---- DOM refs ----
  const $ = (id) => document.getElementById(id);
  const els = {
    loading: $('loading'),
    error: $('error'),
    errorDetail: $('error-detail'),
    content: $('content'),
    retry: $('retry-btn'),
    lastUpdated: $('last-updated'),
    refresh: $('refresh-btn'),
    search: $('search-input'),
    windowInput: $('window-input'),
    appChips: $('app-chips'),
    statusChips: $('status-chips'),
    countReadout: $('count-readout'),
    releasedGroups: $('released-groups'),
    releasedCount: $('released-count'),
    releasedEmpty: $('released-empty'),
    upcomingGroups: $('upcoming-groups'),
    upcomingCount: $('upcoming-count'),
    upcomingEmpty: $('upcoming-empty')
  };

  // ============================================================
  // Time helpers
  // ============================================================
  function parseDate(s) {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function relativeTime(dateStr) {
    const d = parseDate(dateStr);
    if (!d) return { text: 'unknown', absolute: false };
    const now = new Date();
    const diffMs = now - d;
    const dayMs = 86400000;
    const days = Math.floor(diffMs / dayMs);

    if (days > 30) {
      return {
        text: d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
        absolute: true
      };
    }
    if (days <= 0) {
      // same calendar window — distinguish today vs future
      if (diffMs < 0) return { text: 'soon', absolute: false };
      return { text: 'today', absolute: false };
    }
    if (days === 1) return { text: 'yesterday', absolute: false };
    return { text: `${days} days ago`, absolute: false };
  }

  function relativeFromNow(dateStr) {
    const d = parseDate(dateStr);
    if (!d) return '—';
    const diffMs = new Date() - d;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // ============================================================
  // URL hash <-> filter state
  // ============================================================
  function readHash() {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    const params = new URLSearchParams(hash);

    if (params.has('q')) {
      filters.q = params.get('q') || '';
    }
    if (params.has('window')) {
      const w = params.get('window');
      if (['7', '30', '90', 'all'].includes(w)) filters.window = w;
    }
    if (params.has('app')) {
      const apps = (params.get('app') || '').split(',').map(s => s.trim()).filter(Boolean);
      filters.apps = new Set(apps.filter(a => APPS.includes(a)));
    }
    if (params.has('status')) {
      const st = (params.get('status') || '').split(',').map(s => s.trim()).filter(Boolean);
      const valid = st.filter(s => STATUSES.some(x => x.value === s));
      if (valid.length) filters.statuses = new Set(valid);
    }
  }

  function writeHash() {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.window !== '30') params.set('window', filters.window);
    // apps: only encode if a strict subset is selected
    if (filters.apps.size > 0 && filters.apps.size < APPS.length) {
      params.set('app', [...filters.apps].join(','));
    }
    if (filters.statuses.size > 0 && filters.statuses.size < STATUSES.length) {
      params.set('status', [...filters.statuses].join(','));
    }
    const str = params.toString();
    const newHash = str ? `#${str}` : '';
    // Avoid pushing duplicate history entries
    if (newHash !== window.location.hash) {
      history.replaceState(null, '', newHash || window.location.pathname + window.location.search);
    }
  }

  // ============================================================
  // Fetch
  // ============================================================
  async function loadData() {
    showState('loading');
    const minuteStamp = Math.floor(Date.now() / 60000); // changes once per minute
    try {
      const res = await fetch(`${DATA_URL}?t=${minuteStamp}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const data = await res.json();
      if (!data || !Array.isArray(data.items)) {
        throw new Error('Malformed data: "items" array missing.');
      }
      allItems = data.items;
      generatedAt = data.generated_at || null;

      // Capture last-visited BEFORE we overwrite it, so NEW ribbons reflect this visit.
      lastVisitedAt = localStorage.getItem('lastVisitedAt');

      els.lastUpdated.textContent = relativeFromNow(generatedAt);
      els.lastUpdated.title = generatedAt ? new Date(generatedAt).toLocaleString() : '';

      buildAppChips();
      render();
      showState('content');

      // AFTER rendering, advance the watermark to this dataset's generated_at.
      if (generatedAt) localStorage.setItem('lastVisitedAt', generatedAt);
    } catch (err) {
      els.errorDetail.textContent = err.message || String(err);
      showState('error');
    }
  }

  function showState(which) {
    els.loading.hidden = which !== 'loading';
    els.error.hidden = which !== 'error';
    els.content.hidden = which !== 'content';
  }

  // ============================================================
  // Chips
  // ============================================================
  function buildAppChips() {
    // Only show chips for apps that actually appear in the data, in canonical order.
    const present = APPS.filter(app => allItems.some(it => it.app === app));
    // Any unexpected app values, appended so nothing is hidden.
    const extras = [...new Set(allItems.map(it => it.app))].filter(a => !APPS.includes(a));
    const appList = [...present, ...extras];

    els.appChips.querySelectorAll('.chip').forEach(c => c.remove());

    appList.forEach(app => {
      const chip = makeChip(app, isAppOn(app));
      chip.addEventListener('click', () => {
        toggleSetMember(filters.apps, app, appList);
        chip.setAttribute('aria-pressed', String(isAppOn(app)));
        onFilterChange();
      });
      els.appChips.appendChild(chip);
    });
  }

  function buildStatusChips() {
    STATUSES.forEach(s => {
      const chip = makeChip(s.label, filters.statuses.has(s.value));
      chip.dataset.value = s.value;
      chip.addEventListener('click', () => {
        toggleStatus(s.value);
        chip.setAttribute('aria-pressed', String(filters.statuses.has(s.value)));
        onFilterChange();
      });
      els.statusChips.appendChild(chip);
    });
  }

  function makeChip(label, pressed) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.textContent = label;
    btn.setAttribute('aria-pressed', String(pressed));
    return btn;
  }

  // "all on" is represented by an empty apps set for compactness.
  function isAppOn(app) {
    return filters.apps.size === 0 || filters.apps.has(app);
  }

  function toggleSetMember(set, value, fullList) {
    // Normalise: if currently "all on" (empty), materialise the full set first.
    if (set.size === 0) fullList.forEach(v => set.add(v));
    if (set.has(value)) set.delete(value);
    else set.add(value);
    // If everything ended up selected, collapse back to "all on" (empty).
    if (set.size === fullList.length) set.clear();
  }

  function toggleStatus(value) {
    if (filters.statuses.has(value)) filters.statuses.delete(value);
    else filters.statuses.add(value);
  }

  function syncChipsFromState() {
    els.appChips.querySelectorAll('.chip').forEach(chip => {
      chip.setAttribute('aria-pressed', String(isAppOn(chip.textContent)));
    });
    els.statusChips.querySelectorAll('.chip').forEach(chip => {
      chip.setAttribute('aria-pressed', String(filters.statuses.has(chip.dataset.value)));
    });
  }

  // ============================================================
  // Filtering
  // ============================================================
  function withinWindow(item) {
    if (filters.window === 'all') return true;
    const days = parseInt(filters.window, 10);
    const d = parseDate(item.modified_at) || parseDate(item.added_at);
    if (!d) return true; // don't hide undated items
    const diffDays = (new Date() - d) / 86400000;
    return diffDays <= days;
  }

  function matchesSearch(item) {
    if (!filters.q) return true;
    const q = filters.q.toLowerCase();
    const hay = [
      item.title || '',
      item.summary || '',
      ...(Array.isArray(item.tags) ? item.tags : [])
    ].join(' ').toLowerCase();
    return hay.includes(q);
  }

  function passesCommonFilters(item) {
    return isAppOn(item.app) && matchesSearch(item) && withinWindow(item);
  }

  function filteredByStatus(statusGroup) {
    return allItems.filter(item =>
      statusGroup.includes(item.status) &&
      filters.statuses.has(item.status) &&
      passesCommonFilters(item)
    );
  }

  // ============================================================
  // Rendering
  // ============================================================
  function isNew(item) {
    if (!lastVisitedAt) return false; // first ever visit: no ribbons (avoid all-new noise)
    const m = parseDate(item.modified_at);
    const last = parseDate(lastVisitedAt);
    return m && last && m > last;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function statusPillClass(status) {
    if (status === 'Launched') return 'status-pill--launched';
    if (status === 'Rolling out') return 'status-pill--rolling';
    return 'status-pill--dev';
  }

  function createCard(item) {
    const article = document.createElement('article');
    article.className = 'card' + (isNew(item) ? ' card--new' : '');

    const colorVar = APP_COLOR_VAR[item.app] || '--app-default';
    article.style.setProperty('--badge-color', `var(${colorVar})`);

    const badgeLabel = APP_BADGE_LABEL[item.app] || item.app;
    const rel = relativeTime(item.modified_at);
    const tags = Array.isArray(item.tags) ? item.tags.slice(0, 4) : [];

    const ribbon = isNew(item) ? `<div class="card__ribbon" aria-hidden="true">NEW</div>` : '';
    const newSr = isNew(item) ? `<span class="sr-only">Recently updated. </span>` : '';

    const tagsHtml = tags.length
      ? `<div class="card__tags">${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>`
      : '';

    const sourceLabel = item.source ? escapeHtml(item.source) : 'Source';
    const sourceLink = item.source_url
      ? `<a class="card__source" href="${escapeHtml(item.source_url)}" target="_blank" rel="noopener" aria-label="Open source: ${sourceLabel} (opens in new tab)">${sourceLabel} <span aria-hidden="true">↗</span></a>`
      : '';

    article.innerHTML = `
      ${ribbon}
      <div class="card__top">
        <span class="app-badge" aria-label="App: ${escapeHtml(item.app)}">${escapeHtml(badgeLabel)}</span>
        <span class="status-pill ${statusPillClass(item.status)}" aria-label="Status: ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>
      </div>
      <h3 class="card__title">${newSr}${escapeHtml(item.title || 'Untitled')}</h3>
      <p class="card__summary">${escapeHtml(item.summary || '')}</p>
      ${tagsHtml}
      <div class="card__footer">
        <span class="card__updated">📅 <span>${rel.absolute ? '' : 'Updated '}${escapeHtml(rel.text)}</span></span>
        ${sourceLink}
      </div>
    `;
    return article;
  }

  function makeGrid(items) {
    const grid = document.createElement('div');
    grid.className = 'card-grid';
    items.forEach(it => grid.appendChild(createCard(it)));
    return grid;
  }

  function makeGroup(title, count, items) {
    const group = document.createElement('div');
    group.className = 'group';
    const h = document.createElement('h3');
    h.className = 'group__heading';
    h.innerHTML = `${escapeHtml(title)} <span class="group__count">${count}</span>`;
    group.appendChild(h);
    group.appendChild(makeGrid(items));
    return group;
  }

  // ---- Released: grouped by app, apps ordered by count desc ----
  function renderReleased() {
    const items = filteredByStatus(RELEASED_STATUSES);
    els.releasedCount.textContent = items.length;
    els.releasedGroups.innerHTML = '';

    if (items.length === 0) {
      els.releasedEmpty.hidden = false;
      return;
    }
    els.releasedEmpty.hidden = true;

    const byApp = new Map();
    items.forEach(it => {
      if (!byApp.has(it.app)) byApp.set(it.app, []);
      byApp.get(it.app).push(it);
    });

    // Apps ordered by item count desc, ties broken by canonical order.
    const appOrder = [...byApp.keys()].sort((a, b) => {
      const diff = byApp.get(b).length - byApp.get(a).length;
      if (diff !== 0) return diff;
      return APPS.indexOf(a) - APPS.indexOf(b);
    });

    appOrder.forEach(app => {
      const list = byApp.get(app).slice().sort(byModifiedDesc);
      els.releasedGroups.appendChild(makeGroup(app, list.length, list));
    });
  }

  // ---- Upcoming: grouped by expected_release quarter ----
  function renderUpcoming() {
    const items = filteredByStatus(UPCOMING_STATUSES);
    els.upcomingCount.textContent = items.length;
    els.upcomingGroups.innerHTML = '';

    if (items.length === 0) {
      els.upcomingEmpty.hidden = false;
      return;
    }
    els.upcomingEmpty.hidden = true;

    const byQuarter = new Map();
    items.forEach(it => {
      const key = normaliseQuarter(it.expected_release);
      if (!byQuarter.has(key)) byQuarter.set(key, []);
      byQuarter.get(key).push(it);
    });

    const order = [...byQuarter.keys()].sort(quarterSort);

    order.forEach(q => {
      const list = byQuarter.get(q).slice().sort(byStatusThenModified);
      const label = q === 'TBD' ? 'To be determined' : q;
      els.upcomingGroups.appendChild(makeGroup(label, list.length, list));
    });
  }

  // Normalise "2026-Q3" / "2026 Q3" / missing -> "2026 Q3" or "TBD"
  function normaliseQuarter(raw) {
    if (!raw) return 'TBD';
    const m = String(raw).match(/(\d{4})\D*Q\s*([1-4])/i);
    if (m) return `${m[1]} Q${m[2]}`;
    return String(raw).trim() || 'TBD';
  }

  function quarterSort(a, b) {
    if (a === 'TBD') return 1;
    if (b === 'TBD') return -1;
    const pa = a.match(/(\d{4})\sQ([1-4])/);
    const pb = b.match(/(\d{4})\sQ([1-4])/);
    if (pa && pb) {
      const ya = +pa[1], qa = +pa[2], yb = +pb[1], qb = +pb[2];
      return ya !== yb ? ya - yb : qa - qb;
    }
    if (pa) return -1;
    if (pb) return 1;
    return a.localeCompare(b);
  }

  function byModifiedDesc(a, b) {
    const da = parseDate(a.modified_at) || parseDate(a.added_at) || new Date(0);
    const db = parseDate(b.modified_at) || parseDate(b.added_at) || new Date(0);
    return db - da;
  }

  function byStatusThenModified(a, b) {
    const rank = { 'Rolling out': 0, 'In development': 1 };
    const ra = rank[a.status] ?? 2;
    const rb = rank[b.status] ?? 2;
    if (ra !== rb) return ra - rb;
    return byModifiedDesc(a, b);
  }

  function updateCountReadout() {
    // "Showing" = items visible across both sections under current filters.
    const released = filteredByStatus(RELEASED_STATUSES).length;
    const upcoming = filteredByStatus(UPCOMING_STATUSES).length;
    const showing = released + upcoming;
    const total = allItems.length;
    els.countReadout.textContent = `Showing ${showing} of ${total} update${total === 1 ? '' : 's'}`;
  }

  function render() {
    renderReleased();
    renderUpcoming();
    updateCountReadout();
  }

  // ============================================================
  // Filter change orchestration
  // ============================================================
  function onFilterChange() {
    writeHash();
    render();
  }

  function clearFilters() {
    filters.q = '';
    filters.apps.clear();
    filters.statuses = new Set(STATUSES.map(s => s.value));
    filters.window = '30';
    els.search.value = '';
    els.windowInput.value = '30';
    syncChipsFromState();
    onFilterChange();
  }

  // ============================================================
  // Events
  // ============================================================
  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function bindEvents() {
    els.refresh.addEventListener('click', () => {
      els.refresh.classList.add('refreshing');
      loadData().finally(() => {
        setTimeout(() => els.refresh.classList.remove('refreshing'), 400);
      });
    });

    els.retry.addEventListener('click', loadData);

    const onSearch = debounce(() => {
      filters.q = els.search.value.trim();
      onFilterChange();
    }, 150);
    els.search.addEventListener('input', onSearch);

    els.windowInput.addEventListener('change', () => {
      filters.window = els.windowInput.value;
      onFilterChange();
    });

    document.querySelectorAll('.clear-filters-btn').forEach(btn => {
      btn.addEventListener('click', clearFilters);
    });

    // Keyboard: "/" focuses search, Esc clears it (when focused)
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (e.key === '/' && !typing) {
        e.preventDefault();
        els.search.focus();
      } else if (e.key === 'Escape' && e.target === els.search) {
        els.search.value = '';
        filters.q = '';
        onFilterChange();
        els.search.blur();
      }
    });

    // React to manual hash edits / shared links navigated in-tab
    window.addEventListener('hashchange', () => {
      readHash();
      applyStateToControls();
      render();
    });
  }

  function applyStateToControls() {
    els.search.value = filters.q;
    els.windowInput.value = filters.window;
    syncChipsFromState();
  }

  // ============================================================
  // Init
  // ============================================================
  function init() {
    readHash();
    buildStatusChips();
    applyStateToControls();
    bindEvents();
    loadData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
