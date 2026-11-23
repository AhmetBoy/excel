// Associate lookup: "last stow" card and the idle gaps of the current
// shift, rendered under the container cards (see shared/stowActivity.js).

import { describeSourceStatus } from '../shared/resultsView.js';
import { formatLocalDateTime } from '../shared/shifts.js';
import {
  DEFAULT_GAP_MINUTES,
  findIdleGaps,
  formatAgo,
  formatDuration,
  GAP_OPTIONS,
  preferredProductId,
} from '../shared/stowActivity.js';

const GAP_STORAGE_KEY = 'stowGapMinutes';
const REFRESH_MS = 30_000; // "x dk önce" and the ongoing gap keep counting

const GAP_KIND_LABELS = {
  start: 'vardiya başı',
  between: '',
  ongoing: 'devam ediyor',
  none: 'hiç stow yok',
};

function el(tag, className, textContent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent != null) node.textContent = textContent;
  return node;
}

const pad = (n) => String(n).padStart(2, '0');

function clock(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function readGapMinutes() {
  try {
    const value = Number(localStorage.getItem(GAP_STORAGE_KEY));
    return GAP_OPTIONS.includes(value) ? value : DEFAULT_GAP_MINUTES;
  } catch {
    return DEFAULT_GAP_MINUTES;
  }
}

function saveGapMinutes(value) {
  try {
    localStorage.setItem(GAP_STORAGE_KEY, String(value));
  } catch {
    // per-viewer convenience only
  }
}

export function productImage(stow, size) {
  const media = el('div', `product-image ${size}`);
  if (stow.imageUrl) {
    const img = document.createElement('img');
    img.src = stow.imageUrl;
    img.alt = stow.title ?? stow.asin ?? '';
    img.loading = 'lazy';
    img.addEventListener('error', () => media.replaceChildren(el('span', null, 'Görsel yok')));
    media.append(img);
  } else {
    media.append(el('span', null, 'Görsel yok'));
  }
  return media;
}

/** "LPN: LPNUIN13…" / "X ASIN: X002…" / "ASIN: B0…" (see preferredProductId). */
function productLabel(stow) {
  const product = preferredProductId(stow);
  return product ? `${product.kind}: ${product.id}` : '—';
}

function stowWhen(stow, nowMs) {
  return `${formatLocalDateTime(new Date(stow.timeMs))} · ${formatAgo(stow.timeMs, nowMs)}`;
}

function lastStowCard(stow, nowMs) {
  const card = el('div', 'product-card last-stow');
  const info = el('div', 'product-info');

  const head = el('div', 'product-head');
  head.append(el('strong', 'last-stow-ago', formatAgo(stow.timeMs, nowMs)));
  if (stow.failed) head.append(el('span', 'badge-failed', 'Hatalı stow'));
  if (stow.highValue === true) head.append(el('span', 'badge-hrv', 'HRV'));

  info.append(
    head,
    el('div', 'product-meta', `Saat: ${formatLocalDateTime(new Date(stow.timeMs))}`),
    el('div', 'last-stow-bin', `Adres: ${stow.bin}`),
    el('div', 'product-meta', `${productLabel(stow)} · ${stow.quantity} adet`),
    el('div', 'product-title', stow.title ?? ''),
    el('div', 'product-meta', `Tote: ${stow.tote ?? '—'}`)
  );
  card.append(productImage(stow, 'large'), info);
  return card;
}

function recentList(stows, nowMs) {
  const details = el('details', 'recent-stows');
  details.appendChild(el('summary', null, `Son ${stows.length} stow`));
  const list = el('ul', 'stow-list');
  for (const stow of stows) {
    const item = el('li', 'recent-stow');
    const text = el('div');
    text.append(
      el('strong', null, stow.bin),
      el('span', null, ` · ${productLabel(stow)}`),
      el('div', 'product-meta', stowWhen(stow, nowMs))
    );
    if (stow.failed) text.append(el('span', 'badge-failed', 'Hatalı'));
    item.append(productImage(stow, 'small'), text);
    list.appendChild(item);
  }
  details.appendChild(list);
  return details;
}

function gapSection(activity, minMinutes, nowMs, onChange) {
  const section = el('div', 'idle-gaps');
  const head = el('div', 'idle-gaps-head');
  head.append(el('strong', null, `Stow yapılmayan süreler · ${activity.shiftLabel}`));

  const picker = el('div', 'gap-picker');
  for (const option of GAP_OPTIONS) {
    const button = el('button', `small-button${option === minMinutes ? ' active' : ''}`, `${option} dk+`);
    button.type = 'button';
    button.addEventListener('click', () => onChange(option));
    picker.appendChild(button);
  }
  head.appendChild(picker);
  section.appendChild(head);

  const stows = (activity.shiftStows ?? []).map((timeMs) => ({ timeMs }));
  const gaps = findIdleGaps(stows, {
    fromMs: Date.parse(activity.shiftStart),
    toMs: nowMs,
    minMinutes,
  });

  const stowCount = stows.length;
  if (gaps.length === 0) {
    section.appendChild(
      el('div', 'stow-ok', `${minMinutes} dk ve üzeri boşluk yok · vardiyada ${stowCount} stow`)
    );
    return section;
  }

  const total = gaps.reduce((sum, g) => sum + g.minutes, 0);
  section.appendChild(
    el(
      'div',
      'idle-total',
      `Toplam ${formatDuration(total)} boşluk · ${gaps.length} aralık · vardiyada ${stowCount} stow`
    )
  );

  const list = el('ul', 'gap-list');
  for (const gap of gaps) {
    const level = gap.minutes >= 30 ? 'gap-high' : gap.minutes >= 20 ? 'gap-mid' : 'gap-low';
    const item = el('li', level);
    const end = gap.kind === 'ongoing' || gap.kind === 'none' ? 'şimdi' : clock(gap.endMs);
    item.append(
      el('span', 'gap-range', `${clock(gap.startMs)} – ${end}`),
      el('strong', 'gap-minutes', formatDuration(gap.minutes))
    );
    const label = GAP_KIND_LABELS[gap.kind];
    if (label) item.append(el('span', 'gap-kind', label));
    list.appendChild(item);
  }
  section.appendChild(list);
  return section;
}

/**
 * Renders the associate's last stow and idle gaps into `target`, and keeps
 * the relative times current while the block stays on screen.
 *
 * @param {HTMLElement} target
 * @param {object|undefined} activity - lookupUser().stowActivity
 */
export function renderStowActivity(target, activity) {
  target.classList.add('stow-activity');
  let minMinutes = readGapMinutes();

  const draw = () => {
    const nowMs = Date.now();
    // Keep "Son N stow" open across the periodic redraw.
    const recentOpen = target.querySelector('details.recent-stows')?.open ?? false;
    const parts = [el('h3', 'stow-activity-title', 'Son stow')];

    if (!activity || (activity.status !== 'ok' && activity.status !== 'no_data' && activity.status !== 'partial_failure')) {
      const reason = activity?.message ?? describeSourceStatus(activity?.status ?? 'error');
      parts.push(el('span', 'status-badge error', `Stow geçmişi alınamadı: ${reason}`));
      target.replaceChildren(...parts);
      return;
    }

    const recent = activity.recent ?? [];
    if (recent.length === 0) {
      parts.push(el('div', 'stow-ok', 'Son 2 günde stow kaydı bulunamadı.'));
    } else {
      parts.push(lastStowCard(recent[0], nowMs));
      if (recent.length > 1) {
        const details = recentList(recent.slice(1), nowMs);
        details.open = recentOpen;
        parts.push(details);
      }
    }
    if (activity.status === 'partial_failure') {
      parts.push(el('span', 'status-badge warn', 'Stow geçmişi eksik olabilir'));
    }

    parts.push(
      gapSection(activity, minMinutes, nowMs, (value) => {
        minMinutes = value;
        saveGapMinutes(value);
        draw();
      })
    );
    target.replaceChildren(...parts);
  };

  draw();
  const timer = setInterval(() => {
    if (!target.isConnected) clearInterval(timer);
    else draw();
  }, REFRESH_MS);
}
