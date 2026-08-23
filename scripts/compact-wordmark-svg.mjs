/**
 * Round path numbers in the hero wordmark so the 1.6MB fetch is smaller.
 * Writes public/wwtai_2.min.svg
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'public', 'wwtai_2.svg');
const dest = path.join(root, 'public', 'wwtai_2.min.svg');

const raw = await readFile(src, 'utf8');
const compact = raw.replace(/-?\d+\.\d+/g, (n) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return n;
  const r = Math.round(x * 10) / 10;
  return String(r);
});
await writeFile(dest, compact);
console.log(
  `[wordmark] ${(raw.length / 1024).toFixed(0)}KB → ${(compact.length / 1024).toFixed(0)}KB`
);
