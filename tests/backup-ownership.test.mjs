import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../www/app.js', import.meta.url), 'utf8');
const backendSource = await readFile(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

test('homeowner personal backup uses an account-scoped export and system share', () => {
  assert.match(appSource, /grouped\.workingForMe\.length > 0/);
  assert.match(appSource, /data-action="backup-my-drive"/);
  assert.match(appSource, /saveBackupToPersonalDrive/);
  assert.match(appSource, /nativePlugin\('Filesystem'\)/);
  assert.match(appSource, /nativePlugin\('Share'\)/);
  assert.match(appSource, /directory: 'CACHE'/);
  assert.match(appSource, /Choose Google Drive and the homeowner account/);
  assert.doesNotMatch(appSource, /data-action="backup-drive"/);
  assert.doesNotMatch(appSource, /api\('backupMyDataToDrive'\)/);
});

test('personal export excludes joining codes and authentication secrets', () => {
  assert.match(backendSource, /delete copy\.joinCode/);
  assert.match(backendSource, /account: \{ userId: account\.userId, phone: account\.phone, displayName: account\.displayName \}/);
  const exportSection = backendSource.slice(backendSource.indexOf('function userExportBlob_'), backendSource.indexOf('function exportMyData_'));
  assert.doesNotMatch(exportSection, /pinHash|pinSalt|tokenHash|accountSessions|sessions:/);
});
