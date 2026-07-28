/* Leadspanic Social — dashboard client.
 *
 * Vanilla JS, no build step, on purpose. You should be able to open this file,
 * read it top to bottom, and change something without a toolchain.
 *
 *   1. state and api helper      6. knowledge base and guardrails
 *   2. tab routing               7. media library
 *   3. calendar and compose      8. posting schedule
 *   4. inbox                     9. analytics
 *   5. comment codes            10. activity log, settings, boot
 */

// ===========================================================================
// 1. state and api helper
// ===========================================================================

const state = {
  token: localStorage.getItem('lp_api_token') || '',
  accounts: [],
  account: localStorage.getItem('lp_account') || '',
  view: 'calendar',
  cursor: startOfMonth(new Date()),
  posts: [],
  drafts: [],
  triggers: [],
  resources: [],
  media: [],
  slots: [],
  threads: [],
  activeThread: null,
  editingPost: null,
  editingTriggerId: null,
  editingResourceId: null,
  pendingMediaKey: null,
  carouselKeys: [],
  logTimer: null,
};

const $ = (id) => document.getElementById(id);
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 3200);
}

function askForToken() {
  const entered = prompt(
    'Enter the API token you set with:  wrangler secret put API_TOKEN\n\n' +
      'It is stored only in this browser, never sent anywhere except this Worker.'
  );
  if (entered && entered.trim()) {
    state.token = entered.trim();
    localStorage.setItem('lp_api_token', state.token);
    return true;
  }
  return false;
}

/** Every request goes through here: auth, JSON, and errors in one place. */
async function api(path, { method = 'GET', body } = {}) {
  while (!state.token) {
    if (!askForToken()) throw new Error('An API token is required.');
  }
  const res = await fetch(path, {
    method,
    headers: {
      authorization: `Bearer ${state.token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    localStorage.removeItem('lp_api_token');
    state.token = '';
    if (askForToken()) return api(path, { method, body });
    throw new Error('Unauthorized.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// small utilities
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Number(x) || fallback silently discards an explicitly-entered 0, since 0 is
// falsy -- exactly wrong for fields like priority where 0 is the whole point
// (Codes editor: "lower wins"). This keeps 0 and only falls back on a value
// that didn't actually parse to a number at all.
function numOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
function toLocalInputValue(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}
function asDate(value) {
  if (!value) return new Date(NaN);
  // D1 datetime('now') gives "YYYY-MM-DD HH:MM:SS" in UTC with no marker.
  const s = String(value);
  return new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
}
function shortTime(value) {
  const d = asDate(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function agoMinutes(value) {
  const d = asDate(value);
  return Number.isNaN(d.getTime()) ? Infinity : (Date.now() - d.getTime()) / 60000;
}
/** Whole days from now until a timestamp. Negative if it has already passed. */
function daysUntil(value) {
  if (!value) return null;
  const d = asDate(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((d.getTime() - Date.now()) / 86400000);
}
function linesToArray(text) {
  return String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
}
function arrayToLines(value) {
  if (Array.isArray(value)) return value.join('\n');
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.join('\n') : '';
  } catch { return ''; }
}
function parseTags(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function currentAccount() {
  return state.accounts.find((a) => a.id === state.account) || state.accounts[0] || null;
}
function accountId() { return state.account || state.accounts[0]?.id; }

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadFile(file) {
  const data_base64 = await fileToBase64(file);
  const res = await api('/api/media', { method: 'POST', body: { data_base64, content_type: file.type } });
  state.media = [];  // library listing is stale now
  return res.key;
}

// ===========================================================================
// 2. tab routing
// ===========================================================================

const VIEW_LOADERS = {
  calendar: renderCalendar,
  inbox: loadInbox,
  codes: loadTriggers,
  knowledge: loadKnowledge,
  media: loadMedia,
  schedule: loadSchedule,
  analytics: loadAnalytics,
  activity: loadLog,
  settings: renderSettings,
};

function switchView(view) {
  state.view = view;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));

  // Only the activity tab polls, and only while it is on screen.
  clearInterval(state.logTimer);
  state.logTimer = null;
  if (view === 'activity' && $('autoRefresh').checked) {
    state.logTimer = setInterval(() => loadLog().catch(() => {}), 5000);
  }

  (VIEW_LOADERS[view] || (() => {}))().catch((err) => toast(err.message));
}

$('tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) switchView(tab.dataset.view);
});

// ===========================================================================
// 3. calendar and compose
// ===========================================================================

function renderWeekdayRow() {
  $('weekdayRow').innerHTML = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    .map((d) => `<span>${d}</span>`).join('');
}

function postsForDay(dateStr) {
  return state.posts.filter((p) => {
    if (state.account && p.account_id !== state.account) return false;
    // scheduled_time is a UTC timestamp; compare the LOCAL calendar date it
    // falls on, the same way dateStr for each cell is built (isoDate uses
    // local get*() accessors), not the UTC date's own first 10 characters.
    // Those disagree for anyone not in UTC whenever a post lands near local
    // midnight, silently placing it on the wrong day.
    return isoDate(new Date(p.scheduled_time)) === dateStr;
  });
}

async function renderCalendar() {
  $('monthLabel').textContent = state.cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  // A day of slack on each side of the local month, in UTC. The server stores
  // scheduled_time in UTC, so a post scheduled late on the last local day of a
  // month (or early on the first) can carry a UTC timestamp that already
  // belongs to the neighboring month. This range just makes sure the fetch
  // does not miss it; postsForDay above does the actual local-day placement.
  const monthStart = startOfMonth(state.cursor);
  const rangeFrom = new Date(monthStart);
  rangeFrom.setDate(rangeFrom.getDate() - 1);
  const rangeTo = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 2);
  state.posts = await api(`/api/posts?from=${rangeFrom.toISOString()}&to=${rangeTo.toISOString()}`);

  // Drafts anywhere in time, not just this month, because a draft waiting on you
  // is easy to lose if it only appears when you happen to scroll to its month.
  state.drafts = (await api(`/api/posts?status=draft${state.account ? `&account_id=${state.account}` : ''}`)) || [];
  const bar = $('draftBar');
  if (state.drafts.length) {
    bar.hidden = false;
    bar.innerHTML =
      `<strong>${state.drafts.length} draft${state.drafts.length > 1 ? 's' : ''} waiting for approval.</strong> ` +
      state.drafts.slice(0, 4).map((d) =>
        `<button class="link-btn" data-post="${esc(d.id)}">${esc(shortTime(d.scheduled_time))} — ${esc((d.caption || '(no caption)').slice(0, 40))}</button>`
      ).join(' · ');
    bar.querySelectorAll('[data-post]').forEach((btn) => {
      btn.onclick = () => {
        const post = state.drafts.find((d) => d.id === btn.dataset.post);
        if (post) openCompose(post);
      };
    });
  } else {
    bar.hidden = true;
  }

  const grid = $('calendarGrid');
  grid.innerHTML = '';

  const first = startOfMonth(state.cursor);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - ((first.getDay() + 6) % 7)); // Monday-first
  const todayStr = isoDate(new Date());

  for (let i = 0; i < 42; i++) {
    const cellDate = new Date(gridStart);
    cellDate.setDate(gridStart.getDate() + i);
    const dateStr = isoDate(cellDate);
    const dayPosts = postsForDay(dateStr);

    const cell = document.createElement('div');
    cell.className =
      'day-cell' +
      (cellDate.getMonth() === state.cursor.getMonth() ? '' : ' out-of-month') +
      (dateStr === todayStr ? ' today' : '');
    cell.innerHTML =
      `<div class="day-number">${cellDate.getDate()}</div>` +
      `<div class="day-dots">${dayPosts.slice(0, 10).map((p) => `<span class="dot ${esc(p.status)}"></span>`).join('')}</div>`;
    cell.onclick = () => openDayPanel(dateStr);
    grid.appendChild(cell);
  }
}

function openDayPanel(dateStr) {
  $('dayPanelTitle').textContent = new Date(dateStr + 'T00:00').toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  const list = $('dayPostList');
  const dayPosts = postsForDay(dateStr);
  list.innerHTML = dayPosts.length ? '' : '<p class="hint">Nothing scheduled.</p>';

  for (const post of dayPosts) {
    const account = state.accounts.find((a) => a.id === post.account_id);
    const slides = post.media_keys ? parseTags(post.media_keys).length : 0;
    const card = document.createElement('div');
    card.className = 'card clickable';
    card.innerHTML = `
      <div class="card-top">
        <span class="post-status ${esc(post.status)}">${esc(post.status)}</span>
        <span class="card-meta">${new Date(post.scheduled_time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
      </div>
      <div class="card-meta">${esc(account ? account.label : post.account_id)} · ${esc(post.media_type)}${slides ? ` · ${slides} slides` : ''}</div>
      <div class="card-body">${esc(post.caption || '(no caption)')}</div>
      ${post.error ? `<div class="card-meta" style="color:var(--red)">${esc(post.error)}</div>` : ''}
      ${post.reach !== null && post.reach !== undefined
        ? `<div class="card-meta">reach ${esc(post.reach)} · saves ${esc(post.saved ?? 0)} · follows ${esc(post.follows ?? 0)}</div>` : ''}
      ${post.published_url ? `<div class="card-meta"><a href="${esc(post.published_url)}" target="_blank" rel="noopener">view on Instagram</a></div>` : ''}
    `;
    card.onclick = () => openCompose(post);
    list.appendChild(card);
  }

  $('addPostForDay').onclick = () => openCompose(null, dateStr);
  $('dayPanelBackdrop').classList.add('open');
}

$('closeDayPanel').onclick = () => $('dayPanelBackdrop').classList.remove('open');
$('prevMonth').onclick = () => {
  state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() - 1, 1);
  renderCalendar().catch((e) => toast(e.message));
};
$('nextMonth').onclick = () => {
  state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + 1, 1);
  renderCalendar().catch((e) => toast(e.message));
};
$('newPostBtn').onclick = () => openCompose(null);
$('runNowBtn').onclick = async () => {
  try {
    const r = await api('/api/run-now', { method: 'POST' });
    toast(
      `Posts: ${r.published.published} published, ${r.published.failed} failed, ${r.published.deferred} retrying. ` +
      `Follow-ups: ${r.followups.sent} sent, ${r.followups.cancelled} cancelled.`
    );
    await renderCalendar();
  } catch (err) { toast(err.message); }
};

// ---- compose ----

function renderCarouselList() {
  const wrap = $('carouselList');
  wrap.innerHTML = state.carouselKeys.length
    ? ''
    : '<p class="hint">No slides yet. Add 2 to 10.</p>';

  state.carouselKeys.forEach((key, index) => {
    const row = document.createElement('div');
    row.className = 'carousel-row';
    row.innerHTML = `
      <span class="slide-index">${index + 1}</span>
      <span class="slide-key">${esc(key)}</span>
      <button type="button" class="icon-btn" data-act="up" ${index === 0 ? 'disabled' : ''}>↑</button>
      <button type="button" class="icon-btn" data-act="down" ${index === state.carouselKeys.length - 1 ? 'disabled' : ''}>↓</button>
      <button type="button" class="icon-btn" data-act="rm">×</button>
    `;
    row.querySelector('[data-act="up"]').onclick = () => {
      [state.carouselKeys[index - 1], state.carouselKeys[index]] = [state.carouselKeys[index], state.carouselKeys[index - 1]];
      renderCarouselList();
    };
    row.querySelector('[data-act="down"]').onclick = () => {
      [state.carouselKeys[index + 1], state.carouselKeys[index]] = [state.carouselKeys[index], state.carouselKeys[index + 1]];
      renderCarouselList();
    };
    row.querySelector('[data-act="rm"]').onclick = () => {
      state.carouselKeys.splice(index, 1);
      renderCarouselList();
    };
    wrap.appendChild(row);
  });
}

function syncComposeMode() {
  const isCarousel = $('fieldMediaType').value === 'CAROUSEL';
  $('carouselWrap').hidden = !isCarousel;
  $('fieldFile').parentElement.hidden = isCarousel;
  $('libraryPickerWrap').hidden = isCarousel;
}

$('fieldMediaType').addEventListener('change', syncComposeMode);

async function openCompose(post, presetDateStr) {
  state.editingPost = post || null;
  state.pendingMediaKey = post ? post.media_key : null;
  state.carouselKeys = post && post.media_keys ? parseTags(post.media_keys) : [];

  $('composeTitle').textContent = post ? `Edit post (${post.status})` : 'New post';
  $('composeError').textContent = '';
  $('mediaStatus').textContent = post ? `Using ${post.media_key}` : 'No file chosen.';
  $('fieldFile').value = '';
  $('fieldAccount').value = post ? post.account_id : accountId() || '';
  $('fieldMediaType').value = post ? post.media_type : 'IMAGE';
  $('fieldCaption').value = post ? post.caption || '' : '';
  $('fieldFirstComment').value = post ? post.first_comment || '' : '';
  $('fieldUseQueue').checked = false;
  $('fieldUseQueue').parentElement.hidden = !!post;

  let dt;
  if (post) dt = new Date(post.scheduled_time);
  else if (presetDateStr) dt = new Date(presetDateStr + 'T12:00');
  else dt = new Date(Date.now() + 3600_000);
  $('fieldTime').value = toLocalInputValue(dt);

  syncComposeMode();
  renderCarouselList();

  $('deletePostBtn').hidden = !post;
  $('deletePostBtn').onclick = async () => {
    if (!post || !confirm('Delete this post?')) return;
    try {
      await api(`/api/posts/${post.id}`, { method: 'DELETE' });
      $('composeBackdrop').classList.remove('open');
      $('dayPanelBackdrop').classList.remove('open');
      await renderCalendar();
      toast('Post deleted');
    } catch (err) { toast(err.message); }
  };

  $('approvePostBtn').hidden = !(post && post.status === 'draft');
  $('approvePostBtn').onclick = async () => {
    try {
      await api(`/api/posts/${post.id}/approve`, { method: 'POST' });
      $('composeBackdrop').classList.remove('open');
      await renderCalendar();
      toast('Approved, it will publish at its scheduled time');
    } catch (err) { toast(err.message); }
  };

  // Library dropdowns are a convenience, so a failure here is not fatal.
  try {
    if (!state.media.length) {
      const listing = await api('/api/media?limit=200');
      state.media = listing.objects || [];
    }
    const options = '<option value="">—</option>' +
      state.media.map((m) => `<option value="${esc(m.key)}">${esc(m.key)}</option>`).join('');
    $('fieldLibrary').innerHTML = options;
    $('fieldLibrary').value = post && !state.carouselKeys.length ? post.media_key : '';
    $('carouselFromLibrary').innerHTML =
      '<option value="">add from library…</option>' +
      state.media.map((m) => `<option value="${esc(m.key)}">${esc(m.key)}</option>`).join('');
  } catch { /* non-fatal */ }

  $('composeBackdrop').classList.add('open');
}

$('closeCompose').onclick = () => $('composeBackdrop').classList.remove('open');

$('fieldLibrary').addEventListener('change', (e) => {
  if (!e.target.value) return;
  state.pendingMediaKey = e.target.value;
  $('mediaStatus').textContent = `Using ${e.target.value} from library`;
});

$('carouselFromLibrary').addEventListener('change', (e) => {
  if (!e.target.value) return;
  if (state.carouselKeys.length >= 10) { toast('A carousel tops out at 10 slides.'); return; }
  state.carouselKeys.push(e.target.value);
  e.target.value = '';
  renderCarouselList();
});

$('fieldFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $('mediaStatus').textContent = 'Uploading…';
  try {
    state.pendingMediaKey = await uploadFile(file);
    $('mediaStatus').textContent = `Uploaded ${state.pendingMediaKey}`;
  } catch (err) {
    $('mediaStatus').textContent = `Upload failed: ${err.message}`;
  }
});

$('carouselUpload').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  if (!files.length) return;
  toast(`Uploading ${files.length} slide(s)…`);
  try {
    for (const file of files) {
      if (state.carouselKeys.length >= 10) { toast('Stopped at 10 slides.'); break; }
      state.carouselKeys.push(await uploadFile(file));
      renderCarouselList();
    }
    e.target.value = '';
    toast('Slides added');
  } catch (err) { toast(err.message); }
});

$('composeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('composeError').textContent = '';

  const mediaType = $('fieldMediaType').value;
  const payload = {
    account_id: $('fieldAccount').value,
    media_type: mediaType,
    caption: $('fieldCaption').value,
    first_comment: $('fieldFirstComment').value || null,
    scheduled_time: new Date($('fieldTime').value).toISOString(),
  };

  if (mediaType === 'CAROUSEL') {
    if (state.carouselKeys.length < 2 || state.carouselKeys.length > 10) {
      $('composeError').textContent = `A carousel needs 2 to 10 slides. You have ${state.carouselKeys.length}.`;
      return;
    }
    payload.media_keys = state.carouselKeys;
    payload.media_key = state.carouselKeys[0];
  } else {
    if (!state.pendingMediaKey) {
      $('composeError').textContent = 'Attach a file, or pick one from the library.';
      return;
    }
    payload.media_key = state.pendingMediaKey;
  }

  try {
    if (state.editingPost) {
      await api(`/api/posts/${state.editingPost.id}`, { method: 'PATCH', body: payload });
      toast('Post updated');
    } else if ($('fieldUseQueue').checked) {
      const r = await api('/api/queue', { method: 'POST', body: payload });
      toast(`Queued for ${new Date(r.scheduled_time).toLocaleString()}`);
    } else {
      await api('/api/posts', { method: 'POST', body: payload });
      toast('Post scheduled');
    }
    $('composeBackdrop').classList.remove('open');
    $('dayPanelBackdrop').classList.remove('open');
    await renderCalendar();
  } catch (err) {
    $('composeError').textContent = err.message;
  }
});

// ===========================================================================
// 4. inbox
// ===========================================================================

async function loadInbox() {
  const status = $('inboxFilter').value;
  const tag = $('tagFilter').value.trim();
  const params = new URLSearchParams({ limit: '80' });
  if (status) params.set('status', status);
  if (state.account) params.set('account_id', state.account);
  state.threads = await api(`/api/conversations?${params}`);

  const shown = tag
    ? state.threads.filter((t) => parseTags(t.tags).includes(tag))
    : state.threads;

  const list = $('threadList');
  list.innerHTML = shown.length ? '' : '<p class="hint">No conversations yet.</p>';

  for (const t of shown) {
    const tags = parseTags(t.tags);
    const el = document.createElement('div');
    el.className = 'thread-item' + (t.status === 'escalated' ? ' escalated' : '') +
      (state.activeThread === t.id ? ' active' : '');
    el.innerHTML = `
      <div><strong>${esc(t.username || t.ig_scoped_id)}</strong>
        <span class="badge ${t.status === 'escalated' ? 'warn' : 'off'}">${esc(t.status)}</span></div>
      <div class="card-meta">${esc(t.channel)} · ${esc(shortTime(t.last_interaction_at))}</div>
      ${tags.length ? `<div class="tag-row">${tags.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div>` : ''}
    `;
    el.onclick = () => openThread(t);
    list.appendChild(el);
  }
}

async function openThread(thread) {
  state.activeThread = thread.id;
  document.querySelectorAll('.thread-item').forEach((el) => el.classList.remove('active'));
  const view = $('threadView');
  view.innerHTML = '<p class="hint">Loading…</p>';

  try {
    const messages = await api(`/api/conversations/${thread.id}/messages?limit=50`);
    const bubbles = messages.map((m) => `
      <div class="bubble ${m.direction === 'in' ? 'in' : 'out'}">${esc(m.body)}
        <div class="bubble-meta">${esc(shortTime(m.created_at))}${m.source ? ` · ${esc(m.source)}` : ''}</div>
      </div>`).join('');

    const tags = parseTags(thread.tags);
    view.innerHTML = `
      <div class="card-top">
        <div class="card-title">${esc(thread.username || thread.ig_scoped_id)}</div>
        <span class="badge ${thread.status === 'escalated' ? 'warn' : 'off'}">${esc(thread.status)}</span>
      </div>
      <div class="card-meta">${esc(thread.channel)} thread on ${esc(thread.account_id)}</div>
      <div class="tag-row" id="threadTags">
        ${tags.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}
        <input class="input tag-input" id="newTag" placeholder="+ tag">
      </div>
      <div class="bubbles">${bubbles || '<p class="hint">No messages recorded.</p>'}</div>
      ${thread.channel === 'dm'
        ? `<div class="reply-row">
             <textarea id="manualReply" rows="2" placeholder="Reply as yourself. Sent exactly as typed."></textarea>
             <button class="btn primary" id="sendManualReply">Send</button>
           </div>
           <p class="hint">Instagram only allows a reply within 24 hours of their last message.</p>`
        : '<p class="hint">Comment threads record the code reply. Reply to comments in the Instagram app.</p>'}
      <div class="form-actions">
        ${thread.status !== 'closed' ? '<button class="btn ghost" id="closeThreadBtn">Mark closed</button>' : ''}
        ${thread.status === 'escalated' ? '<button class="btn ghost" id="unescalateBtn">Hand back to bot</button>' : ''}
      </div>
    `;

    $('newTag').addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const value = e.target.value.trim();
      if (!value) return;
      const next = [...tags, value];
      try {
        await api(`/api/contacts/${thread.contact_id || ''}`, { method: 'PATCH', body: { tags: next } });
        toast('Tagged');
        await loadInbox();
        await openThread({ ...thread, tags: JSON.stringify(next) });
      } catch (err) { toast(err.message); }
    });

    const sendBtn = $('sendManualReply');
    if (sendBtn) {
      sendBtn.onclick = async () => {
        const text = $('manualReply').value.trim();
        if (!text) return;
        sendBtn.disabled = true;
        try {
          await api(`/api/conversations/${thread.id}/reply`, { method: 'POST', body: { text } });
          toast('Reply sent');
          await loadInbox();
          await openThread({ ...thread, status: thread.status === 'escalated' ? 'open' : thread.status });
        } catch (err) {
          toast(err.message);
          sendBtn.disabled = false;
        }
      };
    }
    const closeBtn = $('closeThreadBtn');
    if (closeBtn) closeBtn.onclick = () => setThreadStatus(thread, 'closed');
    const unesc = $('unescalateBtn');
    if (unesc) unesc.onclick = () => setThreadStatus(thread, 'open');
  } catch (err) {
    view.innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

async function setThreadStatus(thread, status) {
  try {
    await api(`/api/conversations/${thread.id}`, { method: 'PATCH', body: { status } });
    toast(`Thread ${status}`);
    await loadInbox();
    await openThread({ ...thread, status });
  } catch (err) { toast(err.message); }
}

$('inboxFilter').addEventListener('change', () => loadInbox().catch((e) => toast(e.message)));
$('tagFilter').addEventListener('change', () => loadInbox().catch((e) => toast(e.message)));
$('refreshInbox').onclick = () => loadInbox().catch((e) => toast(e.message));

// ===========================================================================
// 5. comment codes
// ===========================================================================

async function loadTriggers() {
  state.triggers = await api(`/api/triggers?account_id=${accountId()}`);
  const list = $('triggerList');
  list.innerHTML = state.triggers.length
    ? ''
    : '<p class="hint">No codes yet. Add one, then test it above before it goes live.</p>';

  for (const t of state.triggers) {
    const placeholder = String(t.link || '').includes('REPLACE_ME');
    const card = document.createElement('div');
    card.className = 'card clickable';
    card.innerHTML = `
      <div class="card-top">
        <span class="keyword-chip">${esc(t.keyword)}</span>
        <span>
          ${placeholder ? '<span class="badge warn">link not set</span> ' : ''}
          ${t.followup_active ? '<span class="badge on">follow-up</span> ' : ''}
          <span class="badge ${t.active ? 'on' : 'off'}">${t.active ? 'active' : 'off'}</span>
        </span>
      </div>
      ${t.label ? `<div class="card-meta">${esc(t.label)}</div>` : ''}
      <div class="card-body">${esc(String(t.reply_template).replaceAll('{{link}}', t.link || '(no link)'))}</div>
      ${t.public_reply_text ? `<div class="card-meta">public reply: ${esc(t.public_reply_text)}</div>` : ''}
      <div class="card-meta">
        ${esc(t.match_mode)} match · priority ${esc(t.priority)} · ${esc(t.hit_count)} uses · ${esc(t.clicks ?? 0)} clicks
        ${t.tag ? ` · tags as ${esc(t.tag)}` : ''}
        ${t.ig_media_id ? ` · only on post ${esc(t.ig_media_id)}` : ''}
      </div>
    `;
    card.onclick = () => openTriggerEditor(t);
    list.appendChild(card);
  }
}

function openTriggerEditor(trigger) {
  state.editingTriggerId = trigger ? trigger.id : null;
  const form = $('triggerForm');
  $('triggerTitle').textContent = trigger ? `Edit code ${trigger.keyword}` : 'New code';
  $('triggerError').textContent = '';

  form.keyword.value = trigger?.keyword || '';
  form.label.value = trigger?.label || '';
  form.link.value = trigger?.link || '';
  form.reply_template.value = trigger?.reply_template || 'Here is the link you asked for. {{link}}';
  form.public_reply_text.value = trigger?.public_reply_text || '';
  form.followup_active.checked = !!trigger?.followup_active;
  form.followup_text.value = trigger?.followup_text || '';
  form.followup_delay_hours.value = trigger?.followup_delay_hours ?? 20;
  form.tag.value = trigger?.tag || '';
  form.match_mode.value = trigger?.match_mode || 'word';
  form.priority.value = trigger?.priority ?? 100;
  form.ig_media_id.value = trigger?.ig_media_id || '';
  form.active.checked = trigger ? !!trigger.active : true;

  $('deleteTriggerBtn').hidden = !trigger;
  $('deleteTriggerBtn').onclick = async () => {
    if (!trigger || !confirm(`Delete the ${trigger.keyword} code?`)) return;
    try {
      await api(`/api/triggers/${trigger.id}`, { method: 'DELETE' });
      $('triggerBackdrop').classList.remove('open');
      await loadTriggers();
      toast('Code deleted');
    } catch (err) { toast(err.message); }
  };

  $('triggerBackdrop').classList.add('open');
}

$('newTriggerBtn').onclick = () => openTriggerEditor(null);
$('closeTrigger').onclick = () => $('triggerBackdrop').classList.remove('open');

$('triggerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  $('triggerError').textContent = '';
  const payload = {
    account_id: accountId(),
    keyword: form.keyword.value.trim(),
    label: form.label.value.trim() || null,
    link: form.link.value.trim() || null,
    reply_template: form.reply_template.value,
    public_reply_text: form.public_reply_text.value.trim() || null,
    followup_active: form.followup_active.checked,
    followup_text: form.followup_text.value.trim() || null,
    followup_delay_hours: numOr(form.followup_delay_hours.value, 20),
    tag: form.tag.value.trim() || null,
    match_mode: form.match_mode.value,
    priority: numOr(form.priority.value, 100),
    ig_media_id: form.ig_media_id.value.trim() || null,
    active: form.active.checked,
  };
  try {
    if (state.editingTriggerId) {
      await api(`/api/triggers/${state.editingTriggerId}`, { method: 'PATCH', body: payload });
      toast('Code updated');
    } else {
      await api('/api/triggers', { method: 'POST', body: payload });
      toast('Code created');
    }
    $('triggerBackdrop').classList.remove('open');
    await loadTriggers();
  } catch (err) {
    $('triggerError').textContent = err.message;
  }
});

$('testMatchBtn').onclick = async () => {
  const box = $('testResult');
  try {
    const r = await api('/api/test-match', {
      method: 'POST',
      body: { account_id: accountId(), text: $('testComment').value },
    });
    box.hidden = false;
    if (!r.matched) {
      box.className = 'test-result miss';
      box.textContent = 'No code matches that comment. Nothing would be sent.';
    } else if (r.blocked_reason) {
      box.className = 'test-result blocked';
      box.textContent = `Matched ${r.keyword}, but ${r.blocked_reason}.`;
    } else {
      box.className = 'test-result hit';
      box.innerHTML =
        `Matched <strong>${esc(r.keyword)}</strong>. DM: ${esc(r.would_send)}` +
        (r.would_public_reply ? `<br>Public reply: ${esc(r.would_public_reply)}` : '') +
        (r.would_tag ? `<br>Tags as: ${esc(r.would_tag)}` : '') +
        (r.would_follow_up ? `<br>Follow-up in ${esc(r.would_follow_up.in_hours)}h: ${esc(r.would_follow_up.text)}` : '');
    }
  } catch (err) {
    box.hidden = false;
    box.className = 'test-result blocked';
    box.textContent = err.message;
  }
};

// ===========================================================================
// 6. knowledge base and guardrails
// ===========================================================================

async function loadKnowledge() {
  const account = accountId();
  state.resources = await api(`/api/resources?account_id=${account}`);

  const list = $('resourceList');
  list.innerHTML = state.resources.length
    ? ''
    : '<p class="hint">Empty. Until you add entries, every DM gets the fallback line, because replies may only use facts written here.</p>';

  for (const r of state.resources) {
    const card = document.createElement('div');
    card.className = 'card clickable';
    card.innerHTML = `
      <div class="card-top">
        <span class="card-title">${esc(r.topic)}</span>
        <span class="badge ${r.active ? 'on' : 'off'}">${r.active ? 'active' : 'off'}</span>
      </div>
      <div class="card-body">${esc(r.content)}</div>
      <div class="card-meta">match terms: ${esc(arrayToLines(r.keywords).split('\n').filter(Boolean).join(', ') || 'none')}</div>
    `;
    card.onclick = () => openResourceEditor(r);
    list.appendChild(card);
  }

  const g = await api(`/api/guardrails/${account}`);
  const form = $('guardrailsForm');
  form.voice.value = g.voice || '';
  form.fallback_line.value = g.fallback_line || '';
  form.escalate_conditions.value = arrayToLines(g.escalate_conditions);
  form.banned_topics.value = arrayToLines(g.banned_topics);
  form.must_include.value = arrayToLines(g.must_include);
  form.reply_length_cap.value = g.reply_length_cap ?? 300;
}

function openResourceEditor(resource) {
  state.editingResourceId = resource ? resource.id : null;
  const form = $('resourceForm');
  $('resourceTitle').textContent = resource ? `Edit ${resource.topic}` : 'New entry';
  $('resourceError').textContent = '';

  form.topic.value = resource?.topic || '';
  form.content.value = resource?.content || '';
  form.keywords.value = resource ? arrayToLines(resource.keywords) : '';
  form.links.value = resource
    ? (() => {
        try {
          return JSON.parse(resource.links || '[]').map((l) => `${l.label || 'link'} | ${l.url}`).join('\n');
        } catch { return ''; }
      })()
    : '';
  form.active.checked = resource ? !!resource.active : true;

  $('deleteResourceBtn').hidden = !resource;
  $('deleteResourceBtn').onclick = async () => {
    if (!resource || !confirm(`Delete "${resource.topic}"?`)) return;
    try {
      await api(`/api/resources/${resource.id}`, { method: 'DELETE' });
      $('resourceBackdrop').classList.remove('open');
      await loadKnowledge();
      toast('Entry deleted');
    } catch (err) { toast(err.message); }
  };

  $('resourceBackdrop').classList.add('open');
}

$('newResourceBtn').onclick = () => openResourceEditor(null);
$('closeResource').onclick = () => $('resourceBackdrop').classList.remove('open');

$('resourceForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  $('resourceError').textContent = '';

  const links = linesToArray(form.links.value).map((line) => {
    const [label, url] = line.split('|').map((s) => s.trim());
    return url ? { label, url } : { label: 'link', url: label };
  });

  const payload = {
    account_id: accountId(),
    topic: form.topic.value.trim(),
    content: form.content.value,
    keywords: linesToArray(form.keywords.value),
    links,
    active: form.active.checked,
  };
  try {
    if (state.editingResourceId) {
      await api(`/api/resources/${state.editingResourceId}`, { method: 'PATCH', body: payload });
      toast('Entry updated');
    } else {
      await api('/api/resources', { method: 'POST', body: payload });
      toast('Entry created');
    }
    $('resourceBackdrop').classList.remove('open');
    await loadKnowledge();
  } catch (err) {
    $('resourceError').textContent = err.message;
  }
});

$('guardrailsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  try {
    await api(`/api/guardrails/${accountId()}`, {
      method: 'PUT',
      body: {
        voice: form.voice.value,
        fallback_line: form.fallback_line.value,
        escalate_conditions: linesToArray(form.escalate_conditions.value),
        banned_topics: linesToArray(form.banned_topics.value),
        must_include: linesToArray(form.must_include.value),
        reply_length_cap: numOr(form.reply_length_cap.value, 300),
      },
    });
    toast('Guardrails saved, live on the next message');
  } catch (err) { toast(err.message); }
});

// ===========================================================================
// 7. media library
// ===========================================================================

async function loadMedia() {
  const listing = await api('/api/media?limit=200');
  state.media = listing.objects || [];
  const grid = $('mediaGrid');
  grid.innerHTML = state.media.length ? '' : '<p class="hint">Nothing uploaded yet.</p>';

  for (const m of state.media) {
    const isVideo = /\.(mp4|mov)$/i.test(m.key) || String(m.content_type || '').startsWith('video');
    const tile = document.createElement('div');
    tile.className = 'media-tile';
    tile.innerHTML = `
      ${isVideo
        ? `<video src="${esc(m.url)}" muted preload="metadata"></video>`
        : `<img src="${esc(m.url)}" alt="" loading="lazy">`}
      <div class="media-tile-body">${esc(m.key)}<br>${Math.round((m.size || 0) / 1024)} KB</div>
      <div class="media-tile-actions">
        <button class="btn ghost" data-act="use">Use</button>
        <button class="btn ghost danger" data-act="del">Delete</button>
      </div>
    `;
    tile.querySelector('[data-act="use"]').onclick = () => {
      switchView('calendar');
      openCompose(null).then(() => {
        state.pendingMediaKey = m.key;
        $('mediaStatus').textContent = `Using ${m.key} from library`;
        $('fieldLibrary').value = m.key;
      });
    };
    tile.querySelector('[data-act="del"]').onclick = async () => {
      if (!confirm(`Delete ${m.key}? This cannot be undone.`)) return;
      try {
        await api(`/api/media/${encodeURIComponent(m.key)}`, { method: 'DELETE' });
        toast('Deleted');
        await loadMedia();
      } catch (err) { toast(err.message); }
    };
    grid.appendChild(tile);
  }
}

$('refreshMedia').onclick = () => loadMedia().catch((e) => toast(e.message));
$('libraryUpload').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  if (!files.length) return;
  toast(`Uploading ${files.length} file(s)…`);
  try {
    for (const file of files) await uploadFile(file);
    e.target.value = '';
    toast('Uploaded');
    await loadMedia();
  } catch (err) { toast(err.message); }
});

// ===========================================================================
// 8. posting schedule
// ===========================================================================

async function loadSchedule() {
  const account = currentAccount();
  state.slots = await api(`/api/slots?account_id=${accountId()}`);
  $('slotTzHint').textContent = account
    ? `Times are wall-clock in ${account.timezone}. Daylight saving is handled for you.`
    : '';

  const list = $('slotList');
  list.innerHTML = state.slots.length
    ? ''
    : '<p class="hint">No slots yet. Without slots the queue has nowhere to put a post, so you would schedule each one by hand.</p>';

  for (const slot of state.slots) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-top">
        <span class="card-title">${esc(WEEKDAYS[slot.weekday])} ${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')}</span>
        <span>
          <span class="badge ${slot.active ? 'on' : 'off'}">${slot.active ? 'active' : 'off'}</span>
        </span>
      </div>
      ${slot.label ? `<div class="card-meta">${esc(slot.label)}</div>` : ''}
      <div class="media-tile-actions">
        <button class="btn ghost" data-act="toggle">${slot.active ? 'Turn off' : 'Turn on'}</button>
        <button class="btn ghost danger" data-act="del">Delete</button>
      </div>
    `;
    card.querySelector('[data-act="toggle"]').onclick = async () => {
      await api(`/api/slots/${slot.id}`, { method: 'PATCH', body: { active: !slot.active } });
      await loadSchedule();
    };
    card.querySelector('[data-act="del"]').onclick = async () => {
      if (!confirm('Delete this slot?')) return;
      await api(`/api/slots/${slot.id}`, { method: 'DELETE' });
      await loadSchedule();
    };
    list.appendChild(card);
  }

  const pending = await api(`/api/scheduled-sends?account_id=${accountId()}`);
  const fl = $('followupList');
  const upcoming = pending.filter((p) => p.status === 'pending');
  fl.innerHTML = upcoming.length ? '' : '<p class="hint">Nothing queued.</p>';
  for (const item of upcoming) {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `
      <div class="card-top">
        <span class="card-title">${esc(shortTime(item.send_after))}</span>
        <span class="badge off">${esc(item.status)}</span>
      </div>
      <div class="card-body">${esc(item.body)}</div>
    `;
    fl.appendChild(el);
  }
}

$('slotForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const [hour, minute] = form.time.value.split(':').map(Number);
  try {
    await api('/api/slots', {
      method: 'POST',
      body: {
        account_id: accountId(),
        weekday: Number(form.weekday.value),
        hour, minute,
        label: form.label.value.trim() || null,
      },
    });
    form.label.value = '';
    toast('Slot added');
    await loadSchedule();
  } catch (err) { toast(err.message); }
});

// ===========================================================================
// 9. analytics
// ===========================================================================

async function loadAnalytics() {
  const days = $('analyticsWindow').value;
  const data = await api(`/api/analytics?account_id=${accountId()}&days=${days}`);

  const tile = (label, value, note) => `
    <div class="stat-tile">
      <div class="stat-value">${esc(value)}</div>
      <div class="stat-label">${esc(label)}</div>
      ${note ? `<div class="stat-note">${esc(note)}</div>` : ''}
    </div>`;

  $('statTiles').innerHTML =
    tile('link clicks', data.total_clicks, `last ${days} days, measured here`) +
    tile('posts published', data.posts_published, 'all time') +
    tile('reach', data.insights_totals.reach || 0, 'last 30 posts, from Instagram') +
    tile('saves', data.insights_totals.saved || 0, 'last 30 posts') +
    tile('follows', data.insights_totals.follows || 0, 'last 30 posts');

  const clickList = $('clickTable');
  clickList.innerHTML = data.links.length ? '' : '<p class="hint">No tracked links yet. Codes with a link get one automatically.</p>';
  for (const link of data.links) {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `
      <div class="card-top">
        <span class="card-title">${esc(link.keyword || link.label || link.code)}</span>
        <span class="badge on">${esc(link.recent_clicks)} clicks</span>
      </div>
      <div class="card-meta">/r/${esc(link.code)} → ${esc(link.target_url)}</div>
      <div class="card-meta">${esc(link.total_clicks)} clicks all time</div>
    `;
    clickList.appendChild(el);
  }

  const codeList = $('codeTable');
  codeList.innerHTML = data.codes.length ? '' : '<p class="hint">No codes yet.</p>';
  for (const code of data.codes) {
    // Click-through is the number that matters: how many people who used the
    // code actually opened the link.
    const ctr = code.hits ? Math.round((code.clicks / code.hits) * 100) : null;
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `
      <div class="card-top">
        <span class="keyword-chip">${esc(code.keyword)}</span>
        <span class="badge ${code.active ? 'on' : 'off'}">${code.active ? 'active' : 'off'}</span>
      </div>
      <div class="card-meta">${esc(code.hits)} uses · ${esc(code.clicks)} clicks${ctr !== null ? ` · ${ctr}% opened the link` : ''}</div>
    `;
    codeList.appendChild(el);
  }
}

$('analyticsWindow').addEventListener('change', () => loadAnalytics().catch((e) => toast(e.message)));
$('refreshInsightsBtn').onclick = async () => {
  toast('Pulling Insights from Instagram…');
  try {
    const r = await api('/api/insights/refresh', { method: 'POST' });
    toast(`Insights updated for ${r.updated} post(s), ${r.skipped} skipped`);
    await loadAnalytics();
  } catch (err) { toast(err.message); }
};

// ===========================================================================
// 10. activity log, settings, boot
// ===========================================================================

const GOOD_EVENTS = new Set(['private_reply_sent', 'public_reply_sent', 'dm_sent', 'dm_sent_manual',
  'followup_sent', 'post_published', 'token_refreshed', 'token_stored', 'backup_written', 'post_approved']);
const BAD_EVENTS = new Set(['send_failed', 'post_failed', 'token_refresh_failed', 'webhook_rejected',
  'dm_draft_failed', 'webhook_processing_error', 'backup_failed', 'followup_failed']);
const WARN_EVENTS = new Set(['escalated', 'send_blocked', 'send_delayed', 'webhook_unknown_account',
  'post_deferred', 'post_drafted', 'public_reply_failed', 'first_comment_failed', 'insights_failed']);

async function loadLog() {
  const type = $('logFilter').value;
  const params = new URLSearchParams({ limit: '120' });
  if (type) params.set('event_type', type);
  if (state.account) params.set('account_id', state.account);
  const rows = await api(`/api/log?${params}`);

  const list = $('logList');
  list.innerHTML = rows.length ? '' : '<p class="hint">Nothing logged yet.</p>';

  for (const row of rows) {
    let payload = row.payload;
    try { payload = JSON.parse(row.payload); } catch { /* leave as text */ }
    const summary = typeof payload === 'object' && payload
      ? Object.entries(payload).map(([k, v]) => `${k}: ${String(v).slice(0, 160)}`).join(' · ')
      : String(payload || '');

    const cls = GOOD_EVENTS.has(row.event_type) ? 'good'
      : BAD_EVENTS.has(row.event_type) ? 'bad'
      : WARN_EVENTS.has(row.event_type) ? 'warn' : '';

    const el = document.createElement('div');
    el.className = `log-row ${cls}`;
    el.innerHTML = `
      <span class="log-time">${esc(shortTime(row.created_at))}</span>
      <span class="log-type">${esc(row.event_type)}</span>
      <span class="log-payload">${esc(summary)}</span>
    `;
    list.appendChild(el);
  }
}

$('refreshLog').onclick = () => loadLog().catch((e) => toast(e.message));
$('logFilter').addEventListener('change', () => loadLog().catch((e) => toast(e.message)));
$('autoRefresh').addEventListener('change', () => switchView('activity'));

// ---- settings ----

async function renderSettings() {
  const status = await api('/api/status');
  const account = currentAccount();

  const controls = $('accountControls');
  if (!account) {
    controls.innerHTML = '<p class="hint">No accounts found. Did schema.sql run?</p>';
  } else {
    controls.innerHTML = `
      <div class="control-row">
        <div><strong>Publishing and replies</strong>
          <p class="hint">Master switch. Paused means nothing is sent at all.</p></div>
        <button class="btn ${account.status === 'active' ? 'ghost' : 'primary'}" id="toggleStatus">
          ${account.status === 'active' ? 'Pause account' : 'Activate account'}
        </button>
      </div>
      <div class="control-row">
        <div><strong>Automatic replies</strong>
          <p class="hint">Comment codes and AI DM replies. Leave off until App Review clears and you have tested on a throwaway account.</p></div>
        <button class="btn ghost" id="toggleDm">${account.dm_enabled ? 'Turn replies off' : 'Turn replies on'}</button>
      </div>
      <div class="control-row">
        <div><strong>Hold automated posts for approval</strong>
          <p class="hint">When on, anything pushed in by a skill or the API lands as a draft instead of publishing. Your safety catch.</p></div>
        <button class="btn ghost" id="toggleApproval">${account.require_approval ? 'Stop holding' : 'Hold for approval'}</button>
      </div>
      <div class="control-row">
        <div><strong>Timezone</strong>
          <p class="hint">Posting slots are wall-clock times in this zone.</p></div>
        <input class="input inline" id="tzInput" value="${esc(account.timezone)}" style="max-width:14rem">
      </div>
      <div class="control-row">
        <div><strong>Daily AI reply ceiling</strong>
          <p class="hint">Hard stop on AI-written DM replies per day. Bounds the Anthropic bill if the account gets flooded.</p></div>
        <input class="input inline" id="aiCapInput" type="number" min="0" max="2000" value="${esc(account.max_ai_replies_per_day)}" style="max-width:7rem">
      </div>
      <div class="form-actions"><button class="btn primary" id="saveAccountSettings">Save timezone and ceiling</button></div>
      <div class="control-row">
        <div><strong>Token</strong>
          <p class="hint">
            ${account.has_token
              ? `stored, expires ${esc(account.token_expires_at ? shortTime(account.token_expires_at) : 'unknown')}`
              : 'not set yet'}
            ${account.token_last_error ? `<br><span style="color:var(--red)">last refresh error: ${esc(account.token_last_error)}</span>` : ''}
          </p></div>
        <span class="badge ${account.has_token ? 'on' : 'warn'}">${account.has_token ? 'set' : 'missing'}</span>
      </div>
    `;

    const patch = async (body) => {
      await api(`/api/accounts/${account.id}`, { method: 'PATCH', body });
      await refreshAccounts();
      await renderSettings();
      toast('Updated');
    };
    $('toggleStatus').onclick = () => patch({ status: account.status === 'active' ? 'paused' : 'active' });
    $('toggleDm').onclick = () => patch({ dm_enabled: !account.dm_enabled });
    $('toggleApproval').onclick = () => patch({ require_approval: !account.require_approval });
    $('saveAccountSettings').onclick = () => patch({
      timezone: $('tzInput').value.trim(),
      max_ai_replies_per_day: Number($('aiCapInput').value),
    }).catch((err) => toast(err.message));
  }

  // ---- health ----
  const s = status.secrets_present || {};
  const flag = (ok) => (ok ? '<span class="ok">set</span>' : '<span class="missing">MISSING</span>');
  const hb = status.heartbeats || {};
  const beat = (key, label, staleMinutes) => {
    const at = hb[key]?.updated_at;
    if (!at) return `<div>${label}: <span class="missing">never run</span></div>`;
    const mins = agoMinutes(at);
    const stale = mins > staleMinutes;
    return `<div>${label}: <span class="${stale ? 'missing' : 'ok'}">${shortTime(at)}${stale ? ' (stale)' : ''}</span></div>`;
  };

  $('systemInfo').innerHTML = `
    ${beat('last_publish_pass', 'Publish cron last ran', 45)}
    ${beat('last_daily_pass', 'Daily maintenance last ran', 60 * 30)}
    <div>PUBLIC_ORIGIN: <code>${esc(status.public_origin || '(unset)')}</code> ${
      status.public_origin_configured ? '<span class="ok">ok</span>' : '<span class="missing">still a placeholder, publishing cannot work</span>'}</div>
    <div>Graph API version: <code>${esc(status.graph_version || '?')}</code> · hourly send cap <code>${esc(status.send_cap_per_hour)}</code></div>
    <div>API_TOKEN ${flag(s.API_TOKEN)} · INGEST_TOKEN ${s.INGEST_TOKEN ? '<span class="ok">set</span>' : '<span>not set (optional)</span>'} · TOKEN_ENC_KEY ${flag(s.TOKEN_ENC_KEY)} · META_APP_SECRET ${flag(s.META_APP_SECRET)} · WEBHOOK_VERIFY_TOKEN ${flag(s.WEBHOOK_VERIFY_TOKEN)} · ANTHROPIC_API_KEY ${flag(s.ANTHROPIC_API_KEY)}</div>
    <div>Last logged event: <code>${esc(status.last_event_at ? shortTime(status.last_event_at) : 'never')}</code></div>
  `;

  const origin = status.public_origin_configured ? status.public_origin.replace(/\/$/, '') : '';
  $('complianceLinks').innerHTML = `
    <div>Privacy policy URL: ${origin ? `<a href="${esc(origin)}/privacy" target="_blank" rel="noopener"><code>${esc(origin)}/privacy</code></a>` : '<span class="missing">set PUBLIC_ORIGIN first</span>'}</div>
    <div>Data deletion callback: <code>${origin || '<your worker url>'}/webhook/deletion</code></div>
    <div class="hint">Paste both into the Meta app dashboard. Review checks that the privacy policy is live and reachable.</div>
  `;

  renderBanner(status);
}

/**
 * The dashboard should tell you when the system is quietly broken rather than
 * waiting for you to notice nothing posted. This is what replaces an external
 * alerting service.
 */
function renderBanner(status) {
  const banner = $('banner');
  const problems = [];

  if (!status.public_origin_configured) {
    problems.push('PUBLIC_ORIGIN is still the placeholder in wrangler.toml. Publishing cannot work until it is the real deployed URL.');
  }
  for (const [k, v] of Object.entries(status.secrets_present || {})) {
    // INGEST_TOKEN is optional: only needed once you wire skills up to post.
    if (!v && k !== 'INGEST_TOKEN') problems.push(`Secret ${k} is not set on this Worker.`);
  }
  for (const a of status.accounts || []) {
    if (a.token_last_error) problems.push(`${a.label}: token refresh failed. ${a.token_last_error}`);
    if (!a.has_token) problems.push(`${a.label}: no access token stored yet.`);
    // The daily cron refreshes 10 days out. Still under 5 days means the
    // refresh is not working, which is the failure that silently kills
    // everything on day 61.
    const daysLeft = daysUntil(a.token_expires_at);
    if (daysLeft !== null && daysLeft < 5) {
      problems.push(`${a.label}: access token expires in ${daysLeft} day(s) and the daily refresh has not renewed it.`);
    }
  }

  // A Cloudflare cron that stops firing fails silently. This is the pulse check.
  const pulse = status.heartbeats?.last_publish_pass?.updated_at;
  if (pulse && agoMinutes(pulse) > 45) {
    problems.push(`The publish cron has not run since ${shortTime(pulse)}. It should run every 15 minutes.`);
  }

  if (!problems.length) { banner.hidden = true; return; }
  banner.hidden = false;
  banner.className = 'banner';
  banner.innerHTML = problems.map((p) => `• ${esc(p)}`).join('<br>');
}

$('tokenForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const account = currentAccount();
  const token = $('tokenInput').value.trim();
  if (!account || !token) return;
  $('tokenResult').textContent = 'Checking with Instagram…';
  try {
    const r = await api(`/api/accounts/${account.id}/token`, { method: 'POST', body: { token } });
    $('tokenInput').value = '';
    $('tokenResult').textContent = `Saved and encrypted. Verified as @${r.username || '?'}, expires ${shortTime(r.token_expires_at)}.`;
    await refreshAccounts();
    await renderSettings();
  } catch (err) {
    $('tokenResult').textContent = err.message;
  }
});

$('testTokenBtn').onclick = async () => {
  const account = currentAccount();
  if (!account) return;
  $('tokenResult').textContent = 'Testing…';
  try {
    const r = await api(`/api/accounts/${account.id}/test`);
    $('tokenResult').textContent = `Working. Instagram says this token belongs to @${r.username} (${r.id}).`;
  } catch (err) {
    $('tokenResult').textContent = err.message;
  }
};

$('refreshTokensBtn').onclick = async () => {
  try {
    const r = await api('/api/refresh-tokens', { method: 'POST' });
    toast(`Refresh pass done, ${r.results.length} account(s) checked`);
    await refreshAccounts();
    await renderSettings();
  } catch (err) { toast(err.message); }
};

$('backupBtn').onclick = async () => {
  try {
    const r = await api('/api/backup', { method: 'POST' });
    toast(r.ok ? `Backup written to ${r.key}` : `Backup failed: ${r.error}`);
  } catch (err) { toast(err.message); }
};

$('exportBtn').onclick = async () => {
  // Fetched with auth then saved locally, because a plain link cannot carry the
  // bearer token.
  try {
    const res = await fetch('/api/export', { headers: { authorization: `Bearer ${state.token}` } });
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leadspanic-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Export downloaded');
  } catch (err) { toast(err.message); }
};

$('forgetTokenBtn').onclick = () => {
  localStorage.removeItem('lp_api_token');
  state.token = '';
  toast('Forgotten. Reload to enter it again.');
};

// ---- boot ----

async function refreshAccounts() {
  state.accounts = await api('/api/accounts');
  if (!state.accounts.length) return;
  if (!state.accounts.some((a) => a.id === state.account)) {
    state.account = state.accounts[0].id;
    localStorage.setItem('lp_account', state.account);
  }

  $('accountSwitcher').innerHTML = state.accounts
    .map((a) => `<option value="${esc(a.id)}"${a.id === state.account ? ' selected' : ''}>${esc(a.label)}</option>`)
    .join('');
  $('fieldAccount').innerHTML = state.accounts
    .map((a) => `<option value="${esc(a.id)}">${esc(a.label)}</option>`).join('');

  const account = currentAccount();
  const pill = $('statusPill');
  if (account) {
    const live = account.status === 'active';
    pill.textContent = live ? (account.dm_enabled ? 'live · replies on' : 'live · replies off') : 'paused';
    pill.classList.toggle('live', live);
  }
}

$('accountSwitcher').addEventListener('change', async (e) => {
  state.account = e.target.value;
  localStorage.setItem('lp_account', state.account);
  await refreshAccounts();
  switchView(state.view);
});

(async function init() {
  renderWeekdayRow();
  try {
    await refreshAccounts();
    renderBanner(await api('/api/status'));
    await renderCalendar();
  } catch (err) {
    toast(err.message);
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
})();
