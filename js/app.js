import {
  sunPosition,
  dayInfo,
  clearSkyIrradiance,
  dailyInsolation,
  airMass,
  compassPoint,
  daysInMonth,
} from './solar.js';
import { renderLineChart, renderSkyDome } from './charts.js';

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
};

/* ---------- element handles ---------- */

const $ = (id) => document.getElementById(id);
const els = {
  city: $('city-select'), lat: $('lat-input'), lon: $('lon-input'), tz: $('tz-input'),
  date: $('date-input'), slider: $('time-slider'), timeDisplay: $('time-display'),
  geoBtn: $('geo-btn'), nowBtn: $('now-btn'), liveToggle: $('live-toggle'),
  geoStatus: $('geo-status'), themeToggle: $('theme-toggle'),
  explain: $('explain'), dayChartSub: $('day-chart-sub'),
};

for (const c of CITIES) {
  const opt = document.createElement('option');
  opt.value = c.name;
  opt.textContent = c.name;
  els.city.appendChild(opt);
}

/* ---------- computation for one render ---------- */

function sampleDay(date, stepMin = 5) {
  const out = [];
  for (let m = 0; m <= 1440; m += stepMin) {
    out.push({ m, pos: sunPosition(state.lat, state.lon, date, Math.min(m, 1439.999), state.tz) });
  }
  return out;
}

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

  return {
    now, today, daySamples, junSamples, decSamples, yearNoon, yearDayLen,
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
  return {
    paths: [
      { name: 'Selected day', colorVar: '--series-1', points: toPath(model.daySamples) },
      { name: 'Jun 21 solstice', colorVar: '--series-2', points: toPath(model.junSamples), dash: '4 4' },
      { name: 'Dec 21 solstice', colorVar: '--series-3', points: toPath(model.decSamples), dash: '4 4' },
    ],
    sun: { azimuth: model.now.azimuth, elevation: model.now.apparentElevation },
    hourMarks,
  };
}

function dayChartConfig(model) {
  const toSeries = (samples) => samples.map((s) => ({ x: s.m, y: s.pos.apparentElevation }));
  const all = [model.daySamples, model.junSamples, model.decSamples];
  const yMax = Math.min(90, Math.ceil((Math.max(...all.flat().map((s) => s.pos.apparentElevation)) + 6) / 10) * 10);
  return {
    ariaLabel: 'Sun elevation through the day',
    series: [
      { name: 'Selected day', colorVar: '--series-1', points: toSeries(model.daySamples), area: true },
      { name: 'Jun 21 solstice', colorVar: '--series-2', points: toSeries(model.junSamples), dash: '4 4' },
      { name: 'Dec 21 solstice', colorVar: '--series-3', points: toSeries(model.decSamples), dash: '4 4' },
    ],
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

function irrConfig(model) {
  const points = model.daySamples.map((s) => ({
    x: s.m,
    y: clearSkyIrradiance(s.pos.apparentElevation).ghi,
  }));
  const yMax = Math.max(200, Math.ceil(Math.max(...points.map((p) => p.y)) / 100) * 100);
  return {
    ariaLabel: 'Clear-sky solar irradiance through the day',
    series: [{ name: 'Clear-sky GHI', colorVar: '--series-1', points, area: true }],
    xDomain: [0, 1440],
    yDomain: [0, yMax],
    xTicks: HOUR_TICKS,
    yLabel: 'W/m²',
    formatX: fmtClock,
    formatY: (y) => `${Math.round(y)} W/m²`,
    markers: [{
      x: state.minutes,
      y: clearSkyIrradiance(model.now.apparentElevation).ghi,
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

function syncControls() {
  els.lat.value = state.lat;
  els.lon.value = state.lon;
  els.tz.value = state.tz;
  els.date.value = `${state.date.year}-${pad2(state.date.month)}-${pad2(state.date.day)}`;
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
}

/* ---------- events ---------- */

function note(msg) {
  els.geoStatus.textContent = msg;
  els.geoStatus.hidden = !msg;
}

function selectedDateAsUTC() {
  return new Date(Date.UTC(state.date.year, state.date.month - 1, state.date.day, 12));
}

els.city.addEventListener('change', () => {
  const c = CITIES.find((x) => x.name === els.city.value);
  if (!c) return;
  state.lat = c.lat;
  state.lon = c.lon;
  state.tzZone = c.tz;
  state.tz = zoneOffsetHours(c.tz, selectedDateAsUTC());
  note('');
  syncControls();
  render();
});

function onCoordEdit() {
  const lat = parseFloat(els.lat.value);
  const lon = parseFloat(els.lon.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  state.lat = Math.max(-90, Math.min(90, lat));
  state.lon = Math.max(-180, Math.min(180, lon));
  els.city.value = '';
  state.tzZone = null;
  const est = Math.round(state.lon / 15);
  if (est !== Math.round(state.tz)) {
    note(`Tip: solar-time UTC offset for longitude ${state.lon.toFixed(1)}° is about ${est >= 0 ? '+' : ''}${est} h — adjust the UTC offset if this place is in a different time zone.`);
  } else {
    note('');
  }
  render();
}
els.lat.addEventListener('change', onCoordEdit);
els.lon.addEventListener('change', onCoordEdit);

els.tz.addEventListener('change', () => {
  const tz = parseFloat(els.tz.value);
  if (!Number.isFinite(tz)) return;
  state.tz = Math.max(-12, Math.min(14, tz));
  state.tzZone = null;
  render();
});

els.date.addEventListener('change', () => {
  const [y, m, d] = els.date.value.split('-').map(Number);
  if (!y || !m || !d) return;
  state.date = { year: y, month: m, day: d };
  if (state.tzZone) {
    state.tz = zoneOffsetHours(state.tzZone, selectedDateAsUTC());
    els.tz.value = state.tz;
  }
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
      els.city.value = '';
      note(`Using your location: ${state.lat}°, ${state.lon}°.`);
      syncControls();
      render();
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

els.themeToggle.addEventListener('click', () => {
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const current = root.dataset.theme || (prefersDark ? 'dark' : 'light');
  root.dataset.theme = current === 'dark' ? 'light' : 'dark';
  render(); // markers/rings read the surface color at draw time in some browsers
});

/* ---------- boot ---------- */

syncControls();
render();
