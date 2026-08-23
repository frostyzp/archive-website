/**
 * Build the 900px display thumbs + compress a few landing assets.
 *
 *   node scripts/generate-note-thumbs.mjs
 *
 * Skips a file when the output already exists and is newer than the source.
 */
import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(root, 'public', 'confession_notes_2');
const OUT_DIR = path.join(root, 'public', 'note-thumbs');
const THUMB_WIDTH = 900;
const THUMB_QUALITY = 72;

async function isFresh(src, dest) {
  try {
    const [a, b] = await Promise.all([stat(src), stat(dest)]);
    return b.mtimeMs >= a.mtimeMs && b.size > 0;
  } catch {
    return false;
  }
}

async function writeWebp(src, dest, { width, quality, withoutEnlargement = true }) {
  if (await isFresh(src, dest)) return false;
  await mkdir(path.dirname(dest), { recursive: true });
  await sharp(src)
    .rotate()
    .resize({ width, withoutEnlargement })
    .webp({ quality, effort: 5 })
    .toFile(dest);
  return true;
}

const files = (await readdir(SRC_DIR)).filter((f) => f.endsWith('.webp'));
await mkdir(OUT_DIR, { recursive: true });
let made = 0;
for (const file of files) {
  const src = path.join(SRC_DIR, file);
  const dest = path.join(OUT_DIR, file);
  if (await writeWebp(src, dest, { width: THUMB_WIDTH, quality: THUMB_QUALITY })) {
    made += 1;
  }
}

const extras = [
  {
    src: path.join(root, 'public', 'intro-booth-park.png'),
    dest: path.join(root, 'public', 'intro-booth-park.webp'),
    width: 1200,
    quality: 78,
  },
];
for (const extra of extras) {
  try {
    if (await writeWebp(extra.src, extra.dest, extra)) made += 1;
  } catch (err) {
    console.warn(`[thumbs] skip ${path.basename(extra.src)}: ${err.message}`);
  }
}

console.log(`[thumbs] ${files.length} notes, wrote ${made} file(s)`);
