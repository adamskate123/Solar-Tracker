import test from 'node:test';
import assert from 'node:assert/strict';
import { skyColors, seasonFor, smoothstep, shadowFor } from '../js/scene.js';

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

test('shadow length is h/tan(elevation)', () => {
  const h = 40;
  assert.ok(Math.abs(shadowFor(45, 120, -1, h).length - h) < 1e-9, '45° sun casts a shadow as long as the object');
  assert.ok(shadowFor(90, 180, -1, h).length < 1e-6, 'overhead sun casts essentially no shadow');
  const low = shadowFor(30, 120, -1, h).length;
  assert.ok(Math.abs(low - h * Math.sqrt(3)) < 1e-6, `30° sun: got ${low}`);
});

test('very low sun is capped rather than running off the scene', () => {
  const h = 40;
  assert.equal(shadowFor(0.5, 90, -1, h, 7).length, h * 7);
});

test('shadows fall away from the sun, and flip between morning and afternoon', () => {
  // Northern hemisphere: viewer faces south, east is screen-left.
  const morning = shadowFor(30, 90, -1, 40);   // sun due east
  const afternoon = shadowFor(30, 270, -1, 40); // sun due west
  assert.ok(morning.dx > 0, 'morning sun in the east throws the shadow screen-right');
  assert.ok(afternoon.dx < 0, 'afternoon sun in the west throws the shadow screen-left');
  assert.ok(Math.abs(morning.dx + afternoon.dx) < 1e-9, 'mirrored about noon');
});

test('at solar noon the shadow falls toward the viewer instead of vanishing', () => {
  const noon = shadowFor(70, 180, -1, 40); // northern hemisphere, sun due south
  assert.ok(Math.abs(noon.dx) < 1e-9, 'no east-west component at due south');
  assert.ok(noon.dy > 0, 'shadow points north, i.e. toward a south-facing viewer');
  assert.ok(noon.dy < noon.length, 'foreshortened, not full length');
});

test('the hemispheres mirror each other', () => {
  const north = shadowFor(35, 140, -1, 40);
  const south = shadowFor(35, 140, 1, 40);
  assert.ok(Math.abs(north.dx + south.dx) < 1e-9, 'east-west component flips');
  assert.ok(Math.abs(north.dy + south.dy) < 1e-9, 'toward-viewer component flips');
});

test('no shadow once the sun is below the horizon', () => {
  assert.equal(shadowFor(0, 180, -1, 40), null);
  assert.equal(shadowFor(-6, 180, -1, 40), null);
});
