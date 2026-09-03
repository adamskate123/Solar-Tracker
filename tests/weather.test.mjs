import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeWeather, cloudAttenuation, endpointFor, dayOffset, extractDay, summarize,
} from '../js/weather.js';

const TODAY = { year: 2026, month: 9, day: 2 };

/** A minimal Open-Meteo-shaped response for one day. */
function fakeResponse(dateStr, { ghi = true } = {}) {
  const time = [];
  const cloud = [];
  const temp = [];
  const rad = [];
  const precip = [];
  for (let h = 0; h < 24; h++) {
    time.push(`${dateStr}T${String(h).padStart(2, '0')}:00`);
    cloud.push(h < 12 ? 20 : 80);
    temp.push(10 + h * 0.5);
    // A crude daylight bump, zero at night.
    rad.push(h >= 6 && h <= 18 ? Math.round(700 * Math.sin(((h - 6) / 12) * Math.PI)) : 0);
    precip.push(h === 15 ? 2.5 : 0);
  }
  return {
    hourly: {
      time,
      temperature_2m: temp,
      apparent_temperature: temp,
      relative_humidity_2m: temp.map(() => 60),
      cloud_cover: cloud,
      precipitation: precip,
      weather_code: temp.map(() => 3),
      wind_speed_10m: temp.map(() => 12),
      ...(ghi ? { shortwave_radiation: rad } : {}),
    },
    daily: {
      time: [dateStr],
      weather_code: [61],
      temperature_2m_max: [22],
      temperature_2m_min: [11],
      precipitation_sum: [2.5],
      sunshine_duration: [18000],
    },
  };
}

test('WMO codes map to a label, icon and group', () => {
  assert.equal(describeWeather(0).group, 'clear');
  assert.equal(describeWeather(3).label, 'Overcast');
  assert.equal(describeWeather(65).group, 'rain');
  assert.equal(describeWeather(75).group, 'snow');
  assert.equal(describeWeather(95).group, 'storm');
  // An unknown code must still render something rather than crashing.
  assert.ok(describeWeather(1234).label);
});

test('cloud attenuation follows Kasten-Czeplak', () => {
  assert.equal(cloudAttenuation(0), 1);
  assert.ok(Math.abs(cloudAttenuation(100) - 0.25) < 1e-9, 'overcast passes a quarter');
  assert.ok(cloudAttenuation(50) > cloudAttenuation(90), 'monotonically decreasing');
  // Clamps rather than returning nonsense for out-of-range input.
  assert.equal(cloudAttenuation(-10), 1);
  assert.equal(cloudAttenuation(140), cloudAttenuation(100));
});

test('day offsets are whole days across month ends', () => {
  assert.equal(dayOffset(TODAY, TODAY), 0);
  assert.equal(dayOffset({ year: 2026, month: 9, day: 12 }, TODAY), 10);
  assert.equal(dayOffset({ year: 2026, month: 8, day: 31 }, TODAY), -2);
  assert.equal(dayOffset({ year: 2027, month: 9, day: 2 }, TODAY), 365);
});

test('endpoint choice matches each date range', () => {
  assert.equal(endpointFor(TODAY, TODAY).kind, 'forecast');
  assert.equal(endpointFor({ year: 2026, month: 9, day: 17 }, TODAY).kind, 'forecast', 'the last day the model returns');
  assert.equal(endpointFor({ year: 2026, month: 9, day: 18 }, TODAY), null, 'one day beyond the horizon');
  assert.equal(endpointFor({ year: 2026, month: 7, day: 1 }, TODAY).kind, 'forecast', 'recent past');
  assert.equal(endpointFor({ year: 2010, month: 3, day: 4 }, TODAY).kind, 'archive');
  assert.equal(endpointFor({ year: 1912, month: 4, day: 15 }, TODAY), null, 'before the archive begins');
});

test('archive requests pin the single day they are for', () => {
  const ep = endpointFor({ year: 2010, month: 3, day: 4 }, TODAY);
  assert.match(ep.url, /start_date=2010-03-04/);
  assert.match(ep.url, /end_date=2010-03-04/);
});

test('extractDay pulls out only the requested local day', () => {
  const json = fakeResponse('2026-09-02');
  // Another day in the same payload must not leak in.
  json.hourly.time.push('2026-09-03T00:00');
  json.hourly.temperature_2m.push(99);
  const day = extractDay(json, TODAY);
  assert.equal(day.hours.length, 24);
  assert.equal(day.hours[0].minutes, 0);
  assert.equal(day.hours[23].minutes, 23 * 60);
  assert.ok(!day.hours.some((h) => h.temp === 99), 'no bleed from the next day');
  assert.equal(day.daily.tempMax, 22);
  assert.equal(day.daily.sunshineHours, 5);
});

test('extractDay returns null when the day is absent or the payload is empty', () => {
  assert.equal(extractDay(fakeResponse('2026-09-02'), { year: 2026, month: 9, day: 9 }), null);
  assert.equal(extractDay({}, TODAY), null);
  assert.equal(extractDay(null, TODAY), null);
});

test('summarize reports the nearest hour and the day totals', () => {
  const day = extractDay(fakeResponse('2026-09-02'), TODAY);
  const mid = summarize(day, 14 * 60 + 20);
  assert.equal(mid.at.minutes, 14 * 60, 'snaps to the nearest hour');
  assert.equal(mid.at.cloud, 80);
  assert.equal(mid.condition.group, 'rain', 'daily code wins over the hourly one');
  assert.equal(mid.cloudMean, 50, 'half the day at 20%, half at 80%');
  assert.equal(mid.precipTotal, 2.5);
  assert.ok(mid.hasRadiation);
  // Hourly W/m^2 summed over the day is Wh/m^2, reported as kWh/m^2.
  assert.ok(mid.actualKWh > 4 && mid.actualKWh < 6, `got ${mid.actualKWh}`);
});

test('summarize copes with a provider that returns no radiation', () => {
  const day = extractDay(fakeResponse('2026-09-02', { ghi: false }), TODAY);
  const sum = summarize(day, 12 * 60);
  assert.equal(sum.actualKWh, null);
  assert.equal(sum.hasRadiation, false);
  assert.equal(sum.cloudMean, 50, 'the rest of the summary still works');
});
