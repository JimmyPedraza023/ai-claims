import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { DefaultDocumentPreparer } from '../../src/modules/classification/preparation/document-preparer';
import { UnreadableDocumentError } from '../../src/modules/classification/preparation/unreadable-document.error';

const pdf = readFileSync(resolve(process.cwd(), 'test/fixtures/prueba.pdf'));
const options = { maxPages: 4, maxSide: 1600, jpegQuality: 80 };
const preparer = new DefaultDocumentPreparer(undefined, options);

async function failure(p: Promise<unknown>): Promise<UnreadableDocumentError> {
  try { await p; } catch (e) { return e as UnreadableDocumentError; }
  throw new Error('debía fallar');
}

describe('preparación de documentos', () => {
  it('un PDF se convierte en una imagen JPEG por página', async () => {
    const r = await preparer.prepare({ mimeType: 'application/pdf', data: pdf });
    expect(r).toMatchObject({ totalPages: 2, usedPages: 2, truncated: false });
    expect(r.images).toHaveLength(2);
    expect(r.images[0].mimeType).toBe('image/jpeg');
    expect(Buffer.from(r.images[0].base64, 'base64').subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it('el límite de páginas marca el documento como truncado', async () => {
    const p = new DefaultDocumentPreparer(undefined, { ...options, maxPages: 1 });
    const r = await p.prepare({ mimeType: 'application/pdf', data: pdf });
    expect(r).toMatchObject({ totalPages: 2, usedPages: 1, truncated: true });
  });

  it('una foto grande se reduce, se pasa a JPEG y no se agranda', async () => {
    const png = await sharp({ create: { width: 3200, height: 2400, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const r = await preparer.prepare({ mimeType: 'image/png', data: png });
    const meta = await sharp(Buffer.from(r.images[0].base64, 'base64')).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width!, meta.height!)).toBe(1600);
    expect(r.truncated).toBe(false);
  });

  it('un PDF corrupto no se puede leer, y el error no revela su contenido', async () => {
    const e = await failure(preparer.prepare({ mimeType: 'application/pdf', data: Buffer.from('esto no es un pdf') }));
    expect(e).toBeInstanceOf(UnreadableDocumentError);
    expect(e.reason).toBe('corrupto');
    expect(e.message).not.toContain('esto no es');
  });

  it('una imagen corrupta no se puede leer', async () => {
    const e = await failure(preparer.prepare({ mimeType: 'image/jpeg', data: Buffer.from('basura') }));
    expect(e.reason).toBe('corrupto');
  });

  it('un tipo que no es PDF ni imagen no se procesa', async () => {
    const e = await failure(preparer.prepare({ mimeType: 'text/plain', data: Buffer.from('hola') }));
    expect(e.reason).toBe('tipo_no_soportado');
  });
});