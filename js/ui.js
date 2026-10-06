// ── Small DOM / formatting helpers, icons, toasts, layers (modal & drawer) ──

export const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function relTime(ts) {
  const d = Date.now() - ts;
  if (d < 45e3) return 'just now';
  const m = Math.round(d / 6e4);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

export function fmtDT(ts) {
  return new Date(ts).toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
}

// ── Icons (Lucide-style, stroked) ──
const I = (paths, vb = '0 0 24 24') =>
  `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const icons = {
  glasses: I('<circle cx="6" cy="15" r="4"/><circle cx="18" cy="15" r="4"/><path d="M14 15a2 2 0 0 0-4 0"/><path d="M2.5 13 5 7c.7-1.3 1.4-2 3-2"/><path d="M21.5 13 19 7c-.7-1.3-1.5-2-3-2"/>'),
  box: I('<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>'),
  warehouse: I('<path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"/><path d="M6 18h12"/><path d="M6 14h12"/><rect width="12" height="12" x="6" y="10"/>'),
  truck: I('<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>'),
  flag: I('<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>'),
  check: I('<path d="M20 6 9 17l-5-5"/>'),
  checks: I('<path d="M18 6 7 17l-4-4"/><path d="m22 10-7.5 7.5L13 16"/>'),
  plus: I('<path d="M5 12h14"/><path d="M12 5v14"/>'),
  minus: I('<path d="M5 12h14"/>'),
  x: I('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  search: I('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
  logout: I('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>'),
  clock: I('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  arrowRight: I('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'),
  chevronRight: I('<path d="m9 18 6-6-6-6"/>'),
  zap: I('<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>'),
  store: I('<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/><path d="M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7"/>'),
  wrench: I('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'),
  history: I('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'),
  inbox: I('<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'),
  send: I('<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>'),
  printer: I('<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/>'),
  settings: I('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
  trash: I('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>'),
  tag: I('<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>'),
  grip: I('<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>'),
  receipt: I('<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M8 7h8"/><path d="M8 11h8"/><path d="M8 15h5"/>'),
  lens: I('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M6.9 7.3a7 7 0 0 1 2.7-2"/>'),
};

// ── Status pill ──
// Most pills read their words straight out of a status map. The fitting log's
// depend on the order too — which fitter, which branch — so it builds the step
// itself and calls stepPill. The text sits in its own span so a long label can
// ellipsis inside a narrow column instead of spilling out of the pill.
export function stepPill(s, { flash = false, title = '' } = {}) {
  return `<span class="pill s-${s.color}${flash ? ' pill-flash' : ''}"${title ? ` title="${esc(title)}"` : ''}>`
    + `<i class="dot"></i><span class="pill-t">${esc(s.label)}</span></span>`;
}
export const pill = (def, key, opts) => stepPill(def[key], opts);

export function urgentTag() {
  return `<span class="pill s-red urgent-tag">${icons.zap}Urgent</span>`;
}

export function locChip(code, name) {
  return `<span class="loc-chip" title="${esc(name ?? '')}">${esc(code)}</span>`;
}

// ── Toasts ──
export function toast({ title, sub = '', tone = 'info', ms = 5200 }) {
  let host = document.getElementById('toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; document.body.appendChild(host); }
  const t = document.createElement('div');
  t.className = `toast tone-${tone}`;
  t.innerHTML = `<i class="t-dot"></i><div class="t-body"><div class="t-title">${esc(title)}</div>${sub ? `<div class="t-sub">${esc(sub)}</div>` : ''}</div>`;
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); t.addEventListener('transitionend', () => t.remove(), { once: true }); setTimeout(() => t.remove(), 600); }, ms);
  while (host.children.length > 4) host.firstChild.remove();
}

// ── Layers: one active modal or drawer at a time ──
let activeLayer = null;

export function openLayer(kind, renderFn, { onClose } = {}) {
  closeLayer();
  const overlay = document.createElement('div');
  overlay.className = `layer-overlay ${kind === 'drawer' ? 'is-drawer' : 'is-modal'}`;
  const panel = document.createElement('div');
  panel.className = kind === 'drawer' ? 'drawer' : 'modal';
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const layer = {
    el: panel, overlay, kind,
    update() { if (activeLayer === layer) panel.innerHTML = renderFn(); },
    close() {
      if (activeLayer !== layer) return;
      activeLayer = null;
      overlay.classList.remove('open');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => overlay.remove(), 280);
      onClose?.();
    },
  };
  const onKey = e => { if (e.key === 'Escape') layer.close(); };
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) layer.close(); });
  document.addEventListener('keydown', onKey);

  panel.innerHTML = renderFn();
  requestAnimationFrame(() => overlay.classList.add('open'));
  activeLayer = layer;
  return layer;
}

export function closeLayer() { activeLayer?.close(); }
export function currentLayer() { return activeLayer; }
