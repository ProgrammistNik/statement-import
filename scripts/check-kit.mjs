import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const manifest = JSON.parse(await readFile(new URL('./kit-sha256.json', import.meta.url), 'utf8'));
for (const [path, expected] of Object.entries(manifest)) {
  const bytes = await readFile(new URL(`../${path}`, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, path);
}
console.log(`Original kit verified: ${Object.keys(manifest).length} files`);
