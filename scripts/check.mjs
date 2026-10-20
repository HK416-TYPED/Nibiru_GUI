import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

async function scripts(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await scripts(target));
    else if (/\.(mjs|js)$/.test(entry.name)) files.push(target);
  }
  return files;
}
const files = ['setup-admin.mjs', ...(await Promise.all(['server', 'public', 'scripts', 'tests'].map(scripts))).flat()];
for (const file of files) {
  const check = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (check.status !== 0) process.exit(check.status || 1);
}
console.log(`Syntax checked ${files.length} JavaScript files. No third-party build step is required.`);
