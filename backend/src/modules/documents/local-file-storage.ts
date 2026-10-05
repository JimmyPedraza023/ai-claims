import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { FileStorage } from './file-storage';

export class LocalFileStorage implements FileStorage {
  constructor(private readonly baseDir: string) {}

  private resolveSafe(path: string): string {
    const base = resolve(this.baseDir);
    const full = resolve(base, path);
    if (!full.startsWith(base + sep)) throw new Error('Ruta fuera del almacenamiento');
    return full;
  }

  async save(path: string, data: Buffer): Promise<void> {
    const full = this.resolveSafe(path);
    await mkdir(dirname(full), { recursive: true });
    try {
      await writeFile(full, data, { flag: 'wx' }); // falla si ya existe
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }

  async read(path: string): Promise<Buffer> {
    return readFile(this.resolveSafe(path));
  }
}