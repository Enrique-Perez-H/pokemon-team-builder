import type { Worker } from 'tesseract.js';
import type { OcrWord } from '../engine/screenshot';

/**
 * In-browser text recognition for team screenshots. The engine (Tesseract compiled to WebAssembly) and its English model
 * are served from this site (see scripts/copy-ocr-assets.mjs), fetched only when the feature is first used, and cached.
 */

export interface OcrProgress {
  /** 0–1 across loading and both passes. */
  fraction: number;
  /** Plain-language description of the current step. */
  label: string;
}

export interface OcrResult {
  words: OcrWord[];
  width: number;
  height: number;
}

let worker: Promise<Worker> | null = null;
let listener: ((p: OcrProgress) => void) | null = null;
let pass = 0;

const PASSES = 2;

function report(fraction: number, label: string) {
  listener?.({ fraction: Math.max(0, Math.min(1, fraction)), label });
}

function getWorker(): Promise<Worker> {
  worker ??= (async () => {
    report(0.02, 'Loading the text reader…');
    const { createWorker } = await import('tesseract.js');
    const base = `${import.meta.env.BASE_URL}ocr/`;
    const w = await createWorker('eng', 1, {
      workerPath: `${base}worker.min.js`,
      corePath: base,
      langPath: base,
      gzip: true,
      workerBlobURL: false,
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text') report(0.1 + ((pass + m.progress) / PASSES) * 0.9, `Reading the picture (${pass + 1} of ${PASSES})…`);
        else if (/loading/.test(m.status)) report(0.02 + m.progress * 0.08, 'Loading the text reader…');
      },
    });
    // Sparse text: names, moves and numbers are scattered over the picture, not laid out in paragraphs.
    await w.setParameters({ tessedit_pageseg_mode: '11' as never, preserve_interword_spaces: '1' });
    return w;
  })();
  worker.catch(() => { worker = null; });
  return worker;
}

/** Free the engine's memory (about 50 MB). It is recreated, from cache, the next time it is needed. */
export async function disposeOcr(): Promise<void> {
  const w = worker;
  worker = null;
  if (w) await (await w.catch(() => null))?.terminate();
}

/** Scale small screenshots up (text of 8–10px is unreadable to OCR) and very large ones down. */
function scaleFor(w: number, h: number): number {
  const longest = Math.max(w, h);
  if (longest > 3000) return 3000 / longest;
  return Math.min(4, Math.max(1, 2000 / longest));
}

function draw(bitmap: ImageBitmap, scale: number, contrast: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (contrast) {
    // Greyscale with the mid-tones stretched, which helps pale text on coloured panels.
    const img = g.getImageData(0, 0, canvas.width, canvas.height);
    const px = img.data;
    for (let i = 0; i < px.length; i += 4) {
      const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      const v = y < 110 ? 0 : y > 190 ? 255 : ((y - 110) * 255) / 80;
      px[i] = px[i + 1] = px[i + 2] = v;
    }
    g.putImageData(img, 0, 0);
  }
  return canvas;
}

/** Read every word in an image, twice (as-is and high-contrast), with positions in the original image's pixels. */
export async function readImageText(file: Blob, onProgress: (p: OcrProgress) => void): Promise<OcrResult> {
  listener = onProgress;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = scaleFor(bitmap.width, bitmap.height);
    const w = await getWorker();
    const words: OcrWord[] = [];
    for (pass = 0; pass < PASSES; pass++) {
      report(0.1 + (pass / PASSES) * 0.9, `Reading the picture (${pass + 1} of ${PASSES})…`);
      const canvas = draw(bitmap, scale, pass === 1);
      const { data } = await w.recognize(canvas, {}, { blocks: true });
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            for (const word of line.words) {
              words.push({
                text: word.text, conf: word.confidence, pass,
                x0: word.bbox.x0 / scale, y0: word.bbox.y0 / scale, x1: word.bbox.x1 / scale, y1: word.bbox.y1 / scale,
              });
            }
          }
        }
      }
    }
    report(1, 'Done');
    return { words, width: bitmap.width, height: bitmap.height };
  } finally {
    listener = null;
  }
}
