import test from 'node:test';
import assert from 'node:assert/strict';
import { skyColors, seasonFor, smoothstep } from '../js/scene.js';

test('smoothstep clamps and interpolates', () => {
  assert.equal(smoothstep(0, 10, -5), 0);
  assert.equal(smoothstep(0, 10, 15), 1);
  assert.equal(smoothstep(0, 10, 5), 0.5);
});

test('sky is dark at night, bright at midday', () => {
  const night = skyColors(-20);
  const noon = skyColors(60);
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255);
  };
  assert.ok(lum(night.top) < 100, `night top ${night.top}`);
  assert.ok(lum(noon.top) > 350, `noon top ${noon.top}`);
});

test('twilight horizon is warmer (more red) than midday horizon', () => {
  const red = (hex) => parseInt(hex.slice(1, 3), 16);
  const blue = (hex) => parseInt(hex.slice(5, 7), 16);
  const dusk = skyColors(1);
  assert.ok(red(dusk.horizon) > blue(dusk.horizon), `dusk horizon ${dusk.horizon}`);
});

test('seasons flip across the equator and tropics are their own zone', () => {
  assert.equal(seasonFor(7, 45), 'summer');
  assert.equal(seasonFor(7, -45), 'winter');
  assert.equal(seasonFor(1, 45), 'winter');
  assert.equal(seasonFor(1, -45), 'summer');
  assert.equal(seasonFor(10, 45), 'autumn');
  assert.equal(seasonFor(10, -45), 'spring');
  assert.equal(seasonFor(7, 5), 'tropical');
});
