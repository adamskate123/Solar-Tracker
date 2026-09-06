import test from 'node:test';
import assert from 'node:assert/strict';
import {
  julianDay,
  sunPosition,
  dayInfo,
  airMass,
  clearSkyIrradiance,
  dailyInsolation,
  compassPoint,
  elevationTimes,
  dayLightPhases,
  UVB_ELEVATION,
} from '../js/solar.js';

const close = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} +/- ${tol}`);

test('julian day matches known epochs', () => {
  close(julianDay(2000, 1, 1.5), 2451545.0, 1e-6, 'J2000.0');
  close(julianDay(1987, 6, 19.5), 2446966.0, 1e-6, 'Meeus example 7.b');
});

test('declination peaks near +23.44 deg at June solstice', () => {
  const { declination } = dayInfo(40, -105, { year: 2026, month: 6, day: 21 }, -6);
  close(declination, 23.44, 0.05, 'June solstice declination');
});

test('declination near -23.44 deg at December solstice', () => {
  const { declination } = dayInfo(40, -105, { year: 2026, month: 12, day: 21 }, -7);
  close(declination, -23.44, 0.05, 'December solstice declination');
});

test('declination near 0 at March equinox', () => {
  const { declination } = dayInfo(0, 0, { year: 2026, month: 3, day: 20 }, 0);
  close(declination, 0, 0.5, 'equinox declination');
});

test('noon elevation equals 90 - |lat - dec|', () => {
  const lat = 51.5;
  const info = dayInfo(lat, -0.13, { year: 2026, month: 7, day: 13 }, 1);
  const pos = sunPosition(lat, -0.13, { year: 2026, month: 7, day: 13 }, info.solarNoon, 1);
  close(pos.elevation, 90 - Math.abs(lat - info.declination), 0.05, 'noon elevation identity');
});

test('equinox day length is ~12h everywhere sun rises', () => {
  for (const lat of [-45, 0, 30, 60]) {
    const info = dayInfo(lat, 0, { year: 2026, month: 3, day: 20 }, 0);
    close(info.dayLength / 60, 12, 0.35, `day length at lat ${lat}`);
  }
});

test('polar night above the arctic circle in December', () => {
  const info = dayInfo(78, 15, { year: 2026, month: 12, day: 21 }, 1);
  assert.equal(info.polar, 'night');
  assert.equal(info.sunrise, null);
  assert.equal(info.dayLength, 0);
});

test('midnight sun above the arctic circle in June', () => {
  const info = dayInfo(78, 15, { year: 2026, month: 6, day: 21 }, 2);
  assert.equal(info.polar, 'day');
  assert.equal(info.dayLength, 1440);
});

test('sun is east of south in the morning, west in the afternoon (N hemisphere)', () => {
  const date = { year: 2026, month: 7, day: 13 };
  const am = sunPosition(40, -105, date, 9 * 60, -6);
  const pm = sunPosition(40, -105, date, 16 * 60, -6);
  assert.ok(am.azimuth > 0 && am.azimuth < 180, `morning azimuth east: ${am.azimuth}`);
  assert.ok(pm.azimuth > 180 && pm.azimuth < 360, `afternoon azimuth west: ${pm.azimuth}`);
});

test('NREL SPA benchmark: Golden CO, 2003-10-17 12:30:30 MST', () => {
  // NREL SPA reference case: lat 39.742476, lon -105.1786, UTC-7 gives
  // topocentric zenith 50.11162 deg, azimuth 194.34024 deg. The NOAA
  // algorithm plus standard refraction should land within ~0.1 deg.
  const pos = sunPosition(
    39.742476, -105.1786,
    { year: 2003, month: 10, day: 17 },
    12 * 60 + 30.5, -7
  );
  close(pos.apparentElevation, 90 - 50.11162, 0.1, 'SPA elevation');
  close(pos.azimuth, 194.34024, 0.1, 'SPA azimuth');
});

test('air mass is 1 overhead and grows toward the horizon', () => {
  close(airMass(90), 1, 0.001, 'AM at zenith');
  close(airMass(30), 2, 0.05, 'AM at 30 deg');
  assert.ok(airMass(2) > 15, 'AM large near horizon');
  assert.equal(airMass(-1), Infinity);
});

test('clear-sky irradiance is sane', () => {
  const overhead = clearSkyIrradiance(90);
  assert.ok(overhead.ghi > 950 && overhead.ghi < 1200, `overhead GHI ${overhead.ghi}`);
  const low = clearSkyIrradiance(5);
  assert.ok(low.ghi < overhead.ghi / 4, 'low sun much weaker');
  assert.deepEqual(clearSkyIrradiance(-5), { dni: 0, diffuse: 0, ghi: 0 });
});

test('daily insolation: mid-latitude summer beats winter ~3x or more', () => {
  const summer = dailyInsolation(47, 8, { year: 2026, month: 6, day: 21 }, 2);
  const winter = dailyInsolation(47, 8, { year: 2026, month: 12, day: 21 }, 1);
  assert.ok(summer > 7 && summer < 12, `summer kWh/m2 ${summer}`);
  assert.ok(winter > 0.5 && winter < 4, `winter kWh/m2 ${winter}`);
  assert.ok(summer / winter > 3, 'seasonal ratio');
});

test('compass points', () => {
  assert.equal(compassPoint(0), 'N');
  assert.equal(compassPoint(180), 'S');
  assert.equal(compassPoint(359), 'N');
  assert.equal(compassPoint(157.5), 'SSE');
});

test('the generalised elevation solver reproduces sunrise and sunset exactly', () => {
  const lat = 40.71;
  const lon = -74.01;
  const date = { year: 2026, month: 6, day: 21 };
  const info = dayInfo(lat, lon, date, -4);
  const crossing = elevationTimes(lat, lon, date, -4, -0.833);
  close(crossing.morning, info.sunrise, 1e-9, 'sunrise');
  close(crossing.evening, info.sunset, 1e-9, 'sunset');
});

test('twilight thresholds come in the right order', () => {
  const lat = 51.5;
  const lon = -0.13;
  const date = { year: 2026, month: 3, day: 20 };
  const at = (e) => elevationTimes(lat, lon, date, 0, e);
  const astro = at(-18).morning;
  const naut = at(-12).morning;
  const civil = at(-6).morning;
  const rise = at(-0.833).morning;
  const golden = at(6).morning;
  assert.ok(astro < naut && naut < civil && civil < rise && rise < golden,
    `expected increasing: ${[astro, naut, civil, rise, golden]}`);
  // And the evening mirrors it about solar noon.
  const noon = dayInfo(lat, lon, date, 0).solarNoon;
  close(noon - astro, at(-18).evening - noon, 1e-9, 'symmetry about solar noon');
});

test('the solver reports polar cases instead of returning nonsense', () => {
  // Midsummer above the arctic circle: never dark enough for any twilight.
  assert.equal(elevationTimes(78.2, 15.6, { year: 2026, month: 6, day: 21 }, 2, -6).state, 'always-above');
  // Midwinter: never bright enough to reach the UV-B threshold.
  assert.equal(elevationTimes(78.2, 15.6, { year: 2026, month: 12, day: 21 }, 1, 30).state, 'never-reaches');
  const polar = elevationTimes(78.2, 15.6, { year: 2026, month: 12, day: 21 }, 1, 30);
  assert.equal(polar.morning, null);
  assert.equal(polar.evening, null);
});

test('the UV-B window sits inside the daylight window', () => {
  const lat = 40.71;
  const lon = -74.01;
  const date = { year: 2026, month: 6, day: 21 };
  const info = dayInfo(lat, lon, date, -4);
  const uvb = elevationTimes(lat, lon, date, -4, UVB_ELEVATION);
  assert.equal(uvb.state, 'crosses');
  assert.ok(uvb.morning > info.sunrise, 'starts after sunrise');
  assert.ok(uvb.evening < info.sunset, 'ends before sunset');
});

test('no UV-B window in a northern midwinter, but one in midsummer', () => {
  const lat = 45;
  const winter = elevationTimes(lat, 0, { year: 2026, month: 12, day: 21 }, 0, UVB_ELEVATION);
  const summer = elevationTimes(lat, 0, { year: 2026, month: 6, day: 21 }, 0, UVB_ELEVATION);
  assert.equal(winter.state, 'never-reaches', 'noon sun at 45N in December is only ~21 degrees');
  assert.equal(summer.state, 'crosses');
});

test('dayLightPhases returns every named phase', () => {
  const phases = dayLightPhases(40.71, -74.01, { year: 2026, month: 9, day: 21 }, -4);
  for (const key of ['astronomical', 'nautical', 'civil', 'blue', 'sunrise', 'golden', 'uvb']) {
    assert.ok(phases[key], `missing ${key}`);
    assert.ok(['crosses', 'always-above', 'never-reaches'].includes(phases[key].state));
  }
});
