// Copies the OCR engine's worker, WASM cores and English model from node_modules into public/ocr/, so the
// screenshot import works offline and does not depend on a CDN. Runs before `dev` and `build`; the copies are not committed.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'public', 'ocr');
mkdirSync(out, { recursive: true });

// A browser downloads only the one core it supports (relaxed SIMD, SIMD, or plain).
const files = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
];

for (const [from, to] of files) {
  const src = join(nm, from);
  const dest = join(out, to);
  if (!existsSync(src)) throw new Error(`Missing ${from}; run npm install first.`);
  if (existsSync(dest) && statSync(dest).size === statSync(src).size) continue;
  copyFileSync(src, dest);
  console.log(`ocr: copied ${to}`);
}
