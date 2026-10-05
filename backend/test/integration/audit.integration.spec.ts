import { AUDIT_EVENTS } from '../../src/modules/audit/event-types';
import { createAnalyst, createTestContext, newClaimInput } from './helpers';

const { db, audit, claims } = createTestContext();

afterAll(async () => {
  await db.onModuleDestroy();
});

describe('AuditService', () => {
  it('la línea de tiempo sale en orden e incluye el nombre del analista', async () => {
    const analystId = await createAnalyst(db, 'Luisa Analista');
    const claim = await db.withTransaction((c) => claims.createClaim(c, newClaimInput()));

    await audit.record(db, {
      claimId: claim.id,
      type: AUDIT_EVENTS.ENVIO_DUPLICADO_IGNORADO, // el tipo da igual: se prueba el mecanismo
      actor: 'analista',
      actorUserId: analystId,
      payload: { nota: 'prueba', detalle: { n: 1 } },
    });

    const timeline = await audit.timeline(claim.id);
    expect(timeline.map((e) => e.actor)).toEqual(['beneficiario', 'analista']);
    expect(timeline[1].actorName).toBe('Luisa Analista');
    expect(timeline[1].payload).toEqual({ nota: 'prueba', detalle: { n: 1 } }); // el JSON no se pierde
    expect(timeline[1].eventId).toBeGreaterThan(timeline[0].eventId);
  });

  it('un evento de analista sin usuario se rechaza: toda acción humana queda atribuida', async () => {
    const claim = await db.withTransaction((c) => claims.createClaim(c, newClaimInput()));
    await expect(
      audit.record(db, {
        claimId: claim.id,
        type: AUDIT_EVENTS.ENVIO_DUPLICADO_IGNORADO,
        actor: 'analista',
      }),
    ).rejects.toThrow();
  });

  it('el evento y el hecho van juntos: si la transacción se revierte, no queda rastro', async () => {
    const claim = await db.withTransaction((c) => claims.createClaim(c, newClaimInput()));

    await expect(
      db.withTransaction(async (c) => {
        await audit.record(c, {
          claimId: claim.id,
          type: AUDIT_EVENTS.ENVIO_DUPLICADO_IGNORADO,
          actor: 'sistema',
        });
        throw new Error('falla después de escribir el evento');
      }),
    ).rejects.toThrow('falla después');

    expect(await audit.timeline(claim.id)).toHaveLength(1); // solo reclamacion_recibida
  });

  it('la bitácora no se puede editar ni borrar', async () => {
    const claim = await db.withTransaction((c) => claims.createClaim(c, newClaimInput()));
    await expect(
      db.query(`UPDATE claim_events SET event_type = 'x' WHERE claim_id = $1`, [claim.id]),
    ).rejects.toThrow(/solo inserción/);
    await expect(
      db.query(`DELETE FROM claim_events WHERE claim_id = $1`, [claim.id]),
    ).rejects.toThrow(/solo inserción/);
  });
});