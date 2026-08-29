import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSION, BUILD_DATE } from '../js/version.js';

test('version is semver and build date is ISO', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/, `VERSION "${VERSION}" should look like 1.2.0`);
  assert.match(BUILD_DATE, /^\d{4}-\d{2}-\d{2}$/, `BUILD_DATE "${BUILD_DATE}" should be YYYY-MM-DD`);
  assert.ok(!Number.isNaN(Date.parse(BUILD_DATE)), 'BUILD_DATE must be a real date');
});

test('the page carries a badge element for the version to land in', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('id="version-badge"'), 'index.html needs the version badge element');
});
