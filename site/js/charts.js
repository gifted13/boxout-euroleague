// ============================================================================
// Chart primitives — hand-rolled SVG, following the data-viz method: one
// scale, thin marks, recessive grid, direct labels, hover layer by default,
// colors only from the validated token set (see css/app.css).
// ============================================================================

import { hashColor } from './format.js';

const SVGNS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, children = []) {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
  children.forEach(c => n.appendChild(c));
  return n;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// hashColor() (format.js) returns a `var(--series-N)` reference so callers
// can use it directly in inline `style`. SVG presentation attributes here go
// through cssVar() instead (matches how every other chart color in this file
// is resolved), so unwrap the var() and resolve it the same way.
function resolveColor(v) {
  const m = /^var\((--[\w-]+)\)$/.exec(v || '');
  return m ? cssVar(m[1]) : v;
}

/** Small inline trend line — no axes, no grid. `points`: array of numbers. */
export function sparkline(points, { width = 96, height = 28, color, good } = {}) {
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'spark' });
  if (!points || points.length < 2) return svg;
  const min = Math.min(...points), max = Math.max(...points);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);
  const pad = 3;
  const y = v => pad + (1 - (v - min) / range) * (height - pad * 2);
  const c = color || (good === false ? cssVar('--critical') : good === true ? cssVar('--good') : cssVar('--series-1'));
  let d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i * stepX).toFixed(1)} ${y(p).toFixed(1)}`).join(' ');
  svg.appendChild(el('path', { d, fill: 'none', stroke: c, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  const lastX = (points.length - 1) * stepX;
  svg.appendChild(el('circle', { cx: lastX, cy: y(points[points.length - 1]), r: 2.5, fill: c }));
  return svg;
}

/**
 * Horizontal ranking bars — single hue by default (magnitude, not identity);
 * pass `highlightIndex` to lift one bar to the accent color.
 * data: [{label, value, sub}]
 */
export function hbarChart(data, { width = 480, barH = 26, gap = 10, fmt = v => v, highlightIndex = -1, color, max } = {}) {
  const n = data.length;
  const height = n * barH + (n - 1) * gap + 4;
  const labelW = 120;
  const plotW = width - labelW - 56;
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, class: 'hbar-chart', role: 'img' });
  const vmax = max || Math.max(...data.map(d => d.value), 0.0001);
  const base = color || cssVar('--series-1');
  const accent = cssVar('--accent');
  const ink = cssVar('--chart-ink');
  const ink2 = cssVar('--chart-ink-2');

  data.forEach((d, i) => {
    const y = i * (barH + gap);
    const w = Math.max(2, (d.value / vmax) * plotW);
    const g = el('g', { class: 'hbar-row' });
    const label = el('text', { x: 0, y: y + barH / 2 + 4, 'font-size': 12, fill: i === highlightIndex ? ink : ink2, 'font-weight': i === highlightIndex ? 700 : 500 });
    label.textContent = d.label;
    g.appendChild(label);
    g.appendChild(el('rect', { x: labelW, y, width: plotW, height: barH, rx: 4, fill: cssVar('--chart-grid'), opacity: 0.35 }));
    g.appendChild(el('rect', {
      x: labelW, y, width: w, height: barH, rx: 4,
      fill: i === highlightIndex ? accent : base,
    }));
    const valText = el('text', {
      x: labelW + w + 8, y: y + barH / 2 + 4, 'font-size': 12, 'font-weight': 700,
      fill: ink, 'font-family': 'var(--font-data)',
    });
    valText.textContent = fmt(d.value);
    g.appendChild(valText);
    svg.appendChild(g);
  });
  return svg;
}

/**
 * Line chart with crosshair + tooltip hover layer. series: [{name, color, points:[{x,y,label}]}]
 * Single scale (one y axis) — never mix two measures of different scale here.
 */
export function lineChart(series, { width = 640, height = 220, yFmt = v => v, xFmt = v => v, onHover } = {}) {
  const pad = { t: 16, r: 16, b: 28, l: 40 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const allPts = series.flatMap(s => s.points);
  const xs = allPts.map(p => p.x), ys = allPts.map(p => p.y);
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const yminRaw = Math.min(...ys, 0), ymaxRaw = Math.max(...ys);
  const yPad = (ymaxRaw - yminRaw) * 0.12 || 1;
  const ymin = yminRaw - yPad, ymax = ymaxRaw + yPad;
  const X = x => pad.l + ((x - xmin) / (xmax - xmin || 1)) * plotW;
  const Y = y => pad.t + (1 - (y - ymin) / (ymax - ymin || 1)) * plotH;

  const root = document.createElement('div');
  root.className = 'chart-root';
  root.style.position = 'relative';
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, class: 'line-chart' });

  // gridlines (recessive) — 4 horizontal ticks
  const grid = el('g');
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = ymin + (i / ticks) * (ymax - ymin);
    const y = Y(v);
    grid.appendChild(el('line', { x1: pad.l, x2: width - pad.r, y1: y, y2: y, stroke: cssVar('--chart-grid'), 'stroke-width': 1 }));
    const t = el('text', { x: pad.l - 8, y: y + 3, 'text-anchor': 'end', 'font-size': 10, fill: cssVar('--chart-muted') });
    t.textContent = yFmt(v);
    grid.appendChild(t);
  }
  svg.appendChild(grid);
  // baseline
  svg.appendChild(el('line', { x1: pad.l, x2: width - pad.r, y1: Y(0) > height - pad.b ? height - pad.b : Y(0), y2: Y(0) > height - pad.b ? height - pad.b : Y(0), stroke: cssVar('--chart-baseline'), 'stroke-width': 1 }));

  series.forEach(s => {
    const d = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(' ');
    svg.appendChild(el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    // endpoint emphasis
    const last = s.points[s.points.length - 1];
    svg.appendChild(el('circle', { cx: X(last.x), cy: Y(last.y), r: 3.5, fill: s.color, stroke: cssVar('--chart-surface'), 'stroke-width': 1.5 }));
  });

  // hover layer
  const crosshair = el('line', { x1: 0, x2: 0, y1: pad.t, y2: height - pad.b, stroke: cssVar('--chart-baseline'), 'stroke-width': 1, opacity: 0 });
  svg.appendChild(crosshair);
  const hoverDots = series.map(s => el('circle', { r: 4, fill: s.color, opacity: 0 }));
  hoverDots.forEach(d => svg.appendChild(d));

  const tooltip = document.createElement('div');
  Object.assign(tooltip.style, {
    position: 'absolute', pointerEvents: 'none', opacity: 0, transition: 'opacity .08s ease',
    background: 'var(--surface-raised)', border: '1px solid var(--line)', borderRadius: '8px',
    padding: '6px 10px', fontSize: '11.5px', boxShadow: 'var(--shadow-md)', zIndex: 10, color: 'var(--ink)',
    whiteSpace: 'nowrap',
  });
  root.appendChild(svg);
  root.appendChild(tooltip);

  const overlay = el('rect', { x: pad.l, y: pad.t, width: plotW, height: plotH, fill: 'transparent' });
  overlay.style.cursor = 'crosshair';
  svg.appendChild(overlay);

  overlay.addEventListener('mousemove', ev => {
    const rect = svg.getBoundingClientRect();
    const mx = ((ev.clientX - rect.left) / rect.width) * width;
    const targetX = xmin + ((mx - pad.l) / plotW) * (xmax - xmin);
    // nearest point by x
    let nearest = allPts[0], best = Infinity;
    (series[0] ? series[0].points : allPts).forEach(p => {
      const dist = Math.abs(p.x - targetX);
      if (dist < best) { best = dist; nearest = p; }
    });
    const cx = X(nearest.x);
    crosshair.setAttribute('x1', cx); crosshair.setAttribute('x2', cx); crosshair.setAttribute('opacity', 1);
    let lines = [];
    series.forEach((s, i) => {
      const p = s.points.find(pp => pp.x === nearest.x) || s.points[0];
      hoverDots[i].setAttribute('cx', X(p.x)); hoverDots[i].setAttribute('cy', Y(p.y)); hoverDots[i].setAttribute('opacity', 1);
      lines.push(`<span style="color:${s.color};font-weight:700">${s.name ? s.name + ': ' : ''}${yFmt(p.y)}</span>`);
    });
    tooltip.innerHTML = `<div style="font-weight:700;margin-bottom:2px">${xFmt(nearest.x)}</div>` + lines.join('<br>');
    tooltip.style.opacity = 1;
    const tw = tooltip.offsetWidth;
    tooltip.style.left = Math.min(Math.max(cx - tw / 2, 0), width - tw) + 'px';
    tooltip.style.top = '2px';
    if (onHover) onHover(nearest);
  });
  overlay.addEventListener('mouseleave', () => {
    crosshair.setAttribute('opacity', 0);
    hoverDots.forEach(d => d.setAttribute('opacity', 0));
    tooltip.style.opacity = 0;
  });

  return root;
}

/**
 * Radar chart for multi-stat comparison across up to 4 entities.
 * axes: [{key,label,max}], entities: [{name,color,values:{key:val}}]
 */
export function radarChart(axes, entities, { size = 320 } = {}) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 44;
  const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, width: '100%', height: size, class: 'radar-chart' });
  const n = axes.length;
  const angle = i => (Math.PI * 2 * i) / n - Math.PI / 2;
  const ringLevels = [0.25, 0.5, 0.75, 1];
  ringLevels.forEach(lvl => {
    const pts = axes.map((a, i) => {
      const rad = r * lvl;
      return `${(cx + rad * Math.cos(angle(i))).toFixed(1)},${(cy + rad * Math.sin(angle(i))).toFixed(1)}`;
    }).join(' ');
    svg.appendChild(el('polygon', { points: pts, fill: 'none', stroke: cssVar('--chart-grid'), 'stroke-width': 1 }));
  });
  axes.forEach((a, i) => {
    const x2 = cx + r * Math.cos(angle(i)), y2 = cy + r * Math.sin(angle(i));
    svg.appendChild(el('line', { x1: cx, y1: cy, x2, y2, stroke: cssVar('--chart-grid'), 'stroke-width': 1 }));
    const lx = cx + (r + 26) * Math.cos(angle(i)), ly = cy + (r + 26) * Math.sin(angle(i));
    const t = el('text', {
      x: lx, y: ly, 'text-anchor': Math.abs(Math.cos(angle(i))) < 0.2 ? 'middle' : (Math.cos(angle(i)) > 0 ? 'start' : 'end'),
      'font-size': 10.5, fill: cssVar('--chart-ink-2'), 'dominant-baseline': 'middle', 'font-weight': 600,
    });
    t.textContent = a.label;
    svg.appendChild(t);
  });
  entities.forEach(ent => {
    const pts = axes.map((a, i) => {
      const norm = Math.max(0, Math.min(1, (ent.values[a.key] || 0) / a.max));
      const rad = r * norm;
      return { x: cx + rad * Math.cos(angle(i)), y: cy + rad * Math.sin(angle(i)) };
    });
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ' Z';
    svg.appendChild(el('path', { d, fill: ent.color, 'fill-opacity': 0.14, stroke: ent.color, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    pts.forEach(p => svg.appendChild(el('circle', { cx: p.x, cy: p.y, r: 3, fill: ent.color })));
  });
  return svg;
}

/** Sequential-hue heat cell grid, e.g. shot zones. cells: [{label,value}], one hue ramp. */
export function heatGrid(cells, { cols = 4, cellSize = 72, fmt = v => v } = {}) {
  const rows = Math.ceil(cells.length / cols);
  const wrap = document.createElement('div');
  wrap.style.display = 'grid';
  wrap.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  wrap.style.gap = '4px';
  const vals = cells.map(c => c.value).filter(v => v != null);
  const min = Math.min(...vals), max = Math.max(...vals);
  const ramp = ['var(--seq-100)', 'var(--seq-200)', 'var(--seq-300)', 'var(--seq-400)', 'var(--seq-500)', 'var(--seq-600)'];
  cells.forEach(c => {
    const norm = max > min ? (c.value - min) / (max - min) : 0.5;
    const idx = Math.min(ramp.length - 1, Math.floor(norm * ramp.length));
    const cell = document.createElement('div');
    cell.style.cssText = `background:${ramp[idx]};border-radius:8px;padding:8px;min-height:${cellSize}px;display:flex;flex-direction:column;justify-content:space-between;`;
    const lightText = idx >= 3;
    cell.innerHTML = `<div style="font-size:10px;font-weight:700;letter-spacing:.03em;color:${lightText ? '#fff' : 'var(--chart-ink)'};opacity:.85">${c.label}</div>
      <div style="font-size:15px;font-weight:800;font-family:var(--font-data);color:${lightText ? '#fff' : 'var(--chart-ink)'}">${fmt(c.value)}</div>`;
    wrap.appendChild(cell);
  });
  return wrap;
}

/** Scatter plot for the Analytics Lab correlation finder. points: [{x,y,label}] */
export function scatterChart(points, { width = 560, height = 320, xFmt = v => v, yFmt = v => v, xLabel = '', yLabel = '' } = {}) {
  const pad = { t: 16, r: 20, b: 44, l: 52 };
  const plotW = width - pad.l - pad.r, plotH = height - pad.t - pad.b;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const ymin = Math.min(...ys), ymax = Math.max(...ys);
  const xPad = (xmax - xmin) * 0.08 || 1, yPad = (ymax - ymin) * 0.08 || 1;
  const X = x => pad.l + ((x - (xmin - xPad)) / ((xmax + xPad) - (xmin - xPad) || 1)) * plotW;
  const Y = y => pad.t + (1 - (y - (ymin - yPad)) / ((ymax + yPad) - (ymin - yPad) || 1)) * plotH;

  const root = document.createElement('div');
  root.style.position = 'relative';
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height });

  const grid = el('g');
  for (let i = 0; i <= 4; i++) {
    const gy = pad.t + (i / 4) * plotH;
    grid.appendChild(el('line', { x1: pad.l, x2: width - pad.r, y1: gy, y2: gy, stroke: cssVar('--chart-grid'), 'stroke-width': 1 }));
  }
  svg.appendChild(grid);
  svg.appendChild(el('line', { x1: pad.l, x2: pad.l, y1: pad.t, y2: height - pad.b, stroke: cssVar('--chart-baseline'), 'stroke-width': 1 }));
  svg.appendChild(el('line', { x1: pad.l, x2: width - pad.r, y1: height - pad.b, y2: height - pad.b, stroke: cssVar('--chart-baseline'), 'stroke-width': 1 }));

  const xLab = el('text', { x: pad.l + plotW / 2, y: height - 8, 'text-anchor': 'middle', 'font-size': 11, fill: cssVar('--chart-ink-2'), 'font-weight': 600 });
  xLab.textContent = xLabel; svg.appendChild(xLab);
  const yLab = el('text', { x: 14, y: pad.t + plotH / 2, 'text-anchor': 'middle', 'font-size': 11, fill: cssVar('--chart-ink-2'), 'font-weight': 600, transform: `rotate(-90 14 ${pad.t + plotH / 2})` });
  yLab.textContent = yLabel; svg.appendChild(yLab);

  const tooltip = document.createElement('div');
  Object.assign(tooltip.style, { position: 'absolute', pointerEvents: 'none', opacity: 0, background: 'var(--surface-raised)', border: '1px solid var(--line)', borderRadius: '8px', padding: '6px 10px', fontSize: '11.5px', boxShadow: 'var(--shadow-md)', zIndex: 10, whiteSpace: 'nowrap' });

  points.forEach(p => {
    const dotColor = resolveColor(hashColor(p.label || ''));
    const cx = X(p.x), cy = Y(p.y);
    const c = el('circle', { cx, cy, r: 5, fill: dotColor, stroke: cssVar('--chart-surface'), 'stroke-width': 1.5 });
    c.style.cursor = 'pointer';
    c.addEventListener('mouseenter', () => {
      tooltip.innerHTML = `<strong>${p.label || ''}</strong><br>${xLabel}: ${xFmt(p.x)}<br>${yLabel}: ${yFmt(p.y)}`;
      tooltip.style.opacity = 1;
      tooltip.style.left = (cx + 10) + 'px'; tooltip.style.top = (cy - 10) + 'px';
    });
    c.addEventListener('mouseleave', () => { tooltip.style.opacity = 0; });
    svg.appendChild(c);
    // Direct label — at least the team code stays visible without hovering
    // (text uses an ink token, never the series color, per the mark spec:
    // the colored dot carries identity, the label stays legible on both themes).
    if (p.label) {
      const lbl = el('text', {
        x: cx + 8, y: cy - 8, 'font-size': 9.5, 'font-weight': 700,
        fill: cssVar('--chart-ink-2'), stroke: cssVar('--chart-surface'), 'stroke-width': 3,
        'paint-order': 'stroke fill', 'stroke-linejoin': 'round',
      });
      lbl.textContent = String(p.label).slice(0, 3).toUpperCase();
      svg.appendChild(lbl);
    }
  });
  root.appendChild(svg); root.appendChild(tooltip);
  return root;
}

/**
 * Circular-arc stat ring — a single headline number set inside an open gauge
 * arc. `pct` (0-100) fills the arc proportionally (e.g. percentile vs. the
 * qualified pool) so the arc always means something real, never decoration;
 * pass no `pct` to render the track only (unranked figures, e.g. league
 * averages with no comparison pool).
 */
export function statRing({ value, label, pct, size = 84, color, trackColor } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'stat-ring';
  const strokeW = Math.max(5, Math.round(size * 0.07));
  const r = (size - strokeW) / 2;
  const cx = size / 2, cy = size / 2;
  const startAngle = -220, sweep = 260;
  const toRad = d => (d * Math.PI) / 180;
  const pt = ang => [cx + r * Math.cos(toRad(ang)), cy + r * Math.sin(toRad(ang))];
  const arcPath = (a0, a1) => {
    const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
    const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  const svgWrap = document.createElement('div');
  svgWrap.style.cssText = `position:relative;width:${size}px;height:${size}px;flex:none`;
  const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: 'img', 'aria-label': label ? `${label}: ${value}` : String(value) });
  svg.appendChild(el('path', { d: arcPath(startAngle, startAngle + sweep), fill: 'none', stroke: trackColor || cssVar('--chart-grid'), 'stroke-width': strokeW, 'stroke-linecap': 'round' }));
  if (pct !== undefined && pct !== null && !Number.isNaN(pct)) {
    const clamped = Math.max(0, Math.min(100, pct));
    const endAngle = startAngle + sweep * (clamped / 100);
    if (clamped > 0) svg.appendChild(el('path', { d: arcPath(startAngle, endAngle), fill: 'none', stroke: color || cssVar('--accent-2'), 'stroke-width': strokeW, 'stroke-linecap': 'round' }));
  }
  svgWrap.appendChild(svg);
  const valEl = document.createElement('div');
  valEl.className = 'ring-value';
  valEl.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 6px';
  valEl.textContent = value;
  svgWrap.appendChild(valEl);
  wrap.appendChild(svgWrap);
  if (label) { const l = document.createElement('div'); l.className = 'ring-label'; l.textContent = label; wrap.appendChild(l); }
  return wrap;
}

/** Simple percentile bar (0-100) used inline in tables/cards. */
export function pctBar(value, { color } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'pct-bar';
  const span = document.createElement('span');
  span.style.width = Math.max(2, Math.min(100, value)) + '%';
  if (color) span.style.background = color;
  wrap.appendChild(span);
  return wrap;
}
