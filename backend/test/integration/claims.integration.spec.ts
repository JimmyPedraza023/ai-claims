import {
  IdempotencyKeyConflictError,
  OpenClaimAlreadyExistsError,
} from '../../src/modules/claims/claims.errors';
import { generateTrackingToken } from '../../src/modules/claims/tracking-token';
import {
  createTestContext,
  newClaimInput,
  newIdempotencyKey,
  randomDocument,
} from './helpers';

const { db, audit, claims } = createTestContext();

afterAll(async () => {
  await db.onModuleDestroy();
});

describe('ClaimsService.createClaim', () => {
  it('guarda el caso sin reloj y deja su primer evento en la bitácora', async () => {
    const claim = await db.withTransaction((c) => claims.createClaim(c, newClaimInput()));

    expect(claim.status).toBe('recibida');
    expect(claim.referenceCode).toMatch(/^RC-\d{4}-\d{6}$/);
    expect(claim.completedAt).toBeNull(); // el reloj NO arranca al radicar
    expect(claim.deadlineDate).toBeNull();

    const timeline = await audit.timeline(claim.id);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      eventType: 'reclamacion_recibida',
      actor: 'beneficiario',
      actorName: null,
      payload: { channel: 'web', referenceCode: claim.referenceCode },
    });
  });

  it('no mete datos personales en el evento de la bitácora', async () => {
    const claim = await db.withTransaction((c) => claims.createClaim(c, newClaimInput()));
    const [evento] = await audit.timeline(claim.id);
    const texto = JSON.stringify(evento.payload);
    expect(texto).not.toContain(claim.beneficiaryEmail);
    expect(texto).not.toContain(claim.beneficiaryFullName);
    expect(texto).not.toContain(claim.beneficiaryDocumentNumber);
  });

  it('normaliza documento, correo y nombre antes de guardar', async () => {
    const doc = randomDocument();
    const claim = await db.withTransaction((c) =>
      claims.createClaim(
        c,
        newClaimInput({
          beneficiaryDocumentNumber: `${doc.slice(0, 2)}.${doc.slice(2, 5)}.${doc.slice(5)}`,
          beneficiaryEmail: '  Ana.Perez@Example.COM ',
          beneficiaryFullName: '  Ana   María  Pérez ',
        }),
      ),
    );
    expect(claim.beneficiaryDocumentNumber).toBe(doc);
    expect(claim.beneficiaryEmail).toBe('ana.perez@example.com');
    expect(claim.beneficiaryFullName).toBe('Ana María Pérez');
  });

  it('un segundo caso abierto del mismo beneficiario y asegurado se rechaza, aunque el documento venga con otro formato', async () => {
    const beneficiario = randomDocument();
    const asegurado = randomDocument();
    const primero = await db.withTransaction((c) =>
      claims.createClaim(
        c,
        newClaimInput({ beneficiaryDocumentNumber: beneficiario, insuredDocumentNumber: asegurado }),
      ),
    );

    const conPuntos = `${beneficiario.slice(0, 2)}.${beneficiario.slice(2, 5)}.${beneficiario.slice(5)}`;
    await expect(
      db.withTransaction((c) =>
        claims.createClaim(
          c,
          newClaimInput({ beneficiaryDocumentNumber: conPuntos, insuredDocumentNumber: asegurado }),
        ),
      ),
    ).rejects.toBeInstanceOf(OpenClaimAlreadyExistsError);

    // El intento fallido no dejó nada: un solo caso y un solo evento.
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM claims WHERE beneficiary_document_number = $1 AND insured_document_number = $2`,
      [beneficiario, asegurado],
    );
    expect(rows[0].n).toBe(1);
    expect(await audit.timeline(primero.id)).toHaveLength(1);

    // Y quien llama puede recuperar el caso existente.
    const existente = await claims.findOpenClaim(db, conPuntos, asegurado);
    expect(existente?.id).toBe(primero.id);
  });

  it('la fecha límite vuelve como texto YYYY-MM-DD, sin corrimientos por zona horaria', async () => {
    const claim = await db.withTransaction((c) => claims.createClaim(c, newClaimInput()));
    const { rows } = await db.query<{ deadline: string }>(
      `UPDATE claims
          SET status = 'completa',
              completed_at = now(),
              deadline_date = (now() AT TIME ZONE 'America/Bogota')::date + 20
        WHERE id = $1
    RETURNING deadline_date::text AS deadline`,
      [claim.id],
    );
    const recargado = await claims.findById(db, claim.id);
    expect(typeof recargado?.deadlineDate).toBe('string');
    expect(recargado?.deadlineDate).toBe(rows[0].deadline);
  });
});

describe('ClaimsService.registerSubmission (idempotencia)', () => {
  it('el mismo envío dos veces no crea otro envío ni otro caso, y queda anotado', async () => {
    const claim = await db.withTransaction((c) => claims.createClaim(c, newClaimInput()));
    const key = newIdempotencyKey();
    const envio = { claimId: claim.id, idempotencyKey: key, kind: 'inicial' as const, channel: 'web' as const };

    const primero = await db.withTransaction((c) => claims.registerSubmission(c, envio));
    const repetido = await db.withTransaction((c) => claims.registerSubmission(c, envio));

    expect(primero.created).toBe(true);
    expect(repetido.created).toBe(false);
    expect(repetido.submission.id).toBe(primero.submission.id);

    const { rows } = await db.query(`SELECT count(*)::int AS n FROM submissions WHERE claim_id = $1`, [claim.id]);
    expect(rows[0].n).toBe(1);

    const tipos = (await audit.timeline(claim.id)).map((e) => e.eventType);
    expect(tipos).toEqual(['reclamacion_recibida', 'envio_duplicado_ignorado']);

    // El duplicado no tocó el estado ni el reloj del caso.
    const despues = await claims.findById(db, claim.id);
    expect(despues).toMatchObject({ status: 'recibida', completedAt: null, deadlineDate: null });
  });

  it('la misma llave usada en OTRA reclamación se rechaza', async () => {
    const a = await db.withTransaction((c) => claims.createClaim(c, newClaimInput()));
    const b = await db.withTransaction((c) => claims.createClaim(c, newClaimInput()));
    const key = newIdempotencyKey();

    await db.withTransaction((c) =>
      claims.registerSubmission(c, { claimId: a.id, idempotencyKey: key, kind: 'inicial', channel: 'web' }),
    );
    await expect(
      db.withTransaction((c) =>
        claims.registerSubmission(c, { claimId: b.id, idempotencyKey: key, kind: 'inicial', channel: 'web' }),
      ),
    ).rejects.toBeInstanceOf(IdempotencyKeyConflictError);
  });
});

describe('concurrencia: el mismo evento llega varias veces a la vez', () => {
  it('cinco envíos simultáneos con la misma llave producen un solo envío', async () => {
    const claim = await db.withTransaction((c) => claims.createClaim(c, newClaimInput()));
    const envio = {
      claimId: claim.id,
      idempotencyKey: newIdempotencyKey(),
      kind: 'inicial' as const,
      channel: 'web' as const,
    };

    const resultados = await Promise.all(
      Array.from({ length: 5 }, () => db.withTransaction((c) => claims.registerSubmission(c, envio))),
    );

    expect(resultados.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(resultados.map((r) => r.submission.id)).size).toBe(1);

    const { rows } = await db.query(`SELECT count(*)::int AS n FROM submissions WHERE claim_id = $1`, [claim.id]);
    expect(rows[0].n).toBe(1);

    const duplicados = (await audit.timeline(claim.id)).filter((e) => e.eventType === 'envio_duplicado_ignorado');
    expect(duplicados).toHaveLength(4); // los cuatro repetidos quedaron anotados
  });

  it('cinco casos simultáneos del mismo beneficiario y asegurado: solo se crea uno', async () => {
    const partes = { beneficiaryDocumentNumber: randomDocument(), insuredDocumentNumber: randomDocument() };

    const resultados = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        db.withTransaction((c) =>
          claims.createClaim(c, newClaimInput({ ...partes, trackingTokenHash: generateTrackingToken().hash })),
        ),
      ),
    );

    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rechazados = resultados.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rechazados).toHaveLength(4);
    for (const r of rechazados) expect(r.reason).toBeInstanceOf(OpenClaimAlreadyExistsError);

    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM claims WHERE beneficiary_document_number = $1 AND insured_document_number = $2`,
      [partes.beneficiaryDocumentNumber, partes.insuredDocumentNumber],
    );
    expect(rows[0].n).toBe(1);
  });
});