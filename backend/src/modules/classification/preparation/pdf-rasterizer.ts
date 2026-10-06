import { resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { UnreadableDocumentError } from './unreadable-document.error';

export interface PdfRasterOptions {
  maxPages: number;
  /** Lado mayor de la imagen, en píxeles. */
  maxSide: number;
  jpegQuality: number;
}

export interface PdfRasterResult {
  jpegs: Buffer[];
  totalPages: number;
}

interface PdfPage {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvasContext: unknown; viewport: unknown }): { promise: Promise<void> };
  cleanup(): void;
}
interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
}
/** En pdfjs v4+ el destroy() está en el loading task, no en el proxy del documento. */
interface PdfLoadingTask {
  promise: Promise<PdfDocument>;
  destroy(): Promise<void>;
}
interface PdfjsLike {
  getDocument(o: Record<string, unknown>): PdfLoadingTask;
}

// pdfjs-dist v4+ solo distribuye ESM (pdf.mjs). En producción el import() dinámico se mantiene
// como ESM nativo; en Jest se declara un transform .mjs -> CommonJS (jest-integration.json).
let pdfjsPromise: Promise<PdfjsLike> | null = null;
const loadPdfjs = (): Promise<PdfjsLike> =>
  (pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as Promise<PdfjsLike>);

function toUnreadable(e: unknown): UnreadableDocumentError {
  const name = (e as { name?: string } | null)?.name;
  if (name === 'PasswordException') {
    return new UnreadableDocumentError('protegido', 'El PDF está protegido con contraseña');
  }
  return new UnreadableDocumentError('corrupto', 'El PDF no se pudo abrir o dibujar'); // sin detalles del contenido
}

/**
 * Convierte las primeras páginas de un PDF en JPEG. El PDF viene de un desconocido:
 * límites de páginas y de tamaño de imagen, y nada de eval.
 * Límite conocido: pdfjs corre en el mismo proceso. El tiempo máximo del trabajo abandona
 * la espera pero no detiene un PDF malicioso que cuelgue el dibujo; el siguiente paso sería
 * un proceso o hilo aparte (documentado en DECISIONS).
 */
export class PdfRasterizer {
  constructor(
    private readonly fontsDir: string = resolve(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts') + '/',
  ) {}

  async rasterize(data: Buffer, opts: PdfRasterOptions): Promise<PdfRasterResult> {
    // Si la librería no carga, es un problema del entorno y debe verse como tal (se reintenta).
    const pdfjs = await loadPdfjs();

    let doc: PdfDocument;
    let task: PdfLoadingTask;
    try {
      task = pdfjs.getDocument({
        data: new Uint8Array(data),
        isEvalSupported: false,
        useSystemFonts: false,
        standardFontDataUrl: this.fontsDir,
        verbosity: 0,
      });
      doc = await task.promise;
    } catch (e) {
      throw toUnreadable(e);
    }

    try {
      const count = Math.min(doc.numPages, opts.maxPages);
      const jpegs: Buffer[] = [];
      for (let n = 1; n <= count; n++) {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const scale = opts.maxSide / Math.max(base.width, base.height);
        if (!Number.isFinite(scale) || scale <= 0) throw new Error('página sin tamaño');
        const viewport = page.getViewport({ scale });
        const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        jpegs.push(canvas.toBuffer('image/jpeg', opts.jpegQuality));
        page.cleanup();
      }
      return { jpegs, totalPages: doc.numPages };
    } catch (e) {
      throw toUnreadable(e);
    } finally {
      await task!.destroy().catch(() => undefined);
    }
  }
}