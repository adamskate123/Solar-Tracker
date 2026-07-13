/**
 * Scenic mode: an ambient sky-and-landscape panel that tracks the sun.
 * Sky colors follow the sun's elevation through night / twilight / golden
 * hour / day; the landscape palette follows the season at the viewer's
 * hemisphere. Everything is derived from the same solar math as the charts.
 */

const RAD = Math.PI / 180;

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

  container.innerHTML = `
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="img"
       aria-label="Scenic view of the sky: ${model.timeLabel}, sun at ${elevation.toFixed(0)} degrees, ${land.label.toLowerCase()} landscape">
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
  </svg>
  <div class="scene-caption">
    <span class="scene-time">${model.timeLabel}</span>
    <span>${model.dateLabel} · ${land.label}</span>
    <span>${model.sunNote}</span>
  </div>`;
}
