import test from 'node:test';
import assert from 'node:assert/strict';
import { parallelGeometry, earthOrbitPosition, OBLIQUITY } from '../js/orbit.js';
import { dayInfo } from '../js/solar.js';

const close = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} +/- ${tol}`);

test('noon end of the parallel sits at zenith angle |lat - dec|', () => {
  for (const [lat, dec] of [[40, 23.44], [-33.9, -23.44], [0, 0], [51.5, -10]]) {
    const g = parallelGeometry(lat, dec);
    const zenithAngle = Math.atan2(g.noon.y, -g.noon.x) * (180 / Math.PI);
    close(zenithAngle, lat - dec, 1e-9, `noon zenith angle at lat ${lat}, dec ${dec}`);
    close(g.noonElevation, 90 - Math.abs(lat - dec), 1e-9, 'noon elevation');
  }
});

test('noon and midnight ends lie on the unit sphere', () => {
  const g = parallelGeometry(37.5, 12.3);
  close(Math.hypot(g.noon.x, g.noon.y), 1, 1e-12, 'noon end on the globe');
  close(Math.hypot(g.midnight.x, g.midnight.y), 1, 1e-12, 'midnight end on the globe');
});

test('the noon end is always the sunward end', () => {
  for (const lat of [-80, -40, 0, 40, 80]) {
    for (const dec of [-23.44, 0, 23.44]) {
      const g = parallelGeometry(lat, dec);
      assert.ok(g.noon.x <= g.midnight.x + 1e-12,
        `noon should be no further from the sun than midnight (lat ${lat}, dec ${dec})`);
    }
  }
});

test('lit/dark state agrees with whether the sun actually rises', () => {
  const cases = [
    [78.2, { year: 2026, month: 6, day: 21 }, 2, 'polar-day'],
    [78.2, { year: 2026, month: 12, day: 21 }, 1, 'polar-night'],
    [40.7, { year: 2026, month: 6, day: 21 }, -4, 'partial'],
    [-33.9, { year: 2026, month: 7, day: 13 }, 10, 'partial'],
  ];
  for (const [lat, date, tz, expected] of cases) {
    const info = dayInfo(lat, 0, date, tz);
    const g = parallelGeometry(lat, info.declination);
    assert.equal(g.state, expected, `state at lat ${lat} on ${date.month}/${date.day}`);
    const polar = info.polar === 'day' ? 'polar-day' : info.polar === 'night' ? 'polar-night' : 'partial';
    assert.equal(g.state, polar, 'schematic state must match the computed day length');
  }
});

test('equinox splits every latitude half lit, half dark', () => {
  const g = parallelGeometry(45, 0);
  assert.equal(g.state, 'partial');
  close(g.terminator.x, 0, 1e-12, 'terminator on the vertical diameter');
  // At dec = 0 the chord is horizontal, so the terminator is its midpoint.
  close(g.terminator.y, (g.noon.y + g.midnight.y) / 2, 1e-12, 'terminator bisects the chord');
});

test('a tropic latitude gets the sun exactly overhead at its solstice', () => {
  const g = parallelGeometry(OBLIQUITY, OBLIQUITY);
  close(g.noonElevation, 90, 1e-9, 'overhead sun at the Tropic of Cancer in June');
});

test('orbit: perihelion in early January, aphelion in early July', () => {
  const jan = earthOrbitPosition({ year: 2026, month: 1, day: 3 });
  const jul = earthOrbitPosition({ year: 2026, month: 7, day: 4 });
  close(jan.radiusAU, 0.9833, 0.0008, 'perihelion distance');
  close(jul.radiusAU, 1.0167, 0.0008, 'aphelion distance');
  assert.ok(jan.radiusAU < jul.radiusAU, 'closer to the sun in January');
  // Six months apart means roughly opposite sides of the orbit.
  const sep = Math.abs(((jul.lonDeg - jan.lonDeg) % 360 + 360) % 360 - 180);
  assert.ok(sep < 8, `six months apart should be near-opposite, off by ${sep}`);
});

test('orbit longitude advances through the year', () => {
  const mar = earthOrbitPosition({ year: 2026, month: 3, day: 20 });
  const jun = earthOrbitPosition({ year: 2026, month: 6, day: 21 });
  const step = ((jun.lonDeg - mar.lonDeg) % 360 + 360) % 360;
  close(step, 92, 3, 'about a quarter of the orbit between equinox and solstice');
});
