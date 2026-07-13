/**
 * Minimal SVG chart engine: multi-series line charts with a crosshair +
 * tooltip hover layer, a legend, an accessible table view, and a polar
 * sky-dome plot. No dependencies; colors come from CSS custom properties so
 * light/dark themes swap without re-rendering logic.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(name, attrs = {}) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function el(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Clean tick values covering [min,max] with roughly `count` steps. */
export function niceTicks(min, max, count = 5) {
  if (min === max) max = min + 1;
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || mag * 10;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
    ticks.push(Math.abs(v) < 1e-9 ? 0 : +v.toFixed(10));
  }
  return ticks;
}

/**
 * Render a multi-series line chart.
 *
 * config = {
 *   series: [{ name, colorVar, points: [{x, y}], area?, dash? }],
 *   xDomain: [min, max], yDomain: [min, max],
 *   xTicks: [{ v, label }], yTicks?: number[] | {v,label}[],
 *   yLabel?, formatX(x) -> string, formatY(y, seriesName) -> string,
 *   markers?: [{ x, y, colorVar, label? }],
 *   refLines?: [{ x, label }],           // vertical reference lines
 *   tableCaption?, tableSampleEvery?     // table view row thinning
 * }
 *
 * Returns { update(newConfig) } and re-renders on container resize.
 */
export function renderLineChart(container, config) {
  let cfg = config;
  container.classList.add('chart-host');

  const wrap = el('div', 'chart-wrap');
  const tooltip = el('div', 'chart-tooltip');
  tooltip.hidden = true;
  container.textContent = '';
  container.appendChild(wrap);
  container.appendChild(tooltip);

  const legend = el('div', 'chart-legend');
  const tableDetails = el('details', 'chart-table');
  container.appendChild(legend);
  container.appendChild(tableDetails);

  let width = 0;

  function draw() {
    width = Math.max(280, container.clientWidth);
    const height = Math.min(320, Math.max(200, width * 0.45));
    const m = { top: 14, right: 18, bottom: 30, left: 44 };
    const iw = width - m.left - m.right;
    const ih = height - m.top - m.bottom;

    const [x0, x1] = cfg.xDomain;
    const [y0, y1] = cfg.yDomain;
    const X = (x) => m.left + ((x - x0) / (x1 - x0)) * iw;
    const Y = (y) => m.top + (1 - (y - y0) / (y1 - y0)) * ih;

    const svg = svgEl('svg', {
      viewBox: `0 0 ${width} ${height}`,
      width: '100%',
      height,
      role: 'img',
      tabindex: '0',
    });
    if (cfg.ariaLabel) svg.setAttribute('aria-label', cfg.ariaLabel);

    // Clip series to the plot area so below-domain segments (night) don't
    // spill over the axis labels.
    const clipId = `clip-${Math.random().toString(36).slice(2, 9)}`;
    const defs = svgEl('defs');
    const clip = svgEl('clipPath', { id: clipId });
    clip.appendChild(svgEl('rect', { x: m.left, y: m.top - 8, width: iw, height: ih + 8 }));
    defs.appendChild(clip);
    svg.appendChild(defs);
    const plotG = svgEl('g', { 'clip-path': `url(#${clipId})` });

    // Gridlines + y ticks
    const yTicks = (cfg.yTicks || niceTicks(y0, y1)).map((t) =>
      typeof t === 'object' ? t : { v: t, label: String(t) }
    );
    for (const t of yTicks) {
      if (t.v < y0 - 1e-9 || t.v > y1 + 1e-9) continue;
      svg.appendChild(svgEl('line', {
        x1: m.left, x2: m.left + iw, y1: Y(t.v), y2: Y(t.v), class: 'grid',
      }));
      const txt = svgEl('text', { x: m.left - 8, y: Y(t.v) + 3.5, class: 'tick', 'text-anchor': 'end' });
      txt.textContent = t.label;
      svg.appendChild(txt);
    }
    // Baseline
    svg.appendChild(svgEl('line', {
      x1: m.left, x2: m.left + iw, y1: Y(y0), y2: Y(y0), class: 'axis',
    }));
    // X ticks (edge labels anchored inward so they never clip)
    for (const t of cfg.xTicks) {
      const tx = X(t.v);
      const anchor = tx < m.left + 12 ? 'start' : tx > width - m.right - 12 ? 'end' : 'middle';
      const txt = svgEl('text', { x: tx, y: height - 8, class: 'tick', 'text-anchor': anchor });
      txt.textContent = t.label;
      svg.appendChild(txt);
    }
    if (cfg.yLabel) {
      const txt = svgEl('text', { x: m.left, y: 10, class: 'tick', 'text-anchor': 'start' });
      txt.textContent = cfg.yLabel;
      svg.appendChild(txt);
    }

    // Vertical reference lines (solstices, "now", etc.)
    for (const r of cfg.refLines || []) {
      svg.appendChild(svgEl('line', {
        x1: X(r.x), x2: X(r.x), y1: m.top, y2: m.top + ih, class: 'refline',
      }));
      if (r.label) {
        const flip = X(r.x) > m.left + iw * 0.88;
        const txt = svgEl('text', {
          x: X(r.x) + (flip ? -4 : 4), y: m.top + 10, class: 'tick',
          'text-anchor': flip ? 'end' : 'start',
        });
        txt.textContent = r.label;
        svg.appendChild(txt);
      }
    }

    // Series
    for (const s of cfg.series) {
      const pts = s.points;
      if (!pts.length) continue;
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(2)},${Y(p.y).toFixed(2)}`).join('');
      if (s.area) {
        const dArea = d + `L${X(pts[pts.length - 1].x).toFixed(2)},${Y(y0).toFixed(2)}L${X(pts[0].x).toFixed(2)},${Y(y0).toFixed(2)}Z`;
        plotG.appendChild(svgEl('path', {
          d: dArea, fill: `var(${s.colorVar})`, 'fill-opacity': '0.1', stroke: 'none',
        }));
      }
      plotG.appendChild(svgEl('path', {
        d, fill: 'none', stroke: `var(${s.colorVar})`,
        'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        ...(s.dash ? { 'stroke-dasharray': s.dash } : {}),
      }));
    }

    // Markers (e.g. "sun now") - filled dot with surface ring
    for (const mk of cfg.markers || []) {
      if (mk.x < x0 || mk.x > x1 || mk.y < y0 || mk.y > y1) continue;
      plotG.appendChild(svgEl('circle', {
        cx: X(mk.x), cy: Y(mk.y), r: 6,
        fill: `var(${mk.colorVar})`, stroke: 'var(--surface-1)', 'stroke-width': 2,
      }));
      if (mk.label) {
        const txt = svgEl('text', {
          x: X(mk.x), y: Y(mk.y) - 10, class: 'marker-label', 'text-anchor': 'middle',
        });
        txt.textContent = mk.label;
        plotG.appendChild(txt);
      }
    }
    svg.appendChild(plotG);

    // Crosshair + hover layer
    const crosshair = svgEl('line', { y1: m.top, y2: m.top + ih, class: 'crosshair' });
    crosshair.style.display = 'none';
    svg.appendChild(crosshair);
    const hoverG = svgEl('g', { 'clip-path': `url(#${clipId})` });
    svg.appendChild(hoverG);
    const hoverDots = (cfg.series || []).map((s) => {
      const c = svgEl('circle', {
        r: 4.5, fill: `var(${s.colorVar})`, stroke: 'var(--surface-1)', 'stroke-width': 2,
      });
      c.style.display = 'none';
      hoverG.appendChild(c);
      return c;
    });

    const xsRef = cfg.series[0] ? cfg.series[0].points.map((p) => p.x) : [];

    function showAt(xVal) {
      if (!xsRef.length) return;
      // snap to nearest sample of the first series
      let lo = 0, hi = xsRef.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (xsRef[mid] < xVal) lo = mid; else hi = mid;
      }
      const idx = Math.abs(xsRef[lo] - xVal) <= Math.abs(xsRef[hi] - xVal) ? lo : hi;
      const snapX = xsRef[idx];

      crosshair.setAttribute('x1', X(snapX));
      crosshair.setAttribute('x2', X(snapX));
      crosshair.style.display = '';

      tooltip.textContent = '';
      const head = el('div', 'tt-head', cfg.formatX ? cfg.formatX(snapX) : String(snapX));
      tooltip.appendChild(head);
      cfg.series.forEach((s, si) => {
        const p = s.points.find((q) => q.x === snapX) || s.points[Math.min(idx, s.points.length - 1)];
        if (!p) { hoverDots[si].style.display = 'none'; return; }
        hoverDots[si].setAttribute('cx', X(p.x));
        hoverDots[si].setAttribute('cy', Y(p.y));
        hoverDots[si].style.display = '';
        const row = el('div', 'tt-row');
        const key = el('span', 'tt-key');
        key.style.background = `var(${s.colorVar})`;
        const val = el('strong', 'tt-val', cfg.formatY ? cfg.formatY(p.y, s.name) : String(p.y));
        const name = el('span', 'tt-name', s.name);
        row.appendChild(key); row.appendChild(val); row.appendChild(name);
        tooltip.appendChild(row);
      });
      tooltip.hidden = false;

      const hostRect = container.getBoundingClientRect();
      const svgRect = svg.getBoundingClientRect();
      const scale = svgRect.width / width;
      const px = svgRect.left - hostRect.left + X(snapX) * scale;
      const flip = px > hostRect.width - 170;
      tooltip.style.left = flip ? '' : `${px + 12}px`;
      tooltip.style.right = flip ? `${hostRect.width - px + 12}px` : '';
      tooltip.style.top = `${svgRect.top - hostRect.top + m.top}px`;
      return idx;
    }

    function hide() {
      crosshair.style.display = 'none';
      hoverDots.forEach((d) => (d.style.display = 'none'));
      tooltip.hidden = true;
    }

    let focusIdx = null;
    svg.addEventListener('pointermove', (ev) => {
      const rect = svg.getBoundingClientRect();
      const fx = ((ev.clientX - rect.left) / rect.width) * width;
      const xVal = x0 + ((fx - m.left) / iw) * (x1 - x0);
      focusIdx = showAt(Math.min(x1, Math.max(x0, xVal)));
    });
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('focus', () => { focusIdx = showAt(xsRef[Math.floor(xsRef.length / 2)] ?? x0); });
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      ev.preventDefault();
      if (focusIdx == null) focusIdx = Math.floor(xsRef.length / 2);
      focusIdx = Math.min(xsRef.length - 1, Math.max(0, focusIdx + (ev.key === 'ArrowRight' ? 1 : -1)));
      showAt(xsRef[focusIdx]);
    });

    wrap.textContent = '';
    wrap.appendChild(svg);

    // Legend (only for 2+ series)
    legend.textContent = '';
    if (cfg.series.length >= 2) {
      for (const s of cfg.series) {
        const item = el('span', 'legend-item');
        const key = el('span', 'legend-key');
        key.style.background = `var(${s.colorVar})`;
        item.appendChild(key);
        item.appendChild(el('span', 'legend-name', s.name));
        legend.appendChild(item);
      }
    }

    // Table view
    tableDetails.textContent = '';
    const summary = el('summary', null, 'View data as table');
    tableDetails.appendChild(summary);
    const table = el('table');
    const thead = el('thead');
    const hrow = el('tr');
    hrow.appendChild(el('th', null, cfg.tableCaption || 'X'));
    for (const s of cfg.series) hrow.appendChild(el('th', null, s.name));
    thead.appendChild(hrow);
    table.appendChild(thead);
    const tbody = el('tbody');
    const every = cfg.tableSampleEvery || 1;
    xsRef.forEach((xv, i) => {
      if (i % every !== 0) return;
      const tr = el('tr');
      tr.appendChild(el('td', null, cfg.formatX ? cfg.formatX(xv) : String(xv)));
      for (const s of cfg.series) {
        const p = s.points[i];
        tr.appendChild(el('td', null, p ? (cfg.formatY ? cfg.formatY(p.y, s.name) : String(p.y)) : ''));
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableDetails.appendChild(table);
  }

  draw();
  let raf = null;
  const ro = new ResizeObserver(() => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      if (Math.abs(container.clientWidth - width) > 4) draw();
    });
  });
  ro.observe(container);

  return {
    update(newConfig) {
      cfg = newConfig;
      draw();
    },
  };
}

/**
 * Polar sky-dome plot: azimuth is the compass angle (N up, E right), radius
 * maps elevation (zenith at the center, horizon at the rim).
 *
 * config = {
 *   paths: [{ name, colorVar, points: [{azimuth, elevation}], dash? }],
 *   sun?: { azimuth, elevation },   // current position marker
 *   hourMarks?: [{ azimuth, elevation, label }],
 * }
 */
export function renderSkyDome(container, config) {
  let cfg = config;
  container.classList.add('chart-host');
  const wrap = el('div', 'chart-wrap dome-wrap');
  container.textContent = '';
  container.appendChild(wrap);
  const legend = el('div', 'chart-legend');
  container.appendChild(legend);

  let width = 0;

  function draw() {
    width = Math.max(260, Math.min(420, container.clientWidth));
    const size = width;
    const cx = size / 2;
    const cy = size / 2;
    const R = size / 2 - 26;

    const P = (az, elv) => {
      const r = R * (1 - Math.max(0, Math.min(90, elv)) / 90);
      const a = (az - 90) * (Math.PI / 180);
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    };

    const svg = svgEl('svg', {
      viewBox: `0 0 ${size} ${size}`, width: '100%',
      role: 'img', 'aria-label': 'Sky dome showing sun paths by azimuth and elevation',
    });

    // Elevation rings at 0 (horizon), 30, 60 deg
    for (const elv of [0, 30, 60]) {
      svg.appendChild(svgEl('circle', {
        cx, cy, r: R * (1 - elv / 90), fill: elv === 0 ? 'var(--dome-fill)' : 'none',
        class: elv === 0 ? 'axis' : 'grid', stroke: elv === 0 ? 'var(--axis)' : 'var(--grid)',
      }));
      if (elv > 0) {
        const t = svgEl('text', { x: cx + 3, y: cy - R * (1 - elv / 90) - 3, class: 'tick' });
        t.textContent = `${elv}°`;
        svg.appendChild(t);
      }
    }
    // Cross lines N-S / E-W
    svg.appendChild(svgEl('line', { x1: cx, y1: cy - R, x2: cx, y2: cy + R, class: 'grid' }));
    svg.appendChild(svgEl('line', { x1: cx - R, y1: cy, x2: cx + R, y2: cy, class: 'grid' }));
    // Cardinal labels
    const cards = [['N', cx, cy - R - 8], ['S', cx, cy + R + 16], ['E', cx + R + 12, cy + 4], ['W', cx - R - 12, cy + 4]];
    for (const [label, x, y] of cards) {
      const t = svgEl('text', { x, y, class: 'tick cardinal', 'text-anchor': 'middle' });
      t.textContent = label;
      svg.appendChild(t);
    }

    for (const path of cfg.paths) {
      const above = path.points.filter((p) => p.elevation >= 0);
      if (above.length < 2) continue;
      const d = above.map((p, i) => {
        const [x, y] = P(p.azimuth, p.elevation);
        return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
      }).join('');
      svg.appendChild(svgEl('path', {
        d, fill: 'none', stroke: `var(${path.colorVar})`, 'stroke-width': 2,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        ...(path.dash ? { 'stroke-dasharray': path.dash } : {}),
      }));
    }

    for (const hm of cfg.hourMarks || []) {
      if (hm.elevation < 0) continue;
      const [x, y] = P(hm.azimuth, hm.elevation);
      svg.appendChild(svgEl('circle', {
        cx: x, cy: y, r: 2.5, fill: 'var(--muted)', stroke: 'var(--surface-1)', 'stroke-width': 1,
      }));
    }

    if (cfg.sun && cfg.sun.elevation >= -0.833) {
      const [x, y] = P(cfg.sun.azimuth, Math.max(0, cfg.sun.elevation));
      svg.appendChild(svgEl('circle', {
        cx: x, cy: y, r: 7, fill: 'var(--sun)', stroke: 'var(--surface-1)', 'stroke-width': 2,
      }));
    }

    wrap.textContent = '';
    wrap.appendChild(svg);

    legend.textContent = '';
    for (const p of cfg.paths) {
      const item = el('span', 'legend-item');
      const key = el('span', 'legend-key');
      key.style.background = `var(${p.colorVar})`;
      item.appendChild(key);
      item.appendChild(el('span', 'legend-name', p.name));
      legend.appendChild(item);
    }
    if (cfg.sun) {
      const item = el('span', 'legend-item');
      const key = el('span', 'legend-key legend-dot');
      key.style.background = 'var(--sun)';
      item.appendChild(key);
      item.appendChild(el('span', 'legend-name', 'Sun at selected time'));
      legend.appendChild(item);
    }
  }

  draw();
  let raf = null;
  const ro = new ResizeObserver(() => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      if (Math.abs(Math.min(420, container.clientWidth) - width) > 4) draw();
    });
  });
  ro.observe(container);

  return {
    update(newConfig) {
      cfg = newConfig;
      draw();
    },
  };
}
