/**
 * Comparison schematics: an annotated Earth-geometry diagram for a single
 * date, and a to-scale orbit inset placing two dates on Earth's real orbit.
 *
 * The Earth diagram is a true orthographic cross-section viewed perpendicular
 * to both the sun-line and Earth's axis - the classic seasons figure, drawn
 * from the actual declination rather than a sketch. Sunlight arrives
 * horizontally from the left, so the terminator is the vertical diameter and
 * the lit hemisphere is the left half.
 *
 * Math conventions here: unit-radius Earth, origin at Earth's center,
 * x to the right and y UP (SVG flips y at draw time).
 */

import { solarGeometry, julianDay } from './solar.js';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
export const OBLIQUITY = 23.44;

/**
 * Where an observer's parallel of latitude sits in the lit/dark hemispheres.
 *
 * A parallel at latitude phi projects, in this view, to a chord perpendicular
 * to the axis. Its sunward end is the observer at local solar noon and its
 * far end is local midnight, so the chord alone encodes noon elevation,
 * midnight elevation, and whether the sun sets at all that day.
 *
 * @param {number} latDeg observer latitude, degrees (+N)
 * @param {number} decDeg solar declination that day, degrees
 * @returns {{noon:{x,y}, midnight:{x,y}, terminator:{x,y}|null,
 *            state:'partial'|'polar-day'|'polar-night',
 *            noonElevation:number, midnightElevation:number}}
 */
export function parallelGeometry(latDeg, decDeg) {
  const phi = latDeg * RAD;
  const dec = decDeg * RAD;

  // Sunward (noon) end and anti-solar (midnight) end of the chord.
  const noon = { x: -Math.cos(phi - dec), y: Math.sin(phi - dec) };
  const midnight = { x: Math.cos(phi + dec), y: Math.sin(phi + dec) };

  const noonElevation = 90 - Math.abs(latDeg - decDeg);
  const midnightElevation = Math.abs(latDeg + decDeg) - 90;

  // The terminator is x = 0; the chord crosses it only when its two ends sit
  // on opposite sides, which is exactly the condition for a sunrise.
  let state = 'partial';
  let terminator = null;
  if (noon.x >= 0) {
    state = 'polar-night';       // even the noon end never reaches the light
  } else if (midnight.x <= 0) {
    state = 'polar-day';         // even the midnight end stays lit
  } else {
    const t = -noon.x / (midnight.x - noon.x);
    terminator = { x: 0, y: noon.y + t * (midnight.y - noon.y) };
  }

  return { noon, midnight, terminator, state, noonElevation, midnightElevation };
}

/** Earth's heliocentric position for a date: {lonDeg, radiusAU}. */
export function earthOrbitPosition(date) {
  const jd = julianDay(date.year, date.month, date.day) + 0.5;
  const { apparentLong, radiusAU } = solarGeometry(jd);
  return { lonDeg: (apparentLong + 180) % 360, radiusAU };
}

/* ---------- svg helpers ---------- */

const f = (n) => (Math.round(n * 100) / 100).toString();
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/**
 * One annotated Earth panel.
 * @param {object} o
 * @param {number} o.lat observer latitude
 * @param {number} o.dec solar declination for the date
 * @param {string} o.dateLabel e.g. "Jun 21"
 * @param {string} o.colorVar CSS custom property for this date's color
 * @param {string} o.idPrefix unique id prefix for gradient/clip defs
 * @returns {string} SVG markup
 */
export function globeSVG({ lat, dec, dateLabel, colorVar, idPrefix }) {
  const W = 340;
  const H = 300;
  const cx = 168;
  const cy = 150;
  const R = 96;

  // math (y up, unit radius) -> svg
  const S = (p) => ({ x: cx + p.x * R, y: cy - p.y * R });

  const g = parallelGeometry(lat, dec);
  const noon = S(g.noon);
  const midnight = S(g.midnight);
  const term = g.terminator ? S(g.terminator) : null;
  const sub = S({ x: -1, y: 0 });                       // subsolar point

  // Axis: north pole direction n = (-sin dec, cos dec)
  const n = { x: -Math.sin(dec * RAD), y: Math.cos(dec * RAD) };
  const np = S({ x: n.x * 1.18, y: n.y * 1.18 });
  const sp = S({ x: -n.x * 1.18, y: -n.y * 1.18 });

  // Reference parallels drawn as chords (perpendicular to the axis).
  const t = { x: Math.cos(dec * RAD), y: Math.sin(dec * RAD) };
  const chord = (phiDeg) => {
    const phi = phiDeg * RAD;
    const a = { x: Math.sin(phi) * n.x - Math.cos(phi) * t.x, y: Math.sin(phi) * n.y - Math.cos(phi) * t.y };
    const b = { x: Math.sin(phi) * n.x + Math.cos(phi) * t.x, y: Math.sin(phi) * n.y + Math.cos(phi) * t.y };
    return [S(a), S(b)];
  };

  const refParallels = [
    [66.56, 'Arctic Circle'], [OBLIQUITY, 'Tropic of Cancer'], [0, 'Equator'],
    [-OBLIQUITY, 'Tropic of Capricorn'], [-66.56, 'Antarctic Circle'],
  ].map(([phi]) => {
    const [a, b] = chord(phi);
    return `<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" class="globe-parallel"${phi === 0 ? ' stroke-width="1.4"' : ''}/>`;
  }).join('');

  // Sun rays, stopping at the lit limb.
  const rays = [-0.82, -0.55, -0.27, 0, 0.27, 0.55, 0.82].map((yy) => {
    const y = cy - yy * R;
    const xEnd = cx - Math.sqrt(Math.max(0, 1 - yy * yy)) * R;
    return `<line x1="6" y1="${f(y)}" x2="${f(xEnd - 3)}" y2="${f(y)}" class="globe-ray" marker-end="url(#${idPrefix}-arrow)"/>`;
  }).join('');

  // Observer's parallel: lit part in the date color, night part dimmed.
  let litSeg;
  let darkSeg = '';
  if (g.state === 'polar-day') {
    litSeg = `<line x1="${f(noon.x)}" y1="${f(noon.y)}" x2="${f(midnight.x)}" y2="${f(midnight.y)}" class="globe-lit" stroke="var(${colorVar})"/>`;
  } else if (g.state === 'polar-night') {
    litSeg = '';
    darkSeg = `<line x1="${f(noon.x)}" y1="${f(noon.y)}" x2="${f(midnight.x)}" y2="${f(midnight.y)}" class="globe-dark" stroke="var(${colorVar})"/>`;
  } else {
    litSeg = `<line x1="${f(noon.x)}" y1="${f(noon.y)}" x2="${f(term.x)}" y2="${f(term.y)}" class="globe-lit" stroke="var(${colorVar})"/>`;
    darkSeg = `<line x1="${f(term.x)}" y1="${f(term.y)}" x2="${f(midnight.x)}" y2="${f(midnight.y)}" class="globe-dark" stroke="var(${colorVar})"/>`;
  }

  // Noon-angle annotation: local horizon at the observer + the arriving ray.
  const zen = g.noon;                                    // outward normal (unit)
  const hor = { x: -zen.y, y: zen.x };                   // horizon tangent
  const hLen = 46;
  const hA = { x: noon.x - hor.x * hLen, y: noon.y + hor.y * hLen };
  const hB = { x: noon.x + hor.x * hLen, y: noon.y - hor.y * hLen };
  const elev = g.noonElevation;
  const angleLabel = `${elev < 0 ? '−' : ''}${Math.abs(elev).toFixed(1)}°`;

  // Arc from the local horizon (sunward side) round to the incoming ray, i.e.
  // the noon elevation itself, drawn where the reader can see the angle.
  const horUnit = hor.x < 0 ? hor : { x: -hor.x, y: -hor.y };
  const d1 = { x: horUnit.x, y: -horUnit.y };          // svg space (y down)
  const d2 = { x: -1, y: 0 };                          // toward the sun
  const ar = 30;
  const cross = d1.x * d2.y - d1.y * d2.x;
  const arc = `M${f(noon.x + d1.x * ar)},${f(noon.y + d1.y * ar)} `
    + `A${ar},${ar} 0 0 ${cross > 0 ? 1 : 0} ${f(noon.x + d2.x * ar)},${f(noon.y + d2.y * ar)}`;
  const labDir = { x: (d1.x + d2.x) / 2, y: (d1.y + d2.y) / 2 };
  const labLen = Math.hypot(labDir.x, labDir.y) || 1;
  const labPos = {
    x: Math.max(26, Math.min(W - 26, noon.x + (labDir.x / labLen) * (ar + 17))),
    y: Math.max(16, Math.min(H - 10, noon.y + (labDir.y / labLen) * (ar + 17))),
  };

  return `
<svg viewBox="0 0 ${W} ${H}" class="globe-svg" role="img"
     aria-label="${esc(dateLabel)}: sunlight reaches Earth with the subsolar point at ${dec.toFixed(1)} degrees latitude; noon sun elevation at the observer is ${elev.toFixed(1)} degrees">
  <defs>
    <marker id="${idPrefix}-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
      <path d="M0,1 L7,4 L0,7 z" fill="var(--sun)"/>
    </marker>
    <linearGradient id="${idPrefix}-lit" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="var(--globe-lit-a)"/>
      <stop offset="1" stop-color="var(--globe-lit-b)"/>
    </linearGradient>
    <clipPath id="${idPrefix}-day"><rect x="${cx - R - 2}" y="${cy - R - 2}" width="${R + 2}" height="${2 * R + 4}"/></clipPath>
  </defs>

  <rect width="${W}" height="${H}" fill="var(--globe-space)"/>
  ${rays}

  <circle cx="${cx}" cy="${cy}" r="${R}" fill="var(--globe-night)"/>
  <g clip-path="url(#${idPrefix}-day)"><circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#${idPrefix}-lit)"/></g>
  <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" class="globe-edge"/>
  <line x1="${cx}" y1="${cy - R}" x2="${cx}" y2="${cy + R}" class="globe-terminator"/>

  ${refParallels}

  <line x1="${f(np.x)}" y1="${f(np.y)}" x2="${f(sp.x)}" y2="${f(sp.y)}" class="globe-axis"/>
  <text x="${f(np.x)}" y="${f(np.y - 7)}" class="globe-pole" text-anchor="middle">N</text>
  <text x="${f(sp.x)}" y="${f(sp.y + 14)}" class="globe-pole" text-anchor="middle">S</text>

  ${darkSeg}${litSeg}

  <circle cx="${f(sub.x)}" cy="${f(sub.y)}" r="4" fill="var(--sun)" stroke="var(--globe-space)" stroke-width="1.5"/>
  <text x="${f(sub.x + 11)}" y="${f(sub.y + 17)}" class="globe-note" text-anchor="start">sun overhead ${dec >= 0 ? '+' : '−'}${Math.abs(dec).toFixed(1)}°</text>

  <line x1="${f(hA.x)}" y1="${f(hA.y)}" x2="${f(hB.x)}" y2="${f(hB.y)}" class="globe-horizon"/>
  <path d="${arc}" class="globe-arc"/>
  <circle cx="${f(noon.x)}" cy="${f(noon.y)}" r="5" fill="var(${colorVar})" stroke="var(--globe-space)" stroke-width="2"/>
  <text x="${f(labPos.x)}" y="${f(labPos.y + 4)}" class="globe-angle" text-anchor="middle">${angleLabel}</text>
</svg>`;
}

/**
 * To-scale orbit inset with both dates marked. The orbit path is traced from
 * the same ephemeris the rest of the app uses, so its (very small) eccentricity
 * is real rather than drawn for effect.
 */
export function orbitSVG({ a, b, year }) {
  const W = 580;
  const H = 280;
  const cx = W / 2;
  const cy = H / 2;
  const AU = 100; // px per astronomical unit

  const pt = (lonDeg, rAU) => ({
    x: cx + Math.cos(lonDeg * RAD) * rAU * AU,
    y: cy - Math.sin(lonDeg * RAD) * rAU * AU,
  });

  // Trace the real orbit day by day.
  let path = '';
  for (let doy = 0; doy < 366; doy += 3) {
    const d = new Date(Date.UTC(year, 0, 1 + doy));
    const p = earthOrbitPosition({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
    const s = pt(p.lonDeg, p.radiusAU);
    path += `${path ? 'L' : 'M'}${f(s.x)},${f(s.y)}`;
  }
  path += 'Z';

  // Season markers, computed the same way rather than assumed.
  const seasons = [
    [{ year, month: 3, day: 20 }, 'Mar equinox'],
    [{ year, month: 6, day: 21 }, 'Jun solstice'],
    [{ year, month: 9, day: 22 }, 'Sep equinox'],
    [{ year, month: 12, day: 21 }, 'Dec solstice'],
  ].map(([d, label]) => {
    const p = earthOrbitPosition(d);
    const s = pt(p.lonDeg, p.radiusAU);
    const out = pt(p.lonDeg, p.radiusAU + 0.30);
    const anchor = out.x < cx - 12 ? 'end' : out.x > cx + 12 ? 'start' : 'middle';
    return `<circle cx="${f(s.x)}" cy="${f(s.y)}" r="2.5" class="orbit-season-dot"/>
      <text x="${f(out.x)}" y="${f(out.y + 4)}" class="orbit-note" text-anchor="${anchor}">${label}</text>`;
  }).join('');

  // Earth marker: disc plus the axis, whose in-plane direction is fixed in
  // space (it points toward the June solstice side all year - that fixity is
  // what makes the seasons).
  const marker = (p, colorVar, label) => {
    const s = pt(p.lonDeg, p.radiusAU);
    const tilt = 23; // px half-length of the drawn axis
    const dx = Math.sin(OBLIQUITY * RAD) * tilt;
    const dy = Math.cos(OBLIQUITY * RAD) * tilt;
    const inward = pt(p.lonDeg, Math.max(0, p.radiusAU - 0.26));
    return `<g>
      <line x1="${f(s.x - dx)}" y1="${f(s.y + dy)}" x2="${f(s.x + dx)}" y2="${f(s.y - dy)}" class="orbit-axis"/>
      <circle cx="${f(s.x)}" cy="${f(s.y)}" r="7" fill="var(${colorVar})" stroke="var(--surface-1)" stroke-width="2"/>
      <text x="${f(inward.x)}" y="${f(inward.y + 4)}" class="orbit-label" text-anchor="middle">${esc(label)}</text>
    </g>`;
  };

  return `
<svg viewBox="0 0 ${W} ${H}" class="orbit-svg" role="img"
     aria-label="Earth's orbit drawn to scale with both dates marked; the orbit is very nearly circular and Earth's axis keeps a fixed direction in space">
  <path d="${path}" class="orbit-path"/>
  ${seasons}
  <circle cx="${cx}" cy="${cy}" r="9" fill="var(--sun)"/>
  <circle cx="${cx}" cy="${cy}" r="16" fill="var(--sun)" opacity="0.18"/>
  ${marker(a.pos, a.colorVar, a.label)}
  ${marker(b.pos, b.colorVar, b.label)}
</svg>`;
}
