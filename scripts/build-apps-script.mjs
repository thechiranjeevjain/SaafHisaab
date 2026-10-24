import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const www = path.join(root, 'www');
const target = path.join(root, 'apps-script', 'Index.html');

const [html, css, serviceConfig, coreSource, appSource] = await Promise.all([
  fs.readFile(path.join(www, 'index.html'), 'utf8'),
  fs.readFile(path.join(www, 'styles.css'), 'utf8'),
  fs.readFile(path.join(www, 'service-config.js'), 'utf8'),
  fs.readFile(path.join(www, 'core.js'), 'utf8'),
  fs.readFile(path.join(www, 'app.js'), 'utf8'),
]);

const core = coreSource.replace(/^export\s+/gm, '');
const app = appSource.replace(/^import\s+\{[\s\S]*?\}\s+from\s+'\.\/core\.js';\s*/m, '');
const built = html
  .replace('<link rel="stylesheet" href="styles.css" />', `<style>\n${css}\n</style>`)
  .replace('<script src="service-config.js"></script>', `<script>\n${serviceConfig}\n</script>`)
  .replace('<script type="module" src="app.js"></script>', `<script>window.SAAF_HISAAB_WEB_APP_URL = <?!= JSON.stringify(webAppUrl) ?>;</script>\n<script type="module">\n${core}\n${app}\n</script>`);

await fs.mkdir(path.dirname(target), { recursive: true });
await fs.writeFile(target, built, 'utf8');
console.log(`Built ${target}`);
