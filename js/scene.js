/**
 * Scenic mode: an ambient sky-and-landscape panel that tracks the sun.
 * Sky colors follow the sun's elevation through night / twilight / golden
 * hour / day; the landscape palette follows the season at the viewer's
 * hemisphere. Everything is derived from the same solar math as the charts.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/* ---------- color helpers ---------- */

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbToHex = (r, g, b) =>
  `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

function mix(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return rgbToHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}

function darken(hex, factor) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * factor, g * factor, b * factor);
}

export function smoothstep(lo, hi, v) {
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/* ---------- sky palette by sun elevation ---------- */

// Anchor stops: [elevation, skyTop, skyMid, horizon]
const SKY_STOPS = [
  [-18, '#050914', '#0a1024', '#111a30'],
  [-12, '#0a1128', '#131c3e', '#1c2750'],
  [-6,  '#14224a', '#2d3a6e', '#5c4a78'],
  [-2,  '#28416e', '#6b5c94', '#d97e59'],
  [3,   '#3f6ba3', '#c98a68', '#f2b25c'],
  [10,  '#5b8fc7', '#93bade', '#eed9a8'],
  [25,  '#3f83cf', '#7ab2e8', '#c9e2f6'],
  [90,  '#2f76c8', '#6ea9e4', '#bcdcf5'],
];

/** Sky gradient colors for a sun elevation (degrees). */
export function skyColors(elevation) {
  const e = Math.max(SKY_STOPS[0][0], Math.min(90, elevation));
  let i = 0;
  while (i < SKY_STOPS.length - 2 && e > SKY_STOPS[i + 1][0]) i++;
  const [e0, ...a] = SKY_STOPS[i];
  const [e1, ...b] = SKY_STOPS[i + 1];
  const t = smoothstep(e0, e1, e);
  return { top: mix(a[0], b[0], t), mid: mix(a[1], b[1], t), horizon: mix(a[2], b[2], t) };
}

/* ---------- season ---------- */

/** Season name for a month (1-12) and latitude; tropics are their own thing. */
export function seasonFor(month, lat) {
  if (Math.abs(lat) < 15) return 'tropical';
  const northSeason = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer',
    'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'][month - 1];
  if (lat >= 0) return northSeason;
  return { winter: 'summer', spring: 'autumn', summer: 'winter', autumn: 'spring' }[northSeason];
}

const SEASON_LAND = {
  spring:   { far: '#8fbb75', near: '#649e56', ground: '#4d8747', label: 'Spring' },
  summer:   { far: '#5f9e51', near: '#417f3c', ground: '#316a31', label: 'Summer' },
  autumn:   { far: '#c58d4a', near: '#a2662e', ground: '#7d4f26', label: 'Autumn' },
  winter:   { far: '#dde5ee', near: '#bfccdd', ground: '#a3b5ca', label: 'Winter' },
  tropical: { far: '#58a86b', near: '#3a8a58', ground: '#2c7048', label: 'Tropics' },
};

const SEASON_TREE = {
  spring:   { canopy: '#7cbb56', shade: '#5f9c42', blossom: '#f6bcd4' },
  summer:   { canopy: '#3f8f42', shade: '#2d6f32' },
  autumn:   { canopy: '#d68a33', shade: '#b05f28', litter: '#c07a34' },
  winter:   { canopy: null, snow: '#eef3fa' },        // bare branches
  tropical: { canopy: '#2f8f57', shade: '#226b45', palm: true },
};

// Fixed layout so the scene is stable across re-renders; lower on the canvas
// reads as nearer, so those trees are drawn larger and painted last.
const TREES = [
  { x: 0.06, ground: 214, scale: 0.78 },
  { x: 0.20, ground: 236, scale: 1.10 },
  { x: 0.33, ground: 205, scale: 0.68 },
  { x: 0.45, ground: 250, scale: 1.34 },
  { x: 0.58, ground: 210, scale: 0.74 },
  { x: 0.71, ground: 240, scale: 1.18 },
  { x: 0.84, ground: 202, scale: 0.64 },
  { x: 0.95, ground: 228, scale: 0.98 },
].sort((a, b) => a.ground - b.ground);

/**
 * Shadow cast by an object of `height` on level ground.
 *
 * Length is the real h/tan(elevation). A shadow points away from the sun, so
 * for a sun at azimuth A its ground direction has north component -cos(A) and
 * east component -sin(A). The viewer faces the equator, so `facing` (-1 south,
 * +1 north) maps those onto the screen: the east-west part runs across the
 * picture, while the north-south part runs into or out of it and is heavily
 * foreshortened. Keeping it matters at solar noon, when the east-west part is
 * zero and the shadow falls toward the viewer rather than disappearing.
 *
 * @returns {{length:number, dx:number, dy:number}|null} null when the sun is down.
 */
const GROUND_FORESHORTEN = 0.3;

export function shadowFor(elevationDeg, azimuthDeg, facing, height, maxLen = 7) {
  if (elevationDeg <= 0) return null;
  const tan = Math.tan(Math.max(elevationDeg, 1.2) * RAD);
  const length = Math.min(height / tan, height * maxLen);
  return {
    length,
    dx: length * -facing * Math.sin(azimuthDeg * RAD),
    dy: length * facing * Math.cos(azimuthDeg * RAD) * GROUND_FORESHORTEN,
  };
}

/** One tree, plus its cast shadow, as SVG markup. */
function treeSVG(tree, W, season, landFactor, dayness, sun) {
  const t = SEASON_TREE[season];
  const x = tree.x * W;
  const y = tree.ground;
  const h = 48 * tree.scale;                 // trunk height
  const r = 19 * tree.scale;                 // canopy radius
  const tw = Math.max(2.4, 4.6 * tree.scale);
  const trunk = darken('#5a4331', landFactor);
  const topY = y - h;

  // Shadow first, so the tree sits on top of it.
  let shadow = '';
  const sh = shadowFor(sun.elevation, sun.azimuth, sun.facing, h);
  if (sh && dayness > 0.02) {
    const span = Math.hypot(sh.dx, sh.dy);
    const cx = x + sh.dx / 2;
    const cy = y + sh.dy / 2 + 2;
    const rx = span / 2 + tw * 1.6;
    const ry = Math.max(3.4, r * 0.4);
    const ang = (Math.atan2(sh.dy, sh.dx) * DEG).toFixed(1);
    // Long, low-sun shadows are diffuse; midday shadows are tight and darker.
    const op = (0.34 * dayness * (1 - 0.4 * Math.min(1, span / (h * 5)))).toFixed(2);
    shadow = `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}"`
      + ` transform="rotate(${ang} ${cx.toFixed(1)} ${cy.toFixed(1)})" fill="#000" opacity="${op}"/>`;
  }

  const trunkMark = `<path d="M${(x - tw).toFixed(1)},${y} L${(x - tw * 0.55).toFixed(1)},${topY.toFixed(1)} `
    + `L${(x + tw * 0.55).toFixed(1)},${topY.toFixed(1)} L${(x + tw).toFixed(1)},${y} Z" fill="${trunk}"/>`;

  let crown = '';
  if (t.palm) {
    const frond = darken(t.canopy, landFactor);
    const shade = darken(t.shade, landFactor);
    crown = [-1, 1].flatMap((dir) => [0.15, 0.55, 1.0].map((lift, i) => {
      const ex = x + dir * r * (1.15 - lift * 0.25);
      const ey = topY - lift * r * 0.75 + r * 0.28;
      return `<path d="M${x.toFixed(1)},${topY.toFixed(1)} Q${(x + dir * r * 0.7).toFixed(1)},`
        + `${(topY - r * 0.55 - lift * 6).toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}"`
        + ` stroke="${i === 1 ? shade : frond}" stroke-width="${(3.4 * tree.scale).toFixed(1)}"`
        + ` fill="none" stroke-linecap="round"/>`;
    })).join('');
  } else if (t.canopy) {
    const c = darken(t.canopy, landFactor);
    const sd = darken(t.shade, landFactor);
    crown = `<circle cx="${(x - r * 0.5).toFixed(1)}" cy="${(topY + r * 0.3).toFixed(1)}" r="${(r * 0.78).toFixed(1)}" fill="${sd}"/>`
      + `<circle cx="${(x + r * 0.52).toFixed(1)}" cy="${(topY + r * 0.24).toFixed(1)}" r="${(r * 0.72).toFixed(1)}" fill="${sd}"/>`
      + `<circle cx="${x.toFixed(1)}" cy="${(topY - r * 0.24).toFixed(1)}" r="${(r * 0.92).toFixed(1)}" fill="${c}"/>`;
    if (t.blossom) {
      const b = darken(t.blossom, landFactor);
      crown += [[-0.55, -0.3], [0.4, -0.62], [0.62, 0.1], [-0.15, 0.42], [0.05, -0.15]]
        .map(([bx, by]) => `<circle cx="${(x + bx * r).toFixed(1)}" cy="${(topY + by * r).toFixed(1)}" r="${(2.1 * tree.scale).toFixed(1)}" fill="${b}"/>`)
        .join('');
    }
  } else {
    // Winter: bare branches, with snow catching on the upper limbs.
    const br = darken('#4c3928', landFactor);
    const limbs = [[-1, 0.95], [1, 0.9], [-0.62, 1.25], [0.66, 1.2]]
      .map(([dir, up]) => `<line x1="${x.toFixed(1)}" y1="${(topY + r * 0.34).toFixed(1)}" `
        + `x2="${(x + dir * r * 0.92).toFixed(1)}" y2="${(topY - r * (up - 0.62)).toFixed(1)}" `
        + `stroke="${br}" stroke-width="${(2.2 * tree.scale).toFixed(1)}" stroke-linecap="round"/>`)
      .join('');
    const snow = darken(t.snow, Math.min(1, landFactor + 0.12));
    crown = limbs
      + `<line x1="${(x - r * 0.8).toFixed(1)}" y1="${(topY - r * 0.22).toFixed(1)}" `
      + `x2="${(x + r * 0.8).toFixed(1)}" y2="${(topY - r * 0.26).toFixed(1)}" `
      + `stroke="${snow}" stroke-width="${(2 * tree.scale).toFixed(1)}" stroke-linecap="round" opacity="0.9"/>`;
  }

  // A little seasonal ground detail at the base.
  let litter = '';
  if (t.litter) {
    const l = darken(t.litter, landFactor);
    litter = [[-1.5, 5], [1.2, 8], [2.4, 3], [-2.6, 9]]
      .map(([lx, ly]) => `<ellipse cx="${(x + lx * r * 0.42).toFixed(1)}" cy="${(y + ly).toFixed(1)}" `
        + `rx="${(2.6 * tree.scale).toFixed(1)}" ry="${(1.3 * tree.scale).toFixed(1)}" fill="${l}" opacity="0.75"/>`)
      .join('');
  }

  return shadow + trunkMark + crown + litter;
}

/* ---------- deterministic stars ---------- */

const STARS = (() => {
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  return Array.from({ length: 90 }, () => ({
    x: rand(), y: rand() * 0.72, r: 0.6 + rand() * 1.1, o: 0.35 + rand() * 0.65,
  }));
})();

/* ---------- scene renderer ---------- */

/**
 * Render the scene into a container.
 * model = { elevation, azimuth (deg), lat, month, timeLabel, dateLabel,
 *           sunriseLabel, sunsetLabel }
 */
export function renderScene(container, model) {
  const W = 1000;
  const H = 260;
  const horizonY = 190;

  const { elevation, azimuth, lat, month } = model;
  const sky = skyColors(elevation);
  const season = seasonFor(month, lat);
  const land = SEASON_LAND[season];

  // How "daytime" it is: 0 deep night -> 1 full day. Landscape dims at night.
  const dayness = smoothstep(-8, 8, elevation);
  const landFactor = 0.22 + 0.78 * dayness;
  const starOpacity = 1 - smoothstep(-14, -5, elevation);

  // Sun screen position. Viewer faces the equator, so in the northern
  // hemisphere east is on the left; in the southern, on the right.
  const facing = lat >= 0 ? -1 : 1;
  const sunX = W * (0.5 + facing * 0.44 * Math.sin(azimuth * RAD));
  const sunY = horizonY - (elevation / 90) * (horizonY - 34);
  const sunVisible = elevation > -1.5;
  const glowWarmth = 1 - smoothstep(0, 22, elevation); // warm near the horizon
  const sunColor = mix('#ffd23f', '#ff9d42', glowWarmth);

  const stars = starOpacity > 0.01
    ? STARS.map((s) =>
        `<circle cx="${(s.x * W).toFixed(1)}" cy="${(s.y * H).toFixed(1)}" r="${s.r}" fill="#dfe8ff" opacity="${(s.o * starOpacity).toFixed(2)}"/>`
      ).join('')
    : '';

  const hillFar = `M0,${horizonY} L0,${horizonY - 38} Q${W * 0.14},${horizonY - 74} ${W * 0.3},${horizonY - 44} T${W * 0.58},${horizonY - 58} T${W * 0.82},${horizonY - 30} L${W},${horizonY - 46} L${W},${horizonY} Z`;
  const hillNear = `M0,${horizonY} L0,${horizonY - 16} Q${W * 0.2},${horizonY - 48} ${W * 0.42},${horizonY - 20} T${W * 0.72},${horizonY - 34} L${W},${horizonY - 10} L${W},${horizonY} Z`;

  const snowCaps = season === 'winter'
    ? `<path d="M${W * 0.24},${horizonY - 56} q${W * 0.03},-14 ${W * 0.06},0 q-${W * 0.03},8 -${W * 0.06},0 Z" fill="#ffffff" opacity="${(0.7 * landFactor).toFixed(2)}"/>`
    : '';

  const trees = TREES
    .map((tree) => treeSVG(tree, W, season, landFactor, dayness, { elevation, azimuth, facing }))
    .join('');

  container.innerHTML = `
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="img"
       aria-label="Scenic view: ${model.timeLabel}, sun ${elevation.toFixed(0)} degrees above the horizon, ${land.label.toLowerCase()} landscape with trees casting shadows away from the sun">
    <defs>
      <linearGradient id="sky-g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${sky.top}"/>
        <stop offset="0.62" stop-color="${sky.mid}"/>
        <stop offset="1" stop-color="${sky.horizon}"/>
      </linearGradient>
      <radialGradient id="sun-glow">
        <stop offset="0" stop-color="${sunColor}" stop-opacity="0.55"/>
        <stop offset="1" stop-color="${sunColor}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${horizonY}" fill="url(#sky-g)"/>
    ${stars}
    ${sunVisible ? `
      <circle cx="${sunX.toFixed(1)}" cy="${sunY.toFixed(1)}" r="${58 + 30 * glowWarmth}" fill="url(#sun-glow)"/>
      <circle cx="${sunX.toFixed(1)}" cy="${sunY.toFixed(1)}" r="14" fill="${sunColor}"/>` : ''}
    <path d="${hillFar}" fill="${darken(land.far, landFactor)}"/>
    ${snowCaps}
    <path d="${hillNear}" fill="${darken(land.near, landFactor)}"/>
    <rect y="${horizonY}" width="${W}" height="${H - horizonY}" fill="${darken(land.ground, landFactor)}"/>
    ${trees}
  </svg>
  <div class="scene-caption">
    <span class="scene-time">${model.timeLabel}</span>
    <span>${model.dateLabel} · ${land.label}</span>
    <span>${model.sunNote}</span>
  </div>`;
}
