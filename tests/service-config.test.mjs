import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../www/app.js', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../www/index.html', import.meta.url), 'utf8');
const buildSource = await readFile(new URL('../scripts/build-apps-script.mjs', import.meta.url), 'utf8');

test('customer login never asks for an Apps Script endpoint', () => {
  assert.doesNotMatch(appSource, /name=["']endpoint["']/);
  assert.doesNotMatch(appSource, /Apps Script service URL/);
  assert.match(appSource, /configuredServiceEndpoint\(\)/);
  assert.match(appSource, /official configured APK or website/);
});

test('runtime service configuration loads before application code', () => {
  const configPosition = indexSource.indexOf('<script src="service-config.js"></script>');
  const appPosition = indexSource.indexOf('<script type="module" src="app.js"></script>');
  assert.ok(configPosition >= 0, 'service-config.js must be loaded');
  assert.ok(appPosition > configPosition, 'service configuration must load before app.js');
});

test('Apps Script bundle inlines runtime configuration', () => {
  assert.match(buildSource, /service-config\.js/);
  assert.match(buildSource, /serviceConfig/);
});
