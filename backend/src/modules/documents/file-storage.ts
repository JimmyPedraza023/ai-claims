export const FILE_STORAGE = Symbol('FILE_STORAGE');

export interface FileStorage {
  /** Idempotente: si la ruta ya existe, no falla ni sobrescribe. */
  save(path: string, data: Buffer): Promise<void>;
  read(path: string): Promise<Buffer>;
}

/** La ruta se arma SOLO con el hash y la extensión detectada, nunca con el nombre del usuario. */
export function buildStoragePath(sha256: string, extension: string): string {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('sha256 inválido');
  if (!/^[a-z0-9]{2,5}$/.test(extension)) throw new Error('extensión inválida');
  return `${sha256.slice(0, 2)}/${sha256}.${extension}`;
}