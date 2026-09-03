/**
 * Weather for the selected place and date, from the Open-Meteo API (free, no
 * key). Two endpoints share one response shape: the forecast model covers a
 * window around today, and the ERA5 archive covers everything back to 1940.
 *
 * The point of weather here is not a widget bolted on the side: every
 * radiation figure the app computes is a *clear-sky* ceiling, and weather is
 * what turns that ceiling into an actual. So the important number is the gap
 * between the clear-sky curve and the real one.
 *
 * Pure functions only, apart from `fetchWeather`; the rest runs under node.
 */

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';

const HOURLY = [
  'temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
  'cloud_cover', 'precipitation', 'weather_code', 'wind_speed_10m',
  'shortwave_radiation',
].join(',');
const DAILY = [
  'weather_code', 'temperature_2m_max', 'temperature_2m_min',
  'precipitation_sum', 'sunshine_duration',
].join(',');

/** WMO weather interpretation codes. */
const WMO = [
  [[0], '☀️', 'Clear sky', 'clear'],
  [[1], '🌤️', 'Mainly clear', 'clear'],
  [[2], '⛅', 'Partly cloudy', 'cloud'],
  [[3], '☁️', 'Overcast', 'cloud'],
  [[45, 48], '🌫️', 'Fog', 'fog'],
  [[51, 53, 55], '🌦️', 'Drizzle', 'rain'],
  [[56, 57], '🌧️', 'Freezing drizzle', 'rain'],
  [[61, 63, 65], '🌧️', 'Rain', 'rain'],
  [[66, 67], '🌧️', 'Freezing rain', 'rain'],
  [[71, 73, 75], '🌨️', 'Snow', 'snow'],
  [[77], '🌨️', 'Snow grains', 'snow'],
  [[80, 81, 82], '🌦️', 'Rain showers', 'rain'],
  [[85, 86], '🌨️', 'Snow showers', 'snow'],
  [[95], '⛈️', 'Thunderstorm', 'storm'],
  [[96, 99], '⛈️', 'Thunderstorm with hail', 'storm'],
];

/** @returns {{icon:string, label:string, group:string}} for a WMO code. */
export function describeWeather(code) {
  const hit = WMO.find(([codes]) => codes.includes(code));
  if (!hit) return { icon: '🌡️', label: 'Unknown', group: 'cloud' };
  return { icon: hit[1], label: hit[2], group: hit[3] };
}

/**
 * Fraction of clear-sky global irradiance that survives a given cloud cover,
 * after Kasten & Czeplak (1980): G/G_clear = 1 - 0.75 (N/8)^3.4, with N in
 * oktas. Used when the provider returns no modelled radiation of its own.
 * @param {number} cloudPct 0-100
 */
export function cloudAttenuation(cloudPct) {
  const n = Math.max(0, Math.min(1, cloudPct / 100));
  return 1 - 0.75 * n ** 3.4;
}

const iso = (d) => `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

/** Whole days from `today` to `date` (negative = past). */
export function dayOffset(date, today) {
  const a = Date.UTC(date.year, date.month - 1, date.day);
  const b = Date.UTC(today.year, today.month - 1, today.day);
  return Math.round((a - b) / 86400000);
}

/**
 * Which endpoint (if any) covers a date.
 *
 * The forecast model runs 16 days ahead and keeps about three months of
 * recent past; older dates come from the reanalysis archive, which lags real
 * time by roughly five days. Beyond both, there is simply no data and the UI
 * says so rather than inventing a number.
 *
 * @returns {{url:string, kind:'forecast'|'archive'}|null}
 */
export function endpointFor(date, today) {
  const offset = dayOffset(date, today);
  // forecast_days=16 counts today as the first, so the last day it returns is
  // today + 15. Asking beyond that would come back without the requested day.
  if (offset > 15) return null;
  if (offset >= -90) {
    const params = new URLSearchParams({
      latitude: '0', longitude: '0', hourly: HOURLY, daily: DAILY,
      timezone: 'auto', past_days: '92', forecast_days: '16',
    });
    return { url: `${FORECAST_URL}?${params}`, kind: 'forecast' };
  }
  if (date.year < 1940) return null;
  const params = new URLSearchParams({
    latitude: '0', longitude: '0', hourly: HOURLY, daily: DAILY,
    timezone: 'auto', start_date: iso(date), end_date: iso(date),
  });
  return { url: `${ARCHIVE_URL}?${params}`, kind: 'archive' };
}

/**
 * Pull one local calendar day out of an Open-Meteo response.
 *
 * Requests use timezone=auto, so the timestamps come back in the location's
 * own local time and match the date the app is showing without conversion.
 *
 * @returns {{hours:Array, daily:object|null}|null} null if the day is absent.
 */
export function extractDay(json, date) {
  const want = iso(date);
  const h = json && json.hourly;
  if (!h || !Array.isArray(h.time)) return null;

  const hours = [];
  for (let i = 0; i < h.time.length; i++) {
    if (!String(h.time[i]).startsWith(want)) continue;
    const hh = Number(String(h.time[i]).slice(11, 13));
    hours.push({
      minutes: hh * 60,
      temp: h.temperature_2m?.[i] ?? null,
      apparent: h.apparent_temperature?.[i] ?? null,
      humidity: h.relative_humidity_2m?.[i] ?? null,
      cloud: h.cloud_cover?.[i] ?? null,
      precip: h.precipitation?.[i] ?? 0,
      wind: h.wind_speed_10m?.[i] ?? null,
      code: h.weather_code?.[i] ?? null,
      ghi: h.shortwave_radiation?.[i] ?? null,
    });
  }
  if (!hours.length) return null;

  let daily = null;
  const d = json.daily;
  if (d && Array.isArray(d.time)) {
    const i = d.time.indexOf(want);
    if (i >= 0) {
      daily = {
        code: d.weather_code?.[i] ?? null,
        tempMax: d.temperature_2m_max?.[i] ?? null,
        tempMin: d.temperature_2m_min?.[i] ?? null,
        precipSum: d.precipitation_sum?.[i] ?? null,
        sunshineHours: d.sunshine_duration?.[i] != null ? d.sunshine_duration[i] / 3600 : null,
      };
    }
  }
  return { hours, daily };
}

/** Mean of the defined values, or null when there are none. */
const mean = (xs) => {
  const v = xs.filter((n) => typeof n === 'number' && Number.isFinite(n));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/**
 * Day-level summary plus the conditions at one moment.
 * @param {{hours:Array, daily:object|null}} day
 * @param {number} minutes local minutes after midnight
 */
export function summarize(day, minutes) {
  const { hours, daily } = day;
  // Nearest hour, so scrubbing the time slider tracks the conditions.
  const at = hours.reduce((best, h) =>
    Math.abs(h.minutes - minutes) < Math.abs(best.minutes - minutes) ? h : best, hours[0]);

  const cloudMean = mean(hours.map((h) => h.cloud));
  const precipTotal = hours.reduce((a, h) => a + (h.precip || 0), 0);
  // Provider radiation is W/m^2 at each hour, so the hourly sum is Wh/m^2.
  const ghiValues = hours.map((h) => h.ghi).filter((v) => typeof v === 'number');
  const actualKWh = ghiValues.length ? ghiValues.reduce((a, b) => a + b, 0) / 1000 : null;

  const code = daily?.code ?? at.code;
  return {
    at,
    condition: describeWeather(code ?? 0),
    cloudMean,
    precipTotal: daily?.precipSum ?? precipTotal,
    tempMax: daily?.tempMax ?? null,
    tempMin: daily?.tempMin ?? null,
    sunshineHours: daily?.sunshineHours ?? null,
    actualKWh,
    hasRadiation: ghiValues.length > 0,
  };
}

/**
 * Fetch weather for a place and date. Rejects with a tagged error so the UI
 * can tell "no data for this date" apart from "the request failed".
 */
export async function fetchWeather(lat, lon, date, today, signal) {
  const ep = endpointFor(date, today);
  if (!ep) {
    const err = new Error('No weather data covers this date');
    err.code = 'OUT_OF_RANGE';
    throw err;
  }
  const url = new URL(ep.url);
  url.searchParams.set('latitude', lat.toFixed(4));
  url.searchParams.set('longitude', lon.toFixed(4));

  const res = await fetch(url, { signal });
  if (!res.ok) {
    const err = new Error(`Weather request failed (${res.status})`);
    err.code = 'HTTP';
    throw err;
  }
  const json = await res.json();
  const day = extractDay(json, date);
  if (!day) {
    const err = new Error('No weather data covers this date');
    err.code = 'OUT_OF_RANGE';
    throw err;
  }
  return { kind: ep.kind, day };
}
