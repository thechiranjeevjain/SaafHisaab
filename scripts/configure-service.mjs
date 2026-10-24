import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const endpoint = String(process.argv[2] || process.env.SAAF_HISAAB_API_URL || '').trim();
const valid = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint);

if (!valid) {
  console.error('Provide the deployed Apps Script URL ending in /exec.');
  console.error('Example: npm run configure:service -- https://script.google.com/macros/s/DEPLOYMENT_ID/exec');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'www', 'service-config.js');
const source = `// Generated public runtime configuration. Do not put secrets in this file.\nwindow.SAAF_HISAAB_API_URL = ${JSON.stringify(endpoint)};\n`;

await fs.writeFile(target, source, 'utf8');
console.log(`Configured SaafHisaab service in ${target}`);
