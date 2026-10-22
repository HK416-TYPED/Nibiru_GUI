import { mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = join(root, '.local', 'tmp');
mkdirSync(temp, { recursive: true });
const files = readdirSync(join(root, 'tests')).filter(name => name.endsWith('.test.mjs')).map(name => join(root, 'tests', name));
const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], {
  cwd: root, stdio: 'inherit', env: { ...process.env, TMP: temp, TEMP: temp, TMPDIR: temp },
});
if (result.error) console.error(result.error);
process.exit(result.status ?? 1);
