import {
  sunPosition,
  dayInfo,
  dayLightPhases,
  UVB_ELEVATION,
  clearSkyIrradiance,
  dailyInsolation,
  airMass,
  compassPoint,
  daysInMonth,
} from './solar.js';
import { renderLineChart, renderSkyDome } from './charts.js';
import { renderScene } from './scene.js';
import { globeSVG, orbitSVG, earthOrbitPosition } from './orbit.js';
import { VERSION, BUILD_DATE } from './version.js';
import { fetchWeather, summarize, cloudAttenuation, uvBand } from './weather.js';

/* ---------- presets ---------- */

const CITIES = [
  { name: 'New York, USA', lat: 40.7128, lon: -74.006, tz: 'America/New_York' },
  { name: 'Los Angeles, USA', lat: 34.0522, lon: -118.2437, tz: 'America/Los_Angeles' },
  { name: 'Denver, USA', lat: 39.7392, lon: -104.9903, tz: 'America/Denver' },
  { name: 'Honolulu, USA', lat: 21.3069, lon: -157.8583, tz: 'Pacific/Honolulu' },
  { name: 'Anchorage, USA', lat: 61.2181, lon: -149.9003, tz: 'America/Anchorage' },
  { name: 'Toronto, Canada', lat: 43.6532, lon: -79.3832, tz: 'America/Toronto' },
  { name: 'Mexico City, Mexico', lat: 19.4326, lon: -99.1332, tz: 'America/Mexico_City' },
  { name: 'São Paulo, Brazil', lat: -23.5505, lon: -46.6333, tz: 'America/Sao_Paulo' },
  { name: 'Buenos Aires, Argentina', lat: -34.6037, lon: -58.3816, tz: 'America/Argentina/Buenos_Aires' },
  { name: 'Reykjavik, Iceland', lat: 64.1466, lon: -21.9426, tz: 'Atlantic/Reykjavik' },
  { name: 'London, UK', lat: 51.5074, lon: -0.1278, tz: 'Europe/London' },
  { name: 'Paris, France', lat: 48.8566, lon: 2.3522, tz: 'Europe/Paris' },
  { name: 'Berlin, Germany', lat: 52.52, lon: 13.405, tz: 'Europe/Berlin' },
  { name: 'Madrid, Spain', lat: 40.4168, lon: -3.7038, tz: 'Europe/Madrid' },
  { name: 'Rome, Italy', lat: 41.9028, lon: 12.4964, tz: 'Europe/Rome' },
  { name: 'Longyearbyen, Svalbard', lat: 78.2232, lon: 15.6267, tz: 'Arctic/Longyearbyen' },
  { name: 'Cairo, Egypt', lat: 30.0444, lon: 31.2357, tz: 'Africa/Cairo' },
  { name: 'Lagos, Nigeria', lat: 6.5244, lon: 3.3792, tz: 'Africa/Lagos' },
  { name: 'Nairobi, Kenya', lat: -1.2921, lon: 36.8219, tz: 'Africa/Nairobi' },
  { name: 'Cape Town, South Africa', lat: -33.9249, lon: 18.4241, tz: 'Africa/Johannesburg' },
  { name: 'Dubai, UAE', lat: 25.2048, lon: 55.2708, tz: 'Asia/Dubai' },
  { name: 'Mumbai, India', lat: 19.076, lon: 72.8777, tz: 'Asia/Kolkata' },
  { name: 'Singapore', lat: 1.3521, lon: 103.8198, tz: 'Asia/Singapore' },
  { name: 'Hong Kong', lat: 22.3193, lon: 114.1694, tz: 'Asia/Hong_Kong' },
  { name: 'Tokyo, Japan', lat: 35.6762, lon: 139.6503, tz: 'Asia/Tokyo' },
  { name: 'Sydney, Australia', lat: -33.8688, lon: 151.2093, tz: 'Australia/Sydney' },
  { name: 'Auckland, New Zealand', lat: -36.8509, lon: 174.7645, tz: 'Pacific/Auckland' },
];

/* ---------- time helpers ---------- */

/** UTC offset in hours for an IANA zone at a given instant. */
function zoneOffsetHours(timeZone, atDate) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' });
    const part = dtf.formatToParts(atDate).find((p) => p.type === 'timeZoneName');
    const m = part && part.value.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return 0; // "GMT" with no digits = UTC
    return (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) + (m[3] ? parseInt(m[3], 10) / 60 : 0));
  } catch {
    return 0;
  }
}

/** Calendar date + minutes-of-day right now, in a fixed UTC offset (hours). */
function nowInOffset(tzHours) {
  const shifted = new Date(Date.now() + tzHours * 3600e3);
  return {
    date: {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
    },
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

const pad2 = (n) => String(n).padStart(2, '0');
const fmtClock = (min) => {
  let m = Math.round(min);
  m = ((m % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
};
const fmtDuration = (min) => `${Math.floor(min / 60)}h ${pad2(Math.round(min) % 60)}m`;
const fmtDeg = (v, digits = 1) => `${v.toFixed(digits)}°`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function doyToDate(year, doy) {
  let m = 1;
  let d = doy;
  while (d > daysInMonth(year, m)) {
    d -= daysInMonth(year, m);
    m += 1;
  }
  return { month: m, day: d };
}
function dateToDoy(date) {
  let doy = date.day;
  for (let m = 1; m < date.month; m++) doy += daysInMonth(date.year, m);
  return doy;
}

/* ---------- state ---------- */

const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
const initialNow = new Date();

const state = {
  lat: 40.7128,
  lon: -74.006,
  tz: browserZone ? zoneOffsetHours(browserZone, initialNow) : -Math.round(initialNow.getTimezoneOffset()) / 60,
  tzZone: browserZone, // IANA zone to keep DST right when the date changes; null = manual offset
  date: {
    year: initialNow.getFullYear(),
    month: initialNow.getMonth() + 1,
    day: initialNow.getDate(),
  },
  minutes: initialNow.getHours() * 60 + initialNow.getMinutes(),
  live: false,
  scenic: false,
  compare: false,
  dateB: null,   // {year, month, day}; defaults to six months from date A
  placeLabel: '',
  // status: idle | loading | ok | out-of-range | error
  weather: { status: 'idle', key: '', data: null, summary: null, message: '' },
};

/**
 * A link carries the whole view, so any place/date/time can be bookmarked or
 * sent to someone. URL parameters win over the stored preferences below,
 * since an explicit link is a stronger signal than "wherever I was last".
 */
function applyUrlState() {
  let params;
  try {
    params = new URLSearchParams(window.location.search);
  } catch { return false; }
  const num = (k) => {
    const v = parseFloat(params.get(k));
    return Number.isFinite(v) ? v : null;
  };
  const lat = num('lat');
  const lon = num('lon');
  if (lat == null || lon == null) return false;

  state.lat = Math.max(-90, Math.min(90, lat));
  state.lon = Math.max(-180, Math.min(180, lon));
  const tz = num('tz');
  if (tz != null) {
    state.tz = Math.max(-12, Math.min(14, tz));
    state.tzZone = null;               // an explicit offset is not a zone
  }
  const zone = params.get('zone');
  if (zone) {
    state.tzZone = zone;
    state.tz = zoneOffsetHours(zone, new Date());
  }
  const d = (params.get('d') || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (d) state.date = { year: +d[1], month: +d[2], day: +d[3] };
  const t = num('t');
  if (t != null) state.minutes = Math.max(0, Math.min(1439, Math.round(t)));
  const b = (params.get('b') || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (b) state.dateB = { year: +b[1], month: +b[2], day: +b[3] };
  if (params.get('compare') === '1') state.compare = true;
  if (params.get('scenic') === '1') state.scenic = true;
  const place = params.get('place');
  if (place) state.placeLabel = place.slice(0, 80);
  const theme = params.get('theme');
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
  return true;
}

/** Keep the address bar in step without adding history entries. */
function writeUrl() {
  try {
    const p = new URLSearchParams();
    p.set('lat', state.lat.toFixed(4));
    p.set('lon', state.lon.toFixed(4));
    if (state.tzZone) p.set('zone', state.tzZone); else p.set('tz', String(state.tz));
    p.set('d', `${state.date.year}-${pad2(state.date.month)}-${pad2(state.date.day)}`);
    p.set('t', String(state.minutes));
    if (state.placeLabel) p.set('place', state.placeLabel);
    if (state.compare) {
      p.set('compare', '1');
      const b = state.dateB || sixMonthsFrom(state.date);
      p.set('b', `${b.year}-${pad2(b.month)}-${pad2(b.day)}`);
    }
    if (state.scenic) p.set('scenic', '1');
    const theme = document.documentElement.dataset.theme;
    if (theme) p.set('theme', theme);
    window.history.replaceState(null, '', `${window.location.pathname}?${p}`);
  } catch { /* file:// and some sandboxes refuse replaceState */ }
}

// Dragging the time slider fires continuously; the address bar can lag behind.
let urlTimer = null;
function syncUrl() {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(writeUrl, 200);
}

/* Restore location, theme and scenic preference from the last visit. */
const STORE_KEY = 'solar-tracker-v1';
const fromUrl = applyUrlState();
try {
  const saved = fromUrl ? null : JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lon)) {
    state.lat = saved.lat;
    state.lon = saved.lon;
    state.tzZone = saved.tzZone ?? null;
    state.tz = state.tzZone ? zoneOffsetHours(state.tzZone, initialNow) : (Number.isFinite(saved.tz) ? saved.tz : state.tz);
    state.scenic = !!saved.scenic;
    state.compare = !!saved.compare;
    state.placeLabel = saved.placeLabel || '';
    if (saved.theme) document.documentElement.dataset.theme = saved.theme;
  }
} catch { /* corrupted storage: start fresh */ }

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      lat: state.lat, lon: state.lon, tz: state.tz, tzZone: state.tzZone,
      scenic: state.scenic, compare: state.compare, placeLabel: state.placeLabel,
      theme: document.documentElement.dataset.theme || null,
    }));
  } catch { /* storage unavailable (private mode etc.) */ }
  syncUrl();
}

/* ---------- element handles ---------- */

const $ = (id) => document.getElementById(id);
const els = {
  search: $('city-search'), results: $('city-results'),
  lat: $('lat-input'), lon: $('lon-input'), tz: $('tz-input'),
  date: $('date-input'), slider: $('time-slider'), timeDisplay: $('time-display'),
  geoBtn: $('geo-btn'), nowBtn: $('now-btn'), liveToggle: $('live-toggle'),
  geoStatus: $('geo-status'), themeToggle: $('theme-toggle'),
  explain: $('explain'), dayChartSub: $('day-chart-sub'),
  scenicToggle: $('scenic-toggle'), scenePanel: $('scene-panel'),
  linkBtn: $('link-btn'),
  compareToggle: $('compare-toggle'), compareCard: $('compare-card'),
  compareSub: $('compare-sub'), dateALabel: $('date-a-label'),
  dateBGroup: $('date-b-group'), dateB: $('date-b-input'),
  globeGrid: $('globe-grid'), deltaList: $('delta-list'),
  orbitHolder: $('orbit-holder'), orbitCaption: $('orbit-caption'),
  weatherCard: $('weather-card'), weatherSub: $('weather-sub'),
  weatherBody: $('weather-body'), weatherIcon: $('weather-icon'),
  weatherLabel: $('weather-label'), weatherTemp: $('weather-temp'),
  weatherStats: $('weather-stats'), weatherNote: $('weather-note'),
  irrTitle: $('irr-title'), irrSub: $('irr-sub'),
  lightSub: $('light-sub'), lightBands: $('light-bands'),
  sunTimes: $('sun-times'), lightNote: $('light-note'),
};

/* ---------- computation for one render ---------- */

function sampleDay(date, stepMin = 5) {
  const out = [];
  for (let m = 0; m <= 1440; m += stepMin) {
    out.push({ m, pos: sunPosition(state.lat, state.lon, date, Math.min(m, 1439.999), state.tz) });
  }
  return out;
}

/** Six months from a date — the strongest seasonal contrast, as the default B. */
function sixMonthsFrom(date) {
  const month = ((date.month - 1 + 6) % 12) + 1;
  const year = date.month + 6 > 12 ? date.year + 1 : date.year;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

const fmtDateShort = (d) => `${MONTHS[d.month - 1]} ${d.day}`;
const fmtDateLong = (d) => `${MONTHS[d.month - 1]} ${d.day}, ${d.year}`;

function computeModel() {
  const { lat, lon, tz, date, minutes } = state;
  const year = date.year;
  const junSolstice = { year, month: 6, day: 21 };
  const decSolstice = { year, month: 12, day: 21 };

  const now = sunPosition(lat, lon, date, minutes, tz);
  const today = dayInfo(lat, lon, date, tz);

  const daySamples = sampleDay(date);
  const junSamples = sampleDay(junSolstice, 10);
  const decSamples = sampleDay(decSolstice, 10);

  const yearDays = (dateToDoy({ year, month: 12, day: 31 }));
  const yearNoon = [];
  const yearDayLen = [];
  for (let doy = 1; doy <= yearDays; doy++) {
    const { month, day } = doyToDate(year, doy);
    const info = dayInfo(lat, lon, { year, month, day }, tz);
    yearNoon.push({ x: doy, y: info.noonElevation });
    yearDayLen.push({ x: doy, y: info.dayLength / 60 });
  }

  // Comparison date: a full parallel set of the same quantities.
  let compare = null;
  if (state.compare) {
    const dateB = state.dateB || sixMonthsFrom(date);
    compare = {
      dateB,
      samples: sampleDay(dateB),
      info: dayInfo(lat, lon, dateB, tz),
      insolation: dailyInsolation(lat, lon, dateB, tz),
    };
  }

  const w = state.weather;
  const weatherHours = w.status === 'ok' && w.data ? w.data.day.hours : null;

  return {
    now, today, daySamples, junSamples, decSamples, yearNoon, yearDayLen, compare, weatherHours,
    insolationToday: dailyInsolation(lat, lon, date, tz),
    insolationJun: dailyInsolation(lat, lon, junSolstice, tz),
    insolationDec: dailyInsolation(lat, lon, decSolstice, tz),
  };
}

/* ---------- stats ---------- */

function setStat(id, value, sub) {
  $(id).textContent = value;
  $(`${id}-sub`).textContent = sub || '';
}

function renderStats(model) {
  const { now, today } = model;
  const up = now.apparentElevation > -0.833;

  setStat('stat-elevation', fmtDeg(now.apparentElevation),
    up ? 'above the horizon' : 'below the horizon');
  setStat('stat-azimuth', fmtDeg(now.azimuth, 0),
    `${compassPoint(now.azimuth)} · 0° = north, clockwise`);
  setStat('stat-max', fmtDeg(today.noonElevation),
    `at solar noon, ${fmtClock(today.solarNoon)}`);

  if (today.polar === 'day') {
    setStat('stat-sunrise', '—', 'midnight sun: no sunset today');
    setStat('stat-sunset', '—', 'sun stays above the horizon');
  } else if (today.polar === 'night') {
    setStat('stat-sunrise', '—', 'polar night: sun never rises');
    setStat('stat-sunset', '—', 'sun stays below the horizon');
  } else {
    const riseAz = sunPosition(state.lat, state.lon, state.date, today.sunrise, state.tz).azimuth;
    const setAz = sunPosition(state.lat, state.lon, state.date, today.sunset, state.tz).azimuth;
    setStat('stat-sunrise', fmtClock(today.sunrise), `bearing ${fmtDeg(riseAz, 0)} (${compassPoint(riseAz)})`);
    setStat('stat-sunset', fmtClock(today.sunset), `bearing ${fmtDeg(setAz, 0)} (${compassPoint(setAz)})`);
  }
  setStat('stat-daylength', fmtDuration(today.dayLength), 'sunrise to sunset');

  const irr = clearSkyIrradiance(now.apparentElevation);
  setStat('stat-ghi', `${Math.round(irr.ghi)} W/m²`,
    up ? `air mass ${airMass(now.apparentElevation).toFixed(2)}` : 'sun below horizon');
  setStat('stat-insolation', `${model.insolationToday.toFixed(1)} kWh/m²`, 'cloud-free, horizontal surface');
}

/* ---------- charts ---------- */

const HOUR_TICKS = [0, 4, 8, 12, 16, 20, 24].map((h) => ({ v: h * 60, label: `${pad2(h)}:00` }));
function monthTicks(year) {
  const ticks = [];
  let doy = 1;
  for (let m = 1; m <= 12; m++) {
    ticks.push({ v: doy, label: MONTHS[m - 1] });
    doy += daysInMonth(year, m);
  }
  return ticks;
}

let domeChart = null;
let dayChart = null;
let irrChart = null;
let yearChart = null;
let dayLenChart = null;

function domeConfig(model) {
  const toPath = (samples) => samples.map((s) => ({
    azimuth: s.pos.azimuth,
    elevation: s.pos.apparentElevation,
  }));
  const hourMarks = model.daySamples
    .filter((s) => s.m % 60 === 0)
    .map((s) => ({ azimuth: s.pos.azimuth, elevation: s.pos.apparentElevation }));
  const paths = model.compare
    ? [
        { name: fmtDateShort(state.date), colorVar: '--series-1', points: toPath(model.daySamples) },
        { name: fmtDateShort(model.compare.dateB), colorVar: '--series-b', points: toPath(model.compare.samples) },
      ]
    : [
        { name: 'Selected day', colorVar: '--series-1', points: toPath(model.daySamples) },
        { name: 'Jun 21 solstice', colorVar: '--series-2', points: toPath(model.junSamples), dash: '4 4' },
        { name: 'Dec 21 solstice', colorVar: '--series-3', points: toPath(model.decSamples), dash: '4 4' },
      ];
  return {
    paths,
    sun: { azimuth: model.now.azimuth, elevation: model.now.apparentElevation },
    hourMarks,
  };
}

function dayChartConfig(model) {
  const toSeries = (samples) => samples.map((s) => ({ x: s.m, y: s.pos.apparentElevation }));
  const series = model.compare
    ? [
        { name: fmtDateShort(state.date), colorVar: '--series-1', points: toSeries(model.daySamples), area: true },
        { name: fmtDateShort(model.compare.dateB), colorVar: '--series-b', points: toSeries(model.compare.samples), area: true },
      ]
    : [
        { name: 'Selected day', colorVar: '--series-1', points: toSeries(model.daySamples), area: true },
        { name: 'Jun 21 solstice', colorVar: '--series-2', points: toSeries(model.junSamples), dash: '4 4' },
        { name: 'Dec 21 solstice', colorVar: '--series-3', points: toSeries(model.decSamples), dash: '4 4' },
      ];
  const all = model.compare
    ? [model.daySamples, model.compare.samples]
    : [model.daySamples, model.junSamples, model.decSamples];
  const yMax = Math.min(90, Math.ceil((Math.max(...all.flat().map((s) => s.pos.apparentElevation)) + 6) / 10) * 10);
  return {
    ariaLabel: 'Sun elevation through the day',
    series,
    xDomain: [0, 1440],
    yDomain: [-12, Math.max(yMax, 10)],
    xTicks: HOUR_TICKS,
    yLabel: 'elevation',
    formatX: fmtClock,
    formatY: (y) => fmtDeg(y),
    markers: [{
      x: state.minutes, y: model.now.apparentElevation, colorVar: '--sun',
    }],
    tableCaption: 'Local time',
    tableSampleEvery: 12,
  };
}

/**
 * Put the provider's hourly radiation on the same 5-minute grid as the
 * clear-sky curve, so the crosshair and the table line the two up exactly.
 * Values are pinned to zero wherever the sun is down.
 */
function resampleHourly(hours, clearPoints) {
  const pts = hours
    .filter((h) => typeof h.ghi === 'number' && Number.isFinite(h.ghi))
    .map((h) => ({ x: h.minutes, y: h.ghi }));
  if (pts.length < 2) return null;
  return clearPoints.map((cp) => {
    if (cp.y <= 0) return { x: cp.x, y: 0 };
    const x = Math.max(pts[0].x, Math.min(pts[pts.length - 1].x, cp.x));
    let i = 0;
    while (i < pts.length - 2 && pts[i + 1].x < x) i++;
    const a = pts[i];
    const b = pts[i + 1];
    const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
    return { x: cp.x, y: Math.max(0, a.y + (b.y - a.y) * t) };
  });
}

function irrConfig(model) {
  const toGhi = (samples) => samples.map((s) => ({
    x: s.m,
    y: clearSkyIrradiance(s.pos.apparentElevation).ghi,
  }));
  const points = toGhi(model.daySamples);

  // With weather loaded, the clear-sky curve becomes the reference ceiling and
  // the measured curve carries the emphasis - the gap between them is the story.
  const sum = weatherSummary();
  const actual = !model.compare && sum ? resampleHourly(model.weatherHours || [], points) : null;

  const series = model.compare
    ? [
        { name: fmtDateShort(state.date), colorVar: '--series-1', points, area: true },
        { name: fmtDateShort(model.compare.dateB), colorVar: '--series-b', points: toGhi(model.compare.samples), area: true },
      ]
    : actual
      ? [
          { name: 'Actual (with cloud)', colorVar: '--series-2', points: actual, area: true },
          { name: 'Clear-sky ceiling', colorVar: '--series-1', points, dash: '5 4' },
        ]
      : [{ name: 'Clear-sky GHI', colorVar: '--series-1', points, area: true }];
  const yMax = Math.max(200, Math.ceil(Math.max(...series.flatMap((x) => x.points).map((p) => p.y)) / 100) * 100);
  return {
    ariaLabel: 'Clear-sky solar irradiance through the day',
    series,
    xDomain: [0, 1440],
    yDomain: [0, yMax],
    xTicks: HOUR_TICKS,
    yLabel: 'W/m²',
    formatX: fmtClock,
    formatY: (y) => `${Math.round(y)} W/m²`,
    markers: [{
      x: state.minutes,
      y: (actual ? series[0].points : points)
        .reduce((best, p) => (Math.abs(p.x - state.minutes) < Math.abs(best.x - state.minutes) ? p : best), points[0]).y,
      colorVar: '--sun',
    }],
    tableCaption: 'Local time',
    tableSampleEvery: 12,
  };
}

function seasonRefLines(year) {
  return [
    { x: dateToDoy({ year, month: 3, day: 20 }), label: 'equinox' },
    { x: dateToDoy({ year, month: 6, day: 21 }), label: 'solstice' },
    { x: dateToDoy({ year, month: 9, day: 22 }), label: 'equinox' },
    { x: dateToDoy({ year, month: 12, day: 21 }), label: 'solstice' },
  ];
}

function yearConfig(model) {
  const year = state.date.year;
  const doy = dateToDoy(state.date);
  const sel = model.yearNoon[doy - 1];
  return {
    ariaLabel: 'Maximum sun elevation for each day of the year',
    series: [{ name: 'Noon elevation', colorVar: '--series-1', points: model.yearNoon }],
    xDomain: [1, model.yearNoon.length],
    yDomain: [Math.min(0, Math.floor(Math.min(...model.yearNoon.map((p) => p.y)) / 10) * 10), 90],
    xTicks: monthTicks(year),
    yLabel: 'elevation',
    formatX: (x) => {
      const { month, day } = doyToDate(year, Math.round(x));
      return `${MONTHS[month - 1]} ${day}`;
    },
    formatY: (y) => fmtDeg(y),
    refLines: seasonRefLines(year),
    markers: sel ? [{ x: doy, y: sel.y, colorVar: '--sun' }] : [],
    tableCaption: 'Date',
    tableSampleEvery: 7,
  };
}

function dayLenConfig(model) {
  const year = state.date.year;
  const doy = dateToDoy(state.date);
  const sel = model.yearDayLen[doy - 1];
  return {
    ariaLabel: 'Day length for each day of the year',
    series: [{ name: 'Day length', colorVar: '--series-1', points: model.yearDayLen, area: true }],
    xDomain: [1, model.yearDayLen.length],
    yDomain: [0, 24],
    xTicks: monthTicks(year),
    yTicks: [0, 6, 12, 18, 24].map((v) => ({ v, label: `${v}h` })),
    formatX: (x) => {
      const { month, day } = doyToDate(year, Math.round(x));
      return `${MONTHS[month - 1]} ${day}`;
    },
    formatY: (y) => fmtDuration(y * 60),
    refLines: seasonRefLines(year),
    markers: sel ? [{ x: doy, y: sel.y, colorVar: '--sun' }] : [],
    tableCaption: 'Date',
    tableSampleEvery: 7,
  };
}

/* ---------- explanations ---------- */

function explainHTML(model) {
  const { lat } = state;
  const { now, today } = model;
  const absLat = Math.abs(lat);
  const hemi = lat >= 0 ? 'northern' : 'southern';

  const maxNoonYear = 90 - Math.max(0, Math.abs(lat) - 23.44);
  const minNoonYear = Math.max(0, 90 - (Math.abs(lat) + 23.44));

  let band;
  if (absLat <= 23.44) {
    band = 'You are in the <strong>tropics</strong>: the sun passes directly overhead twice a year, noon height barely changes, and day length stays near 12 hours. Seasons here are usually defined by rainfall (the ITCZ follows the high sun) rather than temperature.';
  } else if (absLat <= 35) {
    band = 'You are in the <strong>subtropics</strong>: strong, high sun for much of the year drives hot summers and high evaporation; many of the world\'s deserts sit in this belt of descending dry air.';
  } else if (absLat <= 55) {
    band = 'You are in the <strong>mid-latitudes</strong>: the large annual swing in sun height and day length creates four distinct seasons, and the strong equator-to-pole heating contrast steers the storm tracks and jet stream over you.';
  } else if (absLat <= 66.56) {
    band = 'You are in the <strong>subpolar zone</strong>: the sun stays low even in summer, so sunlight spreads over a large area and the ground heats weakly — long, bright summer days but a cold climate overall.';
  } else {
    band = 'You are <strong>inside the polar circle</strong>: the sun stays up for 24 hours around the summer solstice (midnight sun) and never rises around the winter solstice (polar night) — the most extreme seasonal light cycle on Earth.';
  }

  const loSol = Math.min(model.insolationJun, model.insolationDec);
  const hiSol = Math.max(model.insolationJun, model.insolationDec);
  const seasonSentence = loSol > 0.05
    ? `a <strong>${(hiSol / loSol).toFixed(1)}×</strong> seasonal difference in daily solar energy.`
    : 'in the darker season the sun contributes essentially no energy at all.';

  const am = airMass(now.apparentElevation);
  const amText = Number.isFinite(am)
    ? `Right now sunlight crosses <strong>${am.toFixed(2)}×</strong> the overhead thickness of atmosphere, and the same beam is spread over <strong>${(1 / Math.max(0.02, Math.sin(now.apparentElevation * Math.PI / 180))).toFixed(1)}×</strong> more ground than an overhead sun — both effects weaken it.`
    : 'The sun is below the horizon right now, so no direct sunlight reaches the surface.';

  const tilt = Math.min(90, Math.max(0, Math.round(absLat)));
  const summerTilt = Math.max(0, tilt - 15);
  const winterTilt = Math.min(90, tilt + 15);

  return `
  <h3>Why the sun's height changes</h3>
  <p>Earth's axis is tilted <strong>23.44°</strong>. Today the sun stands overhead at latitude
  <strong>${fmtDeg(today.declination)}</strong> (its <em>declination</em>). At your latitude of
  <strong>${fmtDeg(lat)}</strong> the noon sun reaches <strong>${fmtDeg(today.noonElevation)}</strong> today,
  and over the year it swings between <strong>${fmtDeg(minNoonYear)}</strong> and
  <strong>${fmtDeg(maxNoonYear)}</strong>. That swing — not distance from the sun — is what makes the seasons.</p>

  <h3>Sun angle → solar radiation</h3>
  <p>A low sun is weak for two reasons: its light passes through more air and lands at a slant.
  ${amText}</p>
  <p>Cloud-free, this location would receive about <strong>${model.insolationJun.toFixed(1)} kWh/m²</strong> on the
  June solstice and <strong>${model.insolationDec.toFixed(1)} kWh/m²</strong> on the December solstice —
  ${seasonSentence}</p>

  <h3>Weather &amp; climate at this latitude</h3>
  <p>${band}</p>
  <p>In the ${hemi} hemisphere the surface warms most when the sun is high and days are long; because
  land and oceans store heat, the warmest and coldest weather lags the solstices by roughly a month —
  which is why the hottest days come after the year's highest sun.</p>

  <h3>If you're placing solar panels</h3>
  <p>A fixed panel here works best facing ${lat >= 0 ? 'south' : 'north'} at a tilt near your latitude:
  about <strong>${tilt}°</strong> year-round, or <strong>${summerTilt}°</strong> to favor summer and
  <strong>${winterTilt}°</strong> to favor winter, when the sun sits lower.</p>`;
}

/* ---------- render ---------- */

function updateScene(model) {
  els.scenePanel.hidden = !state.scenic;
  els.scenicToggle.setAttribute('aria-pressed', String(state.scenic));
  els.scenicToggle.classList.toggle('ghost-btn-active', state.scenic);
  if (!state.scenic) return;
  const { today } = model;
  const elev = model.now.apparentElevation;
  const sunNote = elev > -0.833
    ? `sun ${fmtDeg(elev)} ${compassPoint(model.now.azimuth)}`
    : today.polar === 'night' ? 'polar night'
    : elev > -18 ? (state.minutes < today.solarNoon ? 'dawn twilight' : 'dusk twilight')
    : 'night';
  const sum = weatherSummary();
  renderScene(els.scenePanel, {
    elevation: model.now.apparentElevation,
    azimuth: model.now.azimuth,
    lat: state.lat,
    month: state.date.month,
    weather: sum ? {
      cloud: sum.at.cloud ?? 0,
      precip: sum.at.precip ?? 0,
      group: sum.condition.group,
    } : null,
    timeLabel: fmtClock(state.minutes),
    dateLabel: `${MONTHS[state.date.month - 1]} ${state.date.day}${state.placeLabel ? ' · ' + state.placeLabel : ''}`,
    sunNote: sum ? `${sum.condition.icon} ${sum.condition.label} · ${sunNote}` : sunNote,
  });
}

/* ---------- light through the day ---------- */

// Band colors run night -> day, so the strip reads as a sky at a glance.
const LIGHT_BANDS = [
  { key: 'night',  label: 'Night',                 fill: '#131a2b' },
  { key: 'astro',  label: 'Astronomical twilight', fill: '#1e2a4d' },
  { key: 'naut',   label: 'Nautical twilight',     fill: '#2f4272' },
  { key: 'civil',  label: 'Civil twilight',        fill: '#5b6ea8' },
  { key: 'day',    label: 'Daylight',              fill: '#8fc0ea' },
];

/**
 * Slice the day into light bands. Each phase gives a morning and evening
 * crossing; between them the sun is higher than that threshold. Polar cases
 * fall out naturally: a phase the sun never reaches contributes nothing.
 */
function lightSegments(phases) {
  const edges = [
    ['astro', phases.astronomical],
    ['naut', phases.nautical],
    ['civil', phases.civil],
    ['day', phases.sunrise],
  ];
  // Start with the whole day as the darkest band, then carve inward.
  let segments = [{ key: 'night', from: 0, to: 1440 }];
  for (const [key, p] of edges) {
    if (p.state === 'never-reaches') break;          // never gets this bright
    const from = p.state === 'always-above' ? 0 : Math.max(0, p.morning);
    const to = p.state === 'always-above' ? 1440 : Math.min(1440, p.evening);
    if (to <= from) break;
    segments = segments.flatMap((seg) => {
      if (seg.to <= from || seg.from >= to) return [seg];
      const out = [];
      if (seg.from < from) out.push({ key: seg.key, from: seg.from, to: from });
      out.push({ key, from: Math.max(seg.from, from), to: Math.min(seg.to, to) });
      if (seg.to > to) out.push({ key: seg.key, from: to, to: seg.to });
      return out;
    });
  }
  return segments.filter((sg) => sg.to - sg.from > 0.5);
}

function renderLightBands(phases, uvb) {
  const W = 1000;
  const H = 46;
  const barH = 26;
  const X = (m) => (m / 1440) * W;
  const fillOf = (key) => LIGHT_BANDS.find((b) => b.key === key).fill;

  const bands = lightSegments(phases).map((sg) =>
    `<rect x="${X(sg.from).toFixed(1)}" y="0" width="${(X(sg.to) - X(sg.from)).toFixed(1)}" height="${barH}" fill="${fillOf(sg.key)}"/>`
  ).join('');

  // The UV-B window rides as a stripe inside the daylight band.
  let uvbStripe = '';
  if (uvb.state === 'crosses' || uvb.state === 'always-above') {
    const from = uvb.state === 'always-above' ? 0 : uvb.morning;
    const to = uvb.state === 'always-above' ? 1440 : uvb.evening;
    uvbStripe = `<rect x="${X(from).toFixed(1)}" y="${barH - 7}" width="${(X(to) - X(from)).toFixed(1)}"`
      + ` height="6" fill="var(--sun)" opacity="0.95"/>`;
  }

  const ticks = [0, 6, 12, 18, 24].map((h) => {
    const x = X(h * 60);
    const anchor = h === 0 ? 'start' : h === 24 ? 'end' : 'middle';
    return `<text x="${x.toFixed(1)}" y="${H - 2}" class="band-tick" text-anchor="${anchor}">${pad2(h)}:00</text>`;
  }).join('');

  const nowX = X(state.minutes);
  const marker = `<line x1="${nowX.toFixed(1)}" y1="-2" x2="${nowX.toFixed(1)}" y2="${barH + 2}" class="band-marker"/>`;

  els.lightBands.innerHTML =
    `<svg viewBox="0 -3 ${W} ${H + 3}" role="img" aria-label="Twilight bands through the day, with the UV-B window marked">`
    + `${bands}${uvbStripe}${marker}${ticks}</svg>`;
}

function sunTime(label, value, sub, fill) {
  const wrap = document.createElement('div');
  wrap.className = 'sun-time';
  const l = document.createElement('span');
  l.className = 'sun-time-label';
  if (fill) {
    const key = document.createElement('span');
    key.className = 'sun-time-key';
    key.style.background = fill;
    l.appendChild(key);
  }
  l.appendChild(document.createTextNode(label));
  const v = document.createElement('span');
  v.className = 'sun-time-value';
  v.textContent = value;
  wrap.appendChild(l);
  wrap.appendChild(v);
  if (sub) {
    const sEl = document.createElement('span');
    sEl.className = 'sun-time-sub';
    sEl.textContent = sub;
    wrap.appendChild(sEl);
  }
  return wrap;
}

/** Dates bounding the stretch of the year with no UV-B at solar noon. */
function uvbWinter(model) {
  const below = model.yearNoon.filter((p) => p.y < UVB_ELEVATION).map((p) => p.x);
  if (!below.length) return null;                    // sun high enough all year
  if (below.length === model.yearNoon.length) return 'all-year';
  const year = state.date.year;
  // The gap wraps midwinter, so find the run that includes Jan 1 or Dec 31.
  const set = new Set(below);
  let start = 1;
  while (set.has(start)) start++;                    // first day above threshold
  let d = start;
  const run = [];
  for (let i = 0; i < model.yearNoon.length; i++) {
    d = d % model.yearNoon.length + 1;
    if (set.has(d)) run.push(d);
  }
  if (!run.length) return null;
  const first = run[0];
  const last = run[run.length - 1];
  return {
    from: doyToDate(year, first),
    to: doyToDate(year, last),
    days: run.length,
  };
}

function renderLight(model) {
  const { lat, lon, tz, date } = state;
  const phases = dayLightPhases(lat, lon, date, tz);
  renderLightBands(phases, phases.uvb);

  const t = (v) => (v == null ? '—' : fmtClock(v));
  const noon = model.today.solarNoon;

  els.lightSub.textContent = `${fmtDateLong(date)} · all times local`;
  els.sunTimes.textContent = '';

  const rows = [
    ['First light', phases.astronomical.morning, 'astronomical dawn', '#1e2a4d'],
    ['Dawn', phases.civil.morning, 'civil twilight begins', '#5b6ea8'],
    ['Sunrise', phases.sunrise.morning, 'upper limb clears the horizon', '#8fc0ea'],
    ['Golden hour ends', phases.golden.morning, 'sun passes 6°', 'var(--sun)'],
    ['Solar noon', noon, `sun at ${fmtDeg(model.today.noonElevation)}`, null],
    ['Golden hour begins', phases.golden.evening, 'sun drops below 6°', 'var(--sun)'],
    ['Sunset', phases.sunrise.evening, 'upper limb touches the horizon', '#8fc0ea'],
    ['Dusk', phases.civil.evening, 'civil twilight ends', '#5b6ea8'],
    ['Last light', phases.astronomical.evening, 'astronomical dusk', '#1e2a4d'],
  ];
  for (const [label, value, sub, fill] of rows) {
    els.sunTimes.appendChild(sunTime(label, t(value), sub, fill));
  }

  // UV-B / vitamin D window.
  const uvb = phases.uvb;
  const uvbValue = uvb.state === 'crosses'
    ? `${fmtClock(uvb.morning)} – ${fmtClock(uvb.evening)}`
    : uvb.state === 'always-above' ? 'all day' : 'none today';
  els.sunTimes.appendChild(sunTime('UV-B window', uvbValue,
    `sun above ${UVB_ELEVATION}°`, 'var(--sun)'));

  // Notes: the vitamin D story, then UV index when weather is loaded.
  const winter = uvbWinter(model);
  const notes = [];
  if (uvb.state === 'never-reaches') {
    notes.push(`<strong>The sun stays below ${UVB_ELEVATION}° all day here.</strong> Almost no UV-B `
      + `reaches the ground at these angles, so sunlight produces essentially no vitamin D on this date — `
      + `the "vitamin D winter". Sunlight is still worth getting for circadian timing; it just is not doing this job.`);
  } else {
    const mins = uvb.state === 'always-above' ? 1440 : uvb.evening - uvb.morning;
    notes.push(`The sun is above <strong>${UVB_ELEVATION}°</strong> for <strong>${fmtDuration(mins)}</strong> today. `
      + `Below roughly that angle the atmospheric path is long enough to absorb nearly all UV-B, so this window is `
      + `when sunlight can drive vitamin D synthesis at all.`);
  }
  if (winter && winter !== 'all-year') {
    notes.push(`Across the year, this location has <strong>${winter.days} days</strong> when the noon sun never `
      + `reaches ${UVB_ELEVATION}° — roughly ${fmtDateShort(winter.from)} to ${fmtDateShort(winter.to)}.`);
  } else if (winter === 'all-year') {
    notes.push(`At this latitude the noon sun never reaches ${UVB_ELEVATION}° on any day of the year.`);
  }

  const sum = weatherSummary();
  if (sum && sum.at.uv != null) {
    const band = uvBand(sum.at.uv);
    const peak = sum.uvMax != null ? `, peaking at <strong>${sum.uvMax.toFixed(1)}</strong> today` : '';
    notes.push(`UV index at ${fmtClock(state.minutes)} is <strong>${sum.at.uv.toFixed(1)}</strong> `
      + `(${band.label})${peak}. ${band.advice}`);
  }
  notes.push(`<em>Thresholds are the standard ones and the ${UVB_ELEVATION}° figure is a rule of thumb — `
    + `real UV-B depends on ozone, altitude, cloud, surface and skin. This is orientation, not medical advice.</em>`);

  els.lightNote.innerHTML = notes.join('</p><p class="light-note">');
}

/* ---------- weather ---------- */

const cToF = (c) => c * 9 / 5 + 32;
const fmtTemp = (c) => (c == null ? '—' : `${Math.round(c)}°C / ${Math.round(cToF(c))}°F`);

/** Local calendar date right now at the selected place. */
function todayLocal() {
  return nowInOffset(state.tz).date;
}

let weatherAbort = null;
let weatherTimer = null;

/** Refetch only when the place or date changes — not while scrubbing time. */
function scheduleWeather() {
  const key = `${state.lat.toFixed(3)},${state.lon.toFixed(3)},${fmtDateShort(state.date)},${state.date.year}`;
  if (key === state.weather.key && state.weather.status !== 'idle') return;

  state.weather = { status: 'loading', key, data: null, summary: null, message: '' };
  renderWeather();

  clearTimeout(weatherTimer);
  weatherTimer = setTimeout(() => {
    if (weatherAbort) weatherAbort.abort();
    weatherAbort = new AbortController();
    const forDate = { ...state.date };
    fetchWeather(state.lat, state.lon, forDate, todayLocal(), weatherAbort.signal)
      .then((data) => {
        if (state.weather.key !== key) return;   // a newer request superseded this
        state.weather = { status: 'ok', key, data, summary: null, message: '' };
        render();
      })
      .catch((err) => {
        if (err.name === 'AbortError' || state.weather.key !== key) return;
        state.weather = {
          status: err.code === 'OUT_OF_RANGE' ? 'out-of-range' : 'error',
          key,
          data: null,
          summary: null,
          message: err.message,
        };
        renderWeather();
      });
  }, 350);
}

function weatherStat(label, value, sub) {
  const wrap = document.createElement('div');
  wrap.className = 'weather-stat';
  const l = document.createElement('span');
  l.className = 'weather-stat-label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'weather-stat-value';
  v.textContent = value;
  wrap.appendChild(l);
  wrap.appendChild(v);
  if (sub) {
    const sEl = document.createElement('span');
    sEl.className = 'weather-stat-sub';
    sEl.textContent = sub;
    wrap.appendChild(sEl);
  }
  return wrap;
}

/** Conditions for the selected day, or null when none are loaded. */
function weatherSummary() {
  const w = state.weather;
  if (w.status !== 'ok' || !w.data) return null;
  return summarize(w.data.day, state.minutes);
}

function renderWeather(model) {
  const w = state.weather;
  const label = fmtDateLong(state.date);

  if (w.status !== 'ok') {
    els.weatherBody.hidden = true;
    els.weatherNote.hidden = true;
    els.weatherSub.textContent =
      w.status === 'loading' ? `Loading conditions for ${label}…`
      : w.status === 'out-of-range'
        ? `No weather data for ${label} — the forecast runs 15 days ahead, and records go back to 1940 (with a few days' lag).`
        : w.status === 'error'
          ? `Couldn't load weather (${w.message}). The solar figures above are unaffected.`
          : '';
    return;
  }

  const sum = summarize(w.data.day, state.minutes);
  els.weatherSub.textContent =
    `${label} · ${w.data.kind === 'archive' ? 'observed record' : 'forecast'} from Open-Meteo`;
  els.weatherBody.hidden = false;

  els.weatherIcon.textContent = sum.condition.icon;
  els.weatherLabel.textContent = `${sum.condition.label} · at ${fmtClock(state.minutes)}`;
  els.weatherTemp.textContent = fmtTemp(sum.at.temp);

  els.weatherStats.textContent = '';
  els.weatherStats.appendChild(weatherStat('High / low',
    sum.tempMax != null ? `${Math.round(sum.tempMax)}° / ${Math.round(sum.tempMin)}°C` : '—',
    sum.tempMax != null ? `${Math.round(cToF(sum.tempMax))}° / ${Math.round(cToF(sum.tempMin))}°F` : ''));
  els.weatherStats.appendChild(weatherStat('Cloud cover',
    sum.at.cloud != null ? `${Math.round(sum.at.cloud)}%` : '—',
    sum.cloudMean != null ? `${Math.round(sum.cloudMean)}% average today` : ''));
  els.weatherStats.appendChild(weatherStat('Precipitation',
    `${(sum.precipTotal ?? 0).toFixed(1)} mm`, 'total for the day'));
  els.weatherStats.appendChild(weatherStat('Wind',
    sum.at.wind != null ? `${Math.round(sum.at.wind)} km/h` : '—',
    sum.at.humidity != null ? `${Math.round(sum.at.humidity)}% humidity` : ''));
  if (sum.at.uv != null) {
    const band = uvBand(sum.at.uv);
    els.weatherStats.appendChild(weatherStat('UV index',
      `${sum.at.uv.toFixed(1)} · ${band.label}`,
      sum.uvMax != null ? `peaks at ${sum.uvMax.toFixed(1)} today` : ''));
  }
  els.weatherStats.appendChild(weatherStat('Sunshine',
    sum.sunshineHours != null ? `${sum.sunshineHours.toFixed(1)} h` : '—',
    'direct sun on the ground'));

  // The point of all this: how much of the clear-sky ceiling the sky allowed.
  const clear = model ? model.insolationToday : null;
  if (sum.actualKWh != null && clear) {
    const pct = Math.round((sum.actualKWh / clear) * 100);
    els.weatherStats.appendChild(weatherStat('Actual energy',
      `${sum.actualKWh.toFixed(1)} kWh/m²`, `${pct}% of clear sky`));
    els.weatherNote.hidden = false;
    els.weatherNote.textContent =
      `A cloud-free sky here would deliver ${clear.toFixed(1)} kWh/m² on this date. `
      + `The sky actually delivered ${sum.actualKWh.toFixed(1)} kWh/m² — `
      + `${pct >= 97 ? 'essentially the full clear-sky ceiling'
        : `${100 - pct}% of it lost to cloud`}. `
      + `That gap is the difference between the two curves on the radiation chart.`;
  } else {
    els.weatherNote.hidden = false;
    els.weatherNote.textContent =
      `Cloud cover averaged ${Math.round(sum.cloudMean ?? 0)}%, which by the Kasten–Czeplak relation `
      + `would pass roughly ${Math.round(cloudAttenuation(sum.cloudMean ?? 0) * 100)}% of clear-sky radiation.`;
  }
}

/* ---------- two-date comparison ---------- */

function globePanel(date, info, colorVar, idPrefix) {
  const times = info.polar === 'day' ? 'sun never sets'
    : info.polar === 'night' ? 'sun never rises'
    : `${fmtClock(info.sunrise)} – ${fmtClock(info.sunset)}`;
  const panel = document.createElement('div');
  panel.className = 'globe-panel';

  const cap = document.createElement('div');
  cap.className = 'globe-caption';
  const name = document.createElement('span');
  name.className = 'globe-date';
  const swatch = document.createElement('span');
  swatch.className = 'globe-swatch';
  swatch.style.background = `var(${colorVar})`;
  name.appendChild(swatch);
  name.appendChild(document.createTextNode(fmtDateLong(date)));
  const facts = document.createElement('span');
  facts.className = 'globe-facts';
  const noonText = fmtDeg(info.noonElevation).replace('-', '−');
  facts.textContent = `noon ${noonText} · ${fmtDuration(info.dayLength)} of daylight · ${times}`;
  cap.appendChild(name);
  cap.appendChild(facts);
  panel.appendChild(cap);

  panel.insertAdjacentHTML('beforeend', globeSVG({
    lat: state.lat,
    dec: info.declination,
    dateLabel: fmtDateLong(date),
    colorVar,
    idPrefix,
  }));
  return panel;
}

function deltaRow({ label, aVal, bVal, format, formatDiff, max, bars = true, note }) {
  const row = document.createElement('div');
  row.className = 'delta-row';

  const lab = document.createElement('div');
  lab.className = 'delta-label';
  lab.textContent = label;
  row.appendChild(lab);

  const barsWrap = document.createElement('div');
  barsWrap.className = 'delta-bars';
  for (const [val, colorVar] of [[aVal, '--series-1'], [bVal, '--series-b']]) {
    const r = document.createElement('div');
    r.className = 'delta-bar-row';
    const v = document.createElement('span');
    v.className = 'delta-value';
    v.textContent = format(val);
    if (bars) {
      const track = document.createElement('span');
      track.className = 'delta-track';
      const fill = document.createElement('span');
      fill.className = 'delta-fill';
      fill.style.background = `var(${colorVar})`;
      fill.style.width = `${Math.max(0, Math.min(100, (val / max) * 100))}%`;
      fill.style.display = 'block';
      track.appendChild(fill);
      r.appendChild(track);
    }
    r.appendChild(v);
    barsWrap.appendChild(r);
  }
  row.appendChild(barsWrap);

  const diff = document.createElement('div');
  diff.className = 'delta-diff';
  const d = bVal - aVal;
  diff.textContent = `${d >= 0 ? '+' : '−'}${(formatDiff || format)(Math.abs(d))}`;
  if (note) {
    const sub = document.createElement('span');
    sub.textContent = note;
    diff.appendChild(sub);
  }
  row.appendChild(diff);

  return row;
}

function renderCompare(model) {
  const on = state.compare && !!model.compare;
  els.compareCard.hidden = !on;
  els.dateBGroup.hidden = !state.compare;
  els.compareToggle.setAttribute('aria-pressed', String(state.compare));
  els.compareToggle.classList.toggle('ghost-btn-active', state.compare);
  els.dateALabel.textContent = state.compare ? 'Date A' : 'Date';
  if (!on) return;

  const { dateB, info: infoB, insolation: insolB } = model.compare;
  const a = model.today;
  const dateA = state.date;

  els.compareSub.textContent =
    `${fmtDateLong(dateA)} vs ${fmtDateLong(dateB)} at ${state.lat.toFixed(2)}°, ${state.lon.toFixed(2)}°`;

  els.globeGrid.textContent = '';
  els.globeGrid.appendChild(globePanel(dateA, a, '--series-1', 'ga'));
  els.globeGrid.appendChild(globePanel(dateB, infoB, '--series-b', 'gb'));

  const higher = (d) => (d >= 0 ? `${fmtDateShort(dateB)} higher` : `${fmtDateShort(dateA)} higher`);
  const longer = (d) => (d >= 0 ? `${fmtDateShort(dateB)} longer` : `${fmtDateShort(dateA)} longer`);
  const more = (d) => (d >= 0 ? `${fmtDateShort(dateB)} more` : `${fmtDateShort(dateA)} more`);

  els.deltaList.textContent = '';
  els.deltaList.appendChild(deltaRow({
    label: 'Noon sun elevation',
    aVal: a.noonElevation, bVal: infoB.noonElevation,
    format: (v) => fmtDeg(v), max: 90,
    note: higher(infoB.noonElevation - a.noonElevation),
  }));
  els.deltaList.appendChild(deltaRow({
    label: 'Daylight',
    aVal: a.dayLength, bVal: infoB.dayLength,
    format: (v) => fmtDuration(v), max: 1440,
    note: longer(infoB.dayLength - a.dayLength),
  }));
  els.deltaList.appendChild(deltaRow({
    label: 'Clear-sky energy',
    aVal: model.insolationToday, bVal: insolB,
    format: (v) => `${v.toFixed(1)} kWh/m²`,
    max: Math.max(model.insolationToday, insolB, 1),
    note: more(insolB - model.insolationToday),
  }));
  els.deltaList.appendChild(deltaRow({
    label: 'Sun overhead at',
    aVal: a.declination, bVal: infoB.declination,
    format: (v) => `${Math.abs(v).toFixed(1)}° ${v >= 0 ? 'N' : 'S'}`,
    formatDiff: (v) => fmtDeg(v),
    bars: false,
    note: 'solar declination',
  }));

  // Orbit inset
  const posA = earthOrbitPosition(dateA);
  const posB = earthOrbitPosition(dateB);
  els.orbitHolder.innerHTML = orbitSVG({
    a: { pos: posA, colorVar: '--series-1', label: fmtDateShort(dateA) },
    b: { pos: posB, colorVar: '--series-b', label: fmtDateShort(dateB) },
    year: dateA.year,
  });

  const nearer = posA.radiusAU < posB.radiusAU ? dateA : dateB;
  const spread = (Math.abs(posA.radiusAU - posB.radiusAU) / ((posA.radiusAU + posB.radiusAU) / 2)) * 100;
  els.orbitCaption.textContent =
    `Earth is ${posA.radiusAU.toFixed(4)} AU from the sun on ${fmtDateShort(dateA)} and ` +
    `${posB.radiusAU.toFixed(4)} AU on ${fmtDateShort(dateB)} — a difference of only ` +
    `${spread.toFixed(1)}%. The orbit above is drawn to scale, which is why it looks circular: ` +
    `being ${spread.toFixed(1)}% nearer on ${fmtDateShort(nearer)} is not what drives the ` +
    `difference between these two days. The tilt of the axis — fixed in space as Earth goes ` +
    `round, as the short line through each marker shows — is.`;
}

function syncControls() {
  els.search.value = state.placeLabel;
  els.lat.value = state.lat;
  els.lon.value = state.lon;
  els.tz.value = state.tz;
  els.date.value = `${state.date.year}-${pad2(state.date.month)}-${pad2(state.date.day)}`;
  const b = state.dateB || sixMonthsFrom(state.date);
  els.dateB.value = `${b.year}-${pad2(b.month)}-${pad2(b.day)}`;
  els.slider.value = state.minutes;
  els.timeDisplay.textContent = fmtClock(state.minutes);
}

function render() {
  const model = computeModel();
  renderStats(model);

  const dCfg = domeConfig(model);
  const dayCfg = dayChartConfig(model);
  const iCfg = irrConfig(model);
  const yCfg = yearConfig(model);
  const lCfg = dayLenConfig(model);

  if (!domeChart) {
    domeChart = renderSkyDome($('dome-chart'), dCfg);
    dayChart = renderLineChart($('day-chart'), dayCfg);
    irrChart = renderLineChart($('irradiance-chart'), iCfg);
    yearChart = renderLineChart($('year-chart'), yCfg);
    dayLenChart = renderLineChart($('daylength-chart'), lCfg);
  } else {
    domeChart.update(dCfg);
    dayChart.update(dayCfg);
    irrChart.update(iCfg);
    yearChart.update(yCfg);
    dayLenChart.update(lCfg);
  }

  els.explain.innerHTML = explainHTML(model);
  els.timeDisplay.textContent = fmtClock(state.minutes);
  updateScene(model);
  renderCompare(model);
  renderWeather(model);
  renderLight(model);
  labelIrradiance(model);
  syncUrl();
}

/** The radiation card means something different once weather is loaded. */
function labelIrradiance(model) {
  const showsActual = !model.compare && !!weatherSummary() && !!model.weatherHours;
  els.irrTitle.textContent = showsActual
    ? 'Solar radiation today: actual vs clear sky'
    : 'Clear-sky solar radiation today';
  els.irrSub.textContent = showsActual
    ? 'The dashed line is the cloud-free ceiling; the filled curve is what the sky actually delivered.'
    : 'Estimated global horizontal irradiance with no clouds (idealized).';
}

/** Lighter path when only the time-of-day changed: skip year charts. */
function renderTimeOnly() {
  const model = computeModel();
  renderStats(model);
  domeChart.update(domeConfig(model));
  dayChart.update(dayChartConfig(model));
  irrChart.update(irrConfig(model));
  els.explain.innerHTML = explainHTML(model);
  els.timeDisplay.textContent = fmtClock(state.minutes);
  updateScene(model);
  renderWeather(model);
  renderLight(model);
  labelIrradiance(model);
  syncUrl();
}

/* ---------- events ---------- */

function note(msg) {
  els.geoStatus.textContent = msg;
  els.geoStatus.hidden = !msg;
}

function selectedDateAsUTC() {
  return new Date(Date.UTC(state.date.year, state.date.month - 1, state.date.day, 12));
}

/* ----- city search (Open-Meteo geocoding, built-in list as fallback) ----- */

let searchItems = [];
let searchIdx = -1;
let searchTimer = null;
let searchAbort = null;

function applyPlace(place) {
  state.lat = +place.lat.toFixed(4);
  state.lon = +place.lon.toFixed(4);
  state.tzZone = place.tzZone || null;
  if (state.tzZone) state.tz = zoneOffsetHours(state.tzZone, selectedDateAsUTC());
  state.placeLabel = place.name;
  els.search.value = place.name;
  closeResults();
  note(place.tzZone ? '' :
    'No time zone found for this place — check the UTC offset field.');
  syncControls();
  scheduleWeather();
  render();
  persist();
}

function closeResults() {
  els.results.hidden = true;
  els.search.setAttribute('aria-expanded', 'false');
  searchIdx = -1;
}

function showResults(items, emptyMsg) {
  searchItems = items;
  searchIdx = -1;
  els.results.textContent = '';
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'city-empty';
    li.textContent = emptyMsg || 'No matches';
    els.results.appendChild(li);
  }
  items.forEach((item, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.dataset.idx = i;
    const name = document.createElement('span');
    name.className = 'city-name';
    name.textContent = item.name;
    li.appendChild(name);
    if (item.sub) {
      const sub = document.createElement('span');
      sub.className = 'city-sub';
      sub.textContent = item.sub;
      li.appendChild(sub);
    }
    li.addEventListener('pointerdown', (ev) => {
      ev.preventDefault(); // keep focus so blur doesn't close first
      applyPlace(item);
    });
    els.results.appendChild(li);
  });
  els.results.hidden = false;
  els.search.setAttribute('aria-expanded', 'true');
}

function localMatches(q) {
  const needle = q.trim().toLowerCase();
  return CITIES
    .filter((c) => !needle || c.name.toLowerCase().includes(needle))
    .slice(0, 8)
    .map((c) => ({ name: c.name, sub: '', lat: c.lat, lon: c.lon, tzZone: c.tz }));
}

async function searchRemote(q) {
  if (searchAbort) searchAbort.abort();
  searchAbort = new AbortController();
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json`;
  const res = await fetch(url, { signal: searchAbort.signal });
  if (!res.ok) throw new Error(`geocoding ${res.status}`);
  const data = await res.json();
  return (data.results || []).map((r) => ({
    name: [r.name, r.admin1].filter(Boolean).join(', '),
    sub: [r.country, `${r.latitude.toFixed(2)}°, ${r.longitude.toFixed(2)}°`].filter(Boolean).join(' · '),
    lat: r.latitude,
    lon: r.longitude,
    tzZone: r.timezone || null,
  }));
}

function runSearch() {
  const q = els.search.value.trim();
  if (q.length < 2) {
    showResults(localMatches(q));
    return;
  }
  searchRemote(q)
    .then((items) => {
      // merge in local presets that match, first, without duplicates
      const locals = localMatches(q).filter(
        (l) => !items.some((r) => Math.abs(r.lat - l.lat) < 0.2 && Math.abs(r.lon - l.lon) < 0.2)
      );
      showResults([...locals, ...items].slice(0, 8), 'No matches found');
    })
    .catch((err) => {
      if (err.name === 'AbortError') return;
      showResults(localMatches(q), 'No matches (offline — built-in cities only)');
    });
}

els.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 300);
});
els.search.addEventListener('focus', runSearch);
els.search.addEventListener('blur', () => setTimeout(closeResults, 150));
els.search.addEventListener('keydown', (ev) => {
  if (els.results.hidden && (ev.key === 'ArrowDown' || ev.key === 'Enter')) {
    runSearch();
    return;
  }
  if (ev.key === 'Escape') { closeResults(); return; }
  if (ev.key === 'Enter' && searchIdx < 0 && searchItems.length) {
    ev.preventDefault();
    applyPlace(searchItems[0]);
    return;
  }
  if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp' && ev.key !== 'Enter') return;
  ev.preventDefault();
  if (ev.key === 'Enter') {
    if (searchIdx >= 0 && searchItems[searchIdx]) applyPlace(searchItems[searchIdx]);
    return;
  }
  const n = searchItems.length;
  if (!n) return;
  searchIdx = ev.key === 'ArrowDown'
    ? (searchIdx + 1) % n
    : (searchIdx - 1 + n) % n;
  [...els.results.children].forEach((li, i) =>
    li.setAttribute('aria-selected', i === searchIdx ? 'true' : 'false'));
});

function onCoordEdit() {
  const lat = parseFloat(els.lat.value);
  const lon = parseFloat(els.lon.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  state.lat = Math.max(-90, Math.min(90, lat));
  state.lon = Math.max(-180, Math.min(180, lon));
  state.placeLabel = '';
  els.search.value = '';
  state.tzZone = null;
  const est = Math.round(state.lon / 15);
  if (est !== Math.round(state.tz)) {
    note(`Tip: solar-time UTC offset for longitude ${state.lon.toFixed(1)}° is about ${est >= 0 ? '+' : ''}${est} h — adjust the UTC offset if this place is in a different time zone.`);
  } else {
    note('');
  }
  scheduleWeather();
  render();
  persist();
}
els.lat.addEventListener('change', onCoordEdit);
els.lon.addEventListener('change', onCoordEdit);

els.tz.addEventListener('change', () => {
  const tz = parseFloat(els.tz.value);
  if (!Number.isFinite(tz)) return;
  state.tz = Math.max(-12, Math.min(14, tz));
  state.tzZone = null;
  render();
  persist();
});

els.date.addEventListener('change', () => {
  const [y, m, d] = els.date.value.split('-').map(Number);
  if (!y || !m || !d) return;
  state.date = { year: y, month: m, day: d };
  if (state.tzZone) {
    state.tz = zoneOffsetHours(state.tzZone, selectedDateAsUTC());
    els.tz.value = state.tz;
  }
  scheduleWeather();
  render();
});

els.slider.addEventListener('input', () => {
  state.minutes = parseInt(els.slider.value, 10);
  renderTimeOnly();
});

els.nowBtn.addEventListener('click', () => {
  if (state.tzZone) state.tz = zoneOffsetHours(state.tzZone, new Date());
  const { date, minutes } = nowInOffset(state.tz);
  state.date = date;
  state.minutes = minutes;
  syncControls();
  scheduleWeather();
  render();
});

els.geoBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    note('Geolocation is not available in this browser — enter coordinates manually.');
    return;
  }
  note('Locating…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.lat = +pos.coords.latitude.toFixed(4);
      state.lon = +pos.coords.longitude.toFixed(4);
      state.tzZone = browserZone;
      if (browserZone) state.tz = zoneOffsetHours(browserZone, selectedDateAsUTC());
      state.placeLabel = 'My location';
      els.search.value = 'My location';
      note(`Using your location: ${state.lat}°, ${state.lon}°.`);
      syncControls();
      scheduleWeather();
      render();
      persist();
    },
    (err) => note(`Couldn't get your location (${err.message}) — enter coordinates manually.`),
    { timeout: 10000 }
  );
});

let liveTimer = null;
els.liveToggle.addEventListener('change', () => {
  state.live = els.liveToggle.checked;
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  if (state.live) {
    els.nowBtn.click();
    liveTimer = setInterval(() => els.nowBtn.click(), 30000);
  }
});

els.compareToggle.addEventListener('click', () => {
  state.compare = !state.compare;
  if (state.compare && !state.dateB) state.dateB = sixMonthsFrom(state.date);
  syncControls();
  render();
  persist();
});

els.dateB.addEventListener('change', () => {
  const [y, m, d] = els.dateB.value.split('-').map(Number);
  if (!y || !m || !d) return;
  state.dateB = { year: y, month: m, day: d };
  render();
});

els.themeToggle.addEventListener('click', () => {
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const current = root.dataset.theme || (prefersDark ? 'dark' : 'light');
  root.dataset.theme = current === 'dark' ? 'light' : 'dark';
  render(); // markers/rings read the surface color at draw time in some browsers
  persist();
});

els.linkBtn.addEventListener('click', async () => {
  writeUrl();                                   // flush any pending debounce
  const url = window.location.href;
  const done = (msg) => {
    const original = els.linkBtn.textContent;
    els.linkBtn.textContent = msg;
    setTimeout(() => { els.linkBtn.textContent = original; }, 1800);
  };
  try {
    await navigator.clipboard.writeText(url);
    done('✓ Copied');
  } catch {
    // Clipboard blocked (insecure origin, permissions) — show it instead.
    note(`Copy this link: ${url}`);
    done('Link shown below');
  }
});

els.scenicToggle.addEventListener('click', () => {
  state.scenic = !state.scenic;
  render();
  persist();
});

/* ---------- boot ---------- */

const badge = $('version-badge');
badge.textContent = `v${VERSION}`;
badge.title = `Solar Tracker v${VERSION} — built ${BUILD_DATE}`;
window.SOLAR_TRACKER_VERSION = { version: VERSION, buildDate: BUILD_DATE };

syncControls();
render();
scheduleWeather();
