// node .\scripts\raster-spike.mjs .\scripts\prueba.pdf
import { readFileSync, writeFileSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const MAX_SIDE = 1600; // lado mayor en píxeles: la resolución mínima que aún deje ver una firma
const t0 = Date.now();
const data = new Uint8Array(readFileSync(process.argv[2]));
const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false }).promise;
console.log('páginas:', doc.numPages);

for (let n = 1; n <= Math.min(doc.numPages, 3); n++) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: MAX_SIDE / Math.max(base.width, base.height) });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  const jpg = canvas.toBuffer('image/jpeg', 80);
  writeFileSync(`pagina-${n}.jpg`, jpg);
  console.log(`pág ${n}: ${canvas.width}x${canvas.height}, ${(jpg.length / 1024).toFixed(0)} KB, acumulado ${Date.now() - t0} ms`);
}