import { sha256Hex } from './hash';

describe('sha256Hex', () => {
  it('coincide con vectores de prueba conocidos', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('da lo mismo para texto y para su Buffer, y siempre 64 caracteres', () => {
    expect(sha256Hex(Buffer.from('abc'))).toBe(sha256Hex('abc'));
    expect(sha256Hex('cualquier cosa')).toHaveLength(64);
  });

  it('un solo byte distinto cambia el hash', () => {
    expect(sha256Hex('archivo-1')).not.toBe(sha256Hex('archivo-2'));
  });
});