import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000; // R4
const board = document.querySelector('[data-testid="board"]');
const loader = board.querySelector('[data-testid="loader"]');
const empty = board.querySelector('[data-testid="empty"]');
const list = board.querySelector('[data-testid="incident-list"]');
const status = document.getElementById('status');
const newBar = board.querySelector('[data-testid="new-bar"]');

// Acked ids survive refreshes (and reloads): the row keeps its mark.
const ACK_KEY = 'sched-board-acked';
const acked = new Map(JSON.parse(localStorage.getItem(ACK_KEY) || '[]'));
const saveAcked = () => localStorage.setItem(ACK_KEY, JSON.stringify([...acked]));

// R5: viewer's local time zone and order. A generic "en" in a European zone gets dd/mm (en-GB).
function viewerLocale() {
  const lang = navigator.languages?.[0] || navigator.language || 'en-GB';
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  if (/^en(-US)?$/i.test(lang) && tz.startsWith('Europe/')) return 'en-GB';
  return lang;
}
const fmt = new Intl.DateTimeFormat(viewerLocale(), {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const localTime = (iso) => fmt.format(new Date(iso));

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function ackCell(id) {
  const a = acked.get(id);
  return a
    ? `<span data-testid="acked" class="acked" title="acked ${esc(a)}">✓ acked</span>`
    : `<button data-testid="ack" class="ack" type="button">Ack</button>`;
}

function rowHtml(i) {
  return `<li data-testid="incident-row" data-id="${esc(i.id)}" class="row ${esc(i.severity)}">
    <span class="id">${esc(i.id)}</span>
    <span class="sev">${esc(i.severity)}</span>
    <span class="what">${esc(i.service)} · ${esc(i.region)} · ${esc(i.summary)}</span>
    <time datetime="${esc(i.openedAt)}" title="${esc(i.openedAt)}">${esc(localTime(i.openedAt))}</time>
    <span class="act">${ackCell(i.id)}</span>
  </li>`;
}

// Keyed render: existing rows stay as they are (no rebuild under the pointer); new ones go in on top (R1).
function render(incidents) {
  const sorted = [...incidents].sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
  const keep = new Set(sorted.map((i) => i.id));
  for (const li of [...list.children]) if (!keep.has(li.dataset.id)) li.remove();
  let prev = null;
  for (const i of sorted) {
    let li = list.querySelector(`[data-testid="incident-row"][data-id="${CSS.escape(i.id)}"]`);
    if (!li) {
      const t = document.createElement('template');
      t.innerHTML = rowHtml(i).trim();
      li = t.content.firstElementChild;
      if (loaded) li.classList.add('new');
    }
    const want = prev ? prev.nextElementSibling : list.firstElementChild;
    if (want !== li) list.insertBefore(li, want);
    prev = li;
  }
  loader.hidden = true; // R3
  loader.remove();
  empty.hidden = sorted.length > 0;
  list.hidden = sorted.length === 0;
}

// R2: Ack per row.
list.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-testid="ack"]');
  if (!btn) return;
  const row = btn.closest('[data-testid="incident-row"]');
  const id = row.dataset.id;
  btn.disabled = true;
  btn.textContent = 'Acking…';
  try {
    const reply = await ack(id);
    acked.set(id, reply.ackedAt);
    saveAcked();
    btn.parentElement.innerHTML = ackCell(id);
  } catch (err) {
    console.error(err);
    btn.disabled = false;
    btn.textContent = 'Retry ack';
  }
});

// Product's decision (after SCHED-4511): the list holds still while it is on screen. New incidents wait
// behind the "N new" bar and come in on click, so a row never moves under the pointer.
let loaded = false;
let latest = [];
function showBar(incidents) {
  const onScreen = new Set([...list.children].map((li) => li.dataset.id));
  const waiting = incidents.filter((i) => !onScreen.has(i.id));
  if (!waiting.length) {
    newBar.hidden = true;
    return;
  }
  const sev1 = waiting.filter((i) => i.severity === 'sev1').length;
  newBar.textContent = `${waiting.length} new incident${waiting.length > 1 ? 's' : ''}${sev1 ? ` · ${sev1} sev1` : ''} — show`;
  newBar.classList.toggle('sev1', sev1 > 0);
  newBar.hidden = false;
}
newBar.addEventListener('click', () => {
  render(latest);
  newBar.hidden = true;
});
async function tick() {
  try {
    const page = await fetchIncidents();
    latest = page.incidents;
    if (!loaded || list.children.length === 0) render(latest);
    else showBar(latest);
    loaded = true;
    status.textContent = `· updated ${new Date(page.updatedAt).toLocaleTimeString(viewerLocale())}`;
    status.classList.remove('stale');
  } catch (err) {
    console.error(err);
    status.textContent = '· offline, retrying';
    status.classList.add('stale');
  } finally {
    setTimeout(tick, REFRESH_MS); // R4: one request at a time, every 2 s
  }
}
tick();
