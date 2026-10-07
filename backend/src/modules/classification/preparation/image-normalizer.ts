import sharp from 'sharp';
import { UnreadableDocumentError } from './unreadable-document.error';

/** JPEG, PNG o WebP → JPEG acotado: corrige la rotación EXIF, quita transparencia y reduce el tamaño. */
export async function normalizeImage(data: Buffer, opts: { maxSide: number; jpegQuality: number }): Promise<Buffer> {
  try {
    return await sharp(data, { limitInputPixels: 50_000_000, failOn: 'error' }) // tope contra bombas de descompresión
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({ width: opts.maxSide, height: opts.maxSide, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: opts.jpegQuality })
      .toBuffer();
  } catch {
    throw new UnreadableDocumentError('corrupto', 'La imagen no se pudo abrir');
  }
}