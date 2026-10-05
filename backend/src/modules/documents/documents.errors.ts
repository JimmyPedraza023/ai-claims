export class InvalidFileError extends Error {
  constructor(
    public readonly code: 'TYPE_NOT_ALLOWED' | 'TOO_LARGE' | 'EMPTY',
    public readonly fileIndex: number,
    message: string,
  ) {
    super(message);
    this.name = 'InvalidFileError';
  }
}

export class TooManyFilesError extends Error {
  constructor(public readonly max: number) {
    super(`Se permiten máximo ${max} archivos por envío.`);
    this.name = 'TooManyFilesError';
  }
}