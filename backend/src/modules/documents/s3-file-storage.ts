import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { FileStorage } from './file-storage';

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  if (typeof body === 'string') return Buffer.from(body);
  const stream = body as Readable & {
    transformToByteArray?: () => Promise<Uint8Array>;
  };
  if (typeof stream.transformToByteArray === 'function') {
    return Buffer.from(await stream.transformToByteArray());
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/**
 * Almacenamiento en AWS S3 con la misma semántica que LocalFileStorage:
 * - save es idempotente y nunca sobrescribe una ruta existente.
 * - La ruta ya viene segura (hash + extensión) desde buildStoragePath.
 *
 * Las credenciales se toman de las variables estándar del SDK
 * (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION) o del rol de la
 * instancia/carga de ECS, por lo que no se declaran aquí.
 */
export class S3FileStorage implements FileStorage {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    clientConfig?: S3ClientConfig,
  ) {
    this.client = clientConfig ? new S3Client(clientConfig) : new S3Client();
  }

  async save(path: string, data: Buffer): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: path,
          Body: data,
          ContentType: 'application/octet-stream',
          // Idempotencia equivalente al flag 'wx' local: si el objeto ya
          // existe, S3 responde 412 y no se sobrescribe.
          IfNoneMatch: '*',
        }),
      );
    } catch (err) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailed') return;
      throw err;
    }
  }

  async read(path: string): Promise<Buffer> {
    const { Body } = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: path }),
    );
    return bodyToBuffer(Body);
  }
}