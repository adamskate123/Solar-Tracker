import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cosAOI, poaIrradiance, horizonAt, isBlocked, skyViewFactor, flatHorizon,
  sunSamples, annualPOA, optimizeOrientation, DEFAULT_ALBEDO,
} from '../js/panel.js';
import { clearSkyIrradiance } from '../js/solar.js';

const close = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} +/- ${tol}`);

test('a horizontal panel sees the solar zenith angle', () => {
  for (const elev of [10, 35, 60, 89]) {
    close(cosAOI(elev, 137, 0, 180), Math.cos((90 - elev) * Math.PI / 180), 1e-12,
      `tilt 0 at elevation ${elev}`);
  }
});

test('a panel aimed straight at the sun has an incidence angle of zero', () => {
  // Sun 40 degrees up in the south-west; tilt the panel by the complement and
  // point it the same way, and the normal lines up exactly.
  close(cosAOI(40, 225, 50, 225), 1, 1e-12, 'panel normal on the sun');
  // Facing directly away is the worst case.
  close(cosAOI(40, 225, 50, 45), Math.cos(100 * Math.PI / 180), 1e-12, 'facing away');
});

test('a horizontal plane receives exactly the global horizontal irradiance', () => {
  for (const elev of [8, 25, 55, 80]) {
    const irr = clearSkyIrradiance(elev);
    const poa = poaIrradiance({
      dni: irr.dni, dhi: irr.diffuse, ghi: irr.ghi,
      sunElevation: elev, sunAzimuth: 200, tilt: 0, panelAzimuth: 180,
    });
    close(poa.total, irr.ghi, 1e-9, `tilt 0 at elevation ${elev}`);
    assert.equal(poa.ground, 0, 'a flat panel sees no ground reflection');
  }
});

test('night produces nothing whatever the orientation', () => {
  const poa = poaIrradiance({
    dni: 0, dhi: 0, ghi: 0, sunElevation: -3, sunAzimuth: 90,
    tilt: 35, panelAzimuth: 180,
  });
  assert.deepEqual(poa, { beam: 0, sky: 0, ground: 0, total: 0 });
});

test('ground reflection grows with tilt and with albedo', () => {
  const base = { dni: 800, dhi: 90, ghi: 700, sunElevation: 45, sunAzimuth: 180, panelAzimuth: 180 };
  const flat = poaIrradiance({ ...base, tilt: 0 });
  const steep = poaIrradiance({ ...base, tilt: 60 });
  const snow = poaIrradiance({ ...base, tilt: 60, albedo: 0.8 });
  assert.equal(flat.ground, 0);
  assert.ok(steep.ground > 0, 'a tilted panel sees some ground');
  assert.ok(snow.ground > steep.ground, 'snow reflects more than grass');
});

test('horizon elevation interpolates between sectors', () => {
  const profile = flatHorizon();
  profile[0] = 10;   // due north
  profile[1] = 20;   // 30 degrees
  close(horizonAt(profile, 0), 10, 1e-12, 'on a sector');
  close(horizonAt(profile, 30), 20, 1e-12, 'on the next sector');
  close(horizonAt(profile, 15), 15, 1e-12, 'halfway between');
  close(horizonAt(profile, 360), 10, 1e-12, 'wraps around');
  assert.equal(horizonAt(null, 123), 0, 'no profile means no obstruction');
});

test('the sun is blocked only when it sits below the terrain', () => {
  const profile = flatHorizon();
  profile[6] = 15;   // a ridge due south
  assert.ok(isBlocked(profile, 10, 180), 'low sun behind the ridge');
  assert.ok(!isBlocked(profile, 20, 180), 'above the ridge');
  assert.ok(!isBlocked(profile, 10, 0), 'clear to the north');
});

test('sky view factor runs from a full sky to none', () => {
  close(skyViewFactor(flatHorizon()), 1, 1e-12, 'flat horizon sees the whole sky');
  close(skyViewFactor(new Array(12).fill(90)), 0, 1e-12, 'walled in on every side');
  const half = skyViewFactor(new Array(12).fill(45));
  close(half, 0.5, 1e-12, '45 degrees all round blocks half the cosine-weighted sky');
  assert.equal(skyViewFactor(null), 1);
});

test('terrain removes the beam but leaves diffuse behind', () => {
  const ridge = flatHorizon();
  ridge[6] = 25;
  const base = {
    dni: 700, dhi: 120, ghi: 600, sunElevation: 15, sunAzimuth: 180,
    tilt: 30, panelAzimuth: 180,
  };
  const open = poaIrradiance(base);
  const shaded = poaIrradiance({ ...base, horizon: ridge });
  assert.ok(open.beam > 0 && shaded.beam === 0, 'beam is cut');
  assert.ok(shaded.sky > 0, 'diffuse still arrives');
  assert.ok(shaded.total < open.total, 'and the total drops');
});

/* ---------- annual behaviour ---------- */

const NYC = { lat: 40.71, lon: -74.01, tz: -5 };
const nycSamples = sunSamples(NYC.lat, NYC.lon, NYC.tz, { dayStep: 6, minuteStep: 60 });

test('sun samples cover daylight only, with sane totals', () => {
  assert.ok(nycSamples.length > 500, `got ${nycSamples.length} samples`);
  assert.ok(nycSamples.every((s) => s.elevation > 0), 'no night samples');
  const horizontal = annualPOA(nycSamples, { tilt: 0, panelAzimuth: 180 });
  assert.ok(horizontal > 1500 && horizontal < 2600,
    `annual clear-sky GHI at 40N should be roughly 2000 kWh/m2, got ${horizontal}`);
});

test('tilting toward the equator beats lying flat', () => {
  const flat = annualPOA(nycSamples, { tilt: 0, panelAzimuth: 180 });
  const tilted = annualPOA(nycSamples, { tilt: 35, panelAzimuth: 180 });
  const backwards = annualPOA(nycSamples, { tilt: 35, panelAzimuth: 0 });
  assert.ok(tilted > flat, 'tilted south beats horizontal');
  assert.ok(backwards < flat, 'tilted north is worse than horizontal');
});

test('the optimum lands near the latitude, facing the equator', () => {
  const best = optimizeOrientation(nycSamples);
  close(best.azimuth, 180, 10, 'northern hemisphere faces south');
  assert.ok(Math.abs(best.tilt - NYC.lat) < 12,
    `optimal tilt ${best.tilt} should be within ~10 degrees of latitude ${NYC.lat}`);
  assert.ok(best.annual > annualPOA(nycSamples, { tilt: 0, panelAzimuth: 180 }),
    'the optimum beats horizontal');
  assert.ok(best.curve.length > 10 && best.curve.every((p) => p.y >= 0), 'a tilt curve comes back');
});

test('the southern hemisphere faces north instead', () => {
  const sydney = sunSamples(-33.87, 151.21, 10, { dayStep: 10, minuteStep: 60 });
  const best = optimizeOrientation(sydney);
  const northish = Math.min(best.azimuth, 360 - best.azimuth);   // distance from due north
  assert.ok(northish < 15, `expected an equator-facing panel, got azimuth ${best.azimuth}`);
});

test('near the equator the best panel is nearly flat', () => {
  const quito = sunSamples(-0.18, -78.47, -5, { dayStep: 10, minuteStep: 60 });
  const best = optimizeOrientation(quito);
  assert.ok(best.tilt < 12, `expected a shallow tilt on the equator, got ${best.tilt}`);
});

test('a ridge costs energy and pushes the optimum away from it', () => {
  const open = optimizeOrientation(nycSamples);
  // A tall obstruction filling the south-western sky.
  const ridge = flatHorizon();
  ridge[6] = 35;  // south
  ridge[7] = 40;  // south-west
  ridge[8] = 35;  // west
  const shaded = optimizeOrientation(nycSamples, { horizon: ridge });
  assert.ok(shaded.annual < open.annual, 'blocked sky yields less');
  assert.ok(shaded.azimuth < open.azimuth,
    `optimum should swing east of south away from the ridge, got ${shaded.azimuth}`);
});
