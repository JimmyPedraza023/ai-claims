import type { LlmImage } from '../llm-provider';
import { normalizeImage } from './image-normalizer';
import { PdfRasterizer } from './pdf-rasterizer';
import { UnreadableDocumentError } from './unreadable-document.error';

export const DOCUMENT_PREPARER = Symbol('DOCUMENT_PREPARER');

export interface PreparedDocument {
  images: LlmImage[];
  totalPages: number;
  usedPages: number;
  /** true si el documento tenía más páginas de las que se enviaron al modelo. */
  truncated: boolean;
  imageBytes: number[];
}

export interface DocumentPreparer {
  prepare(input: { mimeType: string; data: Buffer }): Promise<PreparedDocument>;
}

export interface PreparerOptions {
  maxPages: number;
  maxSide: number;
  jpegQuality: number;
}

export const DEFAULT_PREPARER_OPTIONS: PreparerOptions = { maxPages: 4, maxSide: 1600, jpegQuality: 80 };

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export class DefaultDocumentPreparer implements DocumentPreparer {
  constructor(
    private readonly pdf: PdfRasterizer = new PdfRasterizer(),
    private readonly options: PreparerOptions = DEFAULT_PREPARER_OPTIONS,
  ) {}

  async prepare(input: { mimeType: string; data: Buffer }): Promise<PreparedDocument> {
    let jpegs: Buffer[];
    let totalPages: number;

    if (input.mimeType === 'application/pdf') {
      const r = await this.pdf.rasterize(input.data, this.options);
      jpegs = r.jpegs;
      totalPages = r.totalPages;
    } else if (IMAGE_TYPES.has(input.mimeType)) {
      jpegs = [await normalizeImage(input.data, this.options)];
      totalPages = 1;
    } else {
      throw new UnreadableDocumentError('tipo_no_soportado', 'Tipo de archivo no soportado');
    }

    return {
      images: jpegs.map((b) => ({ mimeType: 'image/jpeg' as const, base64: b.toString('base64') })),
      totalPages,
      usedPages: jpegs.length,
      truncated: totalPages > jpegs.length,
      imageBytes: jpegs.map((b) => b.length),
    };
  }
}