import { generateTrackingToken, hashTrackingToken } from './tracking-token';

describe('generateTrackingToken', () => {
  it('genera un token largo, apto para URL, con su hash de 64 caracteres', () => {
    const { token, hash } = generateTrackingToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes en base64url
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('el hash no revela el token y es reproducible a partir de él', () => {
    const { token, hash } = generateTrackingToken();
    expect(hash).not.toContain(token);
    expect(hashTrackingToken(token)).toBe(hash);
  });

  it('no repite tokens', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateTrackingToken().token));
    expect(tokens.size).toBe(1000);
  });
});