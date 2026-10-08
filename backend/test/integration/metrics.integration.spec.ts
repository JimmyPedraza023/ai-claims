import { randomUUID } from 'node:crypto';
import { AUDIT_EVENTS } from '../../src/modules/audit/event-types';
import { generateTrackingToken } from '../../src/modules/claims/tracking-token';
import { AiRunsRepository } from '../../src/modules/classification/ai-runs.repository';
import { ClassificationsRepository } from '../../src/modules/classification/classifications.repository';
import { computeDeadline } from '../../src/modules/legal-clock/legal-clock';
import { MetricsRepository } from '../../src/modules/metrics/metrics.repository';
import { PanelRepository } from '../../src/modules/panel/panel.repository';
import { createAnalyst, createTestContext, randomDocument, seedDocument } from './helpers';

const DAY = 86_400_000;
const HOUR = 3_600_000;

describe('Métricas: las cuatro preguntas', () => {
  const { db, audit } = createTestContext();
  const metrics = new MetricsRepository();
  const panel = new PanelRepository();
  const aiRuns = new AiRunsRepository();
  const classifications = new ClassificationsRepository();
  let analystId: string;

  beforeAll(async () => {
    analystId = await createAnalyst(db, 'Analista de métricas');
  });

  afterAll(async () => {
    await db.onModuleDestroy();
  });

  // ------------------------------------------------------------------ ayudantes

  interface ClaimSpec {
    status?: 'recibida' | 'incompleta' | 'completa' | 'pagada' | 'objetada';
    /** Cuántos días atrás se completó el expediente (así arranca el reloj). Sin valor: sin reloj. */
    completedDaysAgo?: number;
    receivedAt?: Date;
    /** Por defecto se registra el evento de recepción; solo el caso "sin historia" lo omite. */
    withEvent?: boolean;
  }

  /**
   * Inserta el caso con las fechas ya coherentes: el trigger protect_claim_clock impide mover el
   * reloj con un UPDATE, pero no vigila los INSERT.
   */
  async function insertClaim(spec: ClaimSpec = {}): Promise<string> {
    const status = spec.status ?? (spec.completedDaysAgo !== undefined ? 'completa' : 'recibida');
    const completedAt =
      spec.completedDaysAgo !== undefined ? new Date(Date.now() - spec.completedDaysAgo * DAY) : null;
    const receivedAt = spec.receivedAt ?? new Date((completedAt ?? new Date()).getTime() - HOUR);
    const closedAt = status === 'pagada' || status === 'objetada' ? new Date() : null;

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO claims (
         channel, narrative, claim_type, status,
         beneficiary_document_type, beneficiary_document_number, beneficiary_full_name, beneficiary_email,
         insured_document_number, insured_full_name,
         consent_accepted_at, consent_version, tracking_token_hash,
         received_at, completed_at, deadline_date, closed_at)
       VALUES ('web', 'Caso de prueba de métricas', NULL::claim_type, $1::claim_status,
               'CC', $2, 'Beneficiario de Prueba', 'metricas@example.com',
               $3, 'Asegurado de Prueba',
               $4, 'v1', $5,
               $4, $6, $7::date, $8)
       RETURNING id`,
      [
        status, randomDocument(), randomDocument(), receivedAt, generateTrackingToken().hash,
        completedAt, completedAt ? computeDeadline(completedAt) : null, closedAt,
      ],
    );
    const claimId = rows[0].id;
    if (spec.withEvent !== false) {
      await audit.record(db, { claimId, type: AUDIT_EVENTS.RECLAMACION_RECIBIDA, actor: 'sistema' });
    }
    return claimId;
  }

  /** Una predicción del modelo, opcionalmente ya revisada por una persona. */
  async function insertPrediction(p: {
    subject: 'tipo_reclamacion' | 'validez_documento';
    predicted: string;
    finalValue?: string; // si se indica, una persona ya la revisó
  }): Promise<void> {
    let claimId: string;
    let documentId: string | null = null;
    if (p.subject === 'tipo_reclamacion') {
      claimId = await insertClaim();
    } else {
      // El CHECK classifications_document_scope exige un documento real para los temas de documento.
      const seeded = await seedDocument(db);
      claimId = seeded.claimId;
      documentId = seeded.documentId;
    }

    const aiRunId = await aiRuns.insert(db, {
      claimId, documentId,
      task: p.subject === 'tipo_reclamacion' ? 'clasificar_reclamacion' : 'analizar_documento',
      provider: 'test', model: 'fake', promptVersion: 'test', inputRef: {},
      rawOutput: null, parsedOutput: null, status: 'ok', error: null, latencyMs: 1,
    });
    const id = await classifications.insert(db, {
      claimId, documentId, aiRunId, subject: p.subject,
      predictedValue: p.predicted, confidence: 0.9, evidence: null,
    });
    if (p.finalValue !== undefined) await classifications.review(db, id, p.finalValue, analystId);
  }

  async function insertNotification(
    claimId: string,
    n: { kind: string; audience?: 'beneficiario' | 'analistas'; sentAt?: Date },
  ): Promise<void> {
    await db.query(
      `INSERT INTO notifications (claim_id, kind, audience, recipient, subject, body, dedupe_key, status, sent_at)
       VALUES ($1, $2::notification_kind, $3, 'destino@example.com', 'asunto', 'cuerpo', $4,
               CASE WHEN $5::timestamptz IS NULL THEN 'pendiente'::notification_status
                    ELSE 'enviada'::notification_status END,
               $5)`,
      [claimId, n.kind, n.audience ?? 'beneficiario', `test:${randomUUID()}`, n.sentAt ?? null],
    );
  }

  interface OpenRow {
    claimId: string;
    clockState: string;
    daysElapsed: number | null;
    daysTotal: number | null;
    deadlineDate: string | null;
  }

  /**
   * Recorre TODA la lista de casos abiertos y devuelve los que interesan con su posición global.
   * La base de pruebas acumula casos entre ejecuciones (no se pueden borrar), así que no sirve
   * mirar solo la primera página.
   */
  async function locate(ids: string[]): Promise<Map<string, OpenRow & { position: number }>> {
    const found = new Map<string, OpenRow & { position: number }>();
    for (let offset = 0; ; offset += 500) {
      const page = (await panel.listOpenClaims(db, 500, offset)) as OpenRow[];
      if (page.length === 0) break;
      page.forEach((row, i) => {
        if (ids.includes(row.claimId)) found.set(row.claimId, { ...row, position: offset + i });
      });
    }
    return found;
  }

  // ------------------------------------------------------------- 1 · el reloj

  describe('pregunta 1: casos abiertos y su día del plazo', () => {
    it('clasifica cada caso según su reloj, los ordena por urgencia y deja fuera los cerrados', async () => {
      const sinReloj = await insertClaim({});
      const enPlazo = await insertClaim({ completedDaysAgo: 5 });
      const enRiesgo = await insertClaim({ completedDaysAgo: 26 });
      const vencido = await insertClaim({ completedDaysAgo: 45 });
      const cerrado = await insertClaim({ completedDaysAgo: 45, status: 'pagada' });

      const found = await locate([sinReloj, enPlazo, enRiesgo, vencido, cerrado]);

      expect(found.has(cerrado)).toBe(false); // un caso cerrado no es "abierto"
      expect(found.get(sinReloj)?.clockState).toBe('sin_reloj');
      expect(found.get(enPlazo)?.clockState).toBe('en_plazo');
      expect(found.get(enRiesgo)?.clockState).toBe('en_riesgo');
      expect(found.get(vencido)?.clockState).toBe('vencido');

      const position = (id: string) => found.get(id)!.position;
      expect(position(vencido)).toBeLessThan(position(enRiesgo));
      expect(position(enRiesgo)).toBeLessThan(position(enPlazo));
      expect(position(enPlazo)).toBeLessThan(position(sinReloj));
    });

    it('cada caso con reloj trae el día del plazo en el que va', async () => {
      const id = await insertClaim({ completedDaysAgo: 5 });
      const row = (await locate([id])).get(id)!;
      expect(row.daysElapsed).toBe(5);
      expect(row.daysTotal!).toBeGreaterThanOrEqual(28);
      expect(row.deadlineDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('el resumen es coherente: abiertos = suma de los cuatro estados, y refleja cada estado', async () => {
      await insertClaim({});
      await insertClaim({ completedDaysAgo: 5 });
      await insertClaim({ completedDaysAgo: 26 });
      await insertClaim({ completedDaysAgo: 45 });

      const s = await metrics.clockSummary(db);
      expect(s.open).toBe(s.withoutClock + s.onTime + s.atRisk + s.expired);
      expect(s.withoutClock).toBeGreaterThanOrEqual(1);
      expect(s.onTime).toBeGreaterThanOrEqual(1);
      expect(s.atRisk).toBeGreaterThanOrEqual(1);
      expect(s.expired).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------- 2 · correcciones del modelo

  describe('pregunta 2: cuántas clasificaciones corrigió una persona', () => {
    const empty = (subject: string) => ({
      subject, total: 0, reviewed: 0, confirmed: 0, corrected: 0, abstained: 0, pendingReview: 0,
      correctionRate: null as number | null,
    });
    const rowFor = async (subject: string) =>
      (await metrics.modelCorrections(db)).find((r) => r.subject === subject) ?? empty(subject);

    it('separa acertó, corrigió, se abstuvo y pendiente (tipo de reclamación)', async () => {
      const before = await rowFor('tipo_reclamacion');

      await insertPrediction({ subject: 'tipo_reclamacion', predicted: 'muerte_natural', finalValue: 'muerte_natural' });
      await insertPrediction({ subject: 'tipo_reclamacion', predicted: 'muerte_natural', finalValue: 'muerte_accidental' });
      await insertPrediction({ subject: 'tipo_reclamacion', predicted: 'indeterminado', finalValue: 'muerte_natural' });
      await insertPrediction({ subject: 'tipo_reclamacion', predicted: 'muerte_natural' });

      const after = await rowFor('tipo_reclamacion');
      expect(after.total - before.total).toBe(4);
      expect(after.reviewed - before.reviewed).toBe(3);
      expect(after.confirmed - before.confirmed).toBe(1);
      expect(after.corrected - before.corrected).toBe(1);
      expect(after.abstained - before.abstained).toBe(1);
      expect(after.pendingReview - before.pendingReview).toBe(1);
    });

    it('la tasa es corregidas / (confirmadas + corregidas): las abstenciones no la inflan', async () => {
      const row = await rowFor('tipo_reclamacion');
      expect(row.correctionRate).not.toBeNull();
      expect(row.correctionRate!).toBeCloseTo(row.corrected / (row.confirmed + row.corrected), 3);
    });

    it('una abstención de validez (requiere_revision) resuelta a válido no cuenta como corrección', async () => {
      const before = await rowFor('validez_documento');

      await insertPrediction({ subject: 'validez_documento', predicted: 'requiere_revision', finalValue: 'valido' });
      await insertPrediction({ subject: 'validez_documento', predicted: 'valido', finalValue: 'invalido' });

      const after = await rowFor('validez_documento');
      expect(after.abstained - before.abstained).toBe(1);
      expect(after.corrected - before.corrected).toBe(1);
      expect(after.confirmed - before.confirmed).toBe(0);
    });
  });

  // -------------------------------------------------- 3 · primera respuesta

  describe('pregunta 3: tiempo hasta decirle al beneficiario qué le falta', () => {
    const hoursFor = async (claimId: string): Promise<number | null> => {
      const { rows } = await db.query<{ h: string | null }>(
        'SELECT hours_to_first_response AS h FROM v_first_response WHERE claim_id = $1',
        [claimId],
      );
      return rows[0].h === null ? null : Number(rows[0].h);
    };

    it('cuenta solo avisos útiles ya enviados al beneficiario', async () => {
      const received = new Date(Date.now() - 6 * HOUR);

      const respondido = await insertClaim({ receivedAt: received });
      await insertNotification(respondido, { kind: 'faltantes', sentAt: new Date(received.getTime() + 2 * HOUR) });

      const soloAcuse = await insertClaim({ receivedAt: received });
      await insertNotification(soloAcuse, { kind: 'acuse_radicacion', sentAt: new Date(received.getTime() + HOUR) });

      const pendiente = await insertClaim({ receivedAt: received });
      await insertNotification(pendiente, { kind: 'faltantes' }); // sin sent_at: todavía no salió

      const soloAlertaInterna = await insertClaim({ receivedAt: received });
      await insertNotification(soloAlertaInterna, {
        kind: 'alerta_riesgo', audience: 'analistas', sentAt: new Date(),
      });

      expect(await hoursFor(respondido)).toBeCloseTo(2, 1);
      expect(await hoursFor(soloAcuse)).toBeNull();
      expect(await hoursFor(pendiente)).toBeNull();
      expect(await hoursFor(soloAlertaInterna)).toBeNull();
    });

    it('si hay varios avisos útiles, cuenta el primero', async () => {
      const received = new Date(Date.now() - 10 * HOUR);
      const id = await insertClaim({ receivedAt: received });
      await insertNotification(id, { kind: 'documento_invalido', sentAt: new Date(received.getTime() + 3 * HOUR) });
      await insertNotification(id, { kind: 'faltantes', sentAt: new Date(received.getTime() + 1 * HOUR) });
      expect(await hoursFor(id)).toBeCloseTo(1, 1);
    });

    it('los casos sin respuesta no se esconden: se cuentan aparte y se reporta cuánto lleva esperando el más antiguo', async () => {
      await insertClaim({ receivedAt: new Date(Date.now() - 3 * HOUR) }); // sin ningún aviso

      const s = await metrics.firstResponse(db);
      expect(s.total).toBe(s.responded + s.withoutResponse);
      expect(s.withoutResponse).toBeGreaterThanOrEqual(1);
      expect(s.oldestWaitingHours!).toBeGreaterThanOrEqual(3);
    });

    it('trae promedio, mediana, p90 y máximo como números', async () => {
      const received = new Date(Date.now() - 5 * HOUR);
      const id = await insertClaim({ receivedAt: received });
      await insertNotification(id, { kind: 'expediente_completo', sentAt: new Date(received.getTime() + HOUR) });

      const s = await metrics.firstResponse(db);
      for (const value of [s.avgHours, s.medianHours, s.p90Hours, s.maxHours]) {
        expect(typeof value).toBe('number'); // number, no texto
      }
      expect(s.p90Hours!).toBeGreaterThanOrEqual(s.medianHours!);
      expect(s.maxHours!).toBeGreaterThanOrEqual(s.p90Hours!);
    });
  });

  // ------------------------------------------------------ 4 · reconstrucción

  describe('pregunta 4: reconstruir la historia de un caso', () => {
    it('la línea de tiempo de un caso sale completa y en orden', async () => {
      const id = await insertClaim({}); // ya trae el evento de recepción
      await audit.record(db, { claimId: id, type: AUDIT_EVENTS.EXPEDIENTE_EVALUADO, actor: 'sistema' });
      await audit.record(db, { claimId: id, type: AUDIT_EVENTS.EXPEDIENTE_COMPLETO, actor: 'sistema' });

      const timeline = await audit.timeline(id);
      expect(timeline.map((e) => e.eventType)).toEqual([
        'reclamacion_recibida', 'expediente_evaluado', 'expediente_completo',
      ]);
      const ids = timeline.map((e) => e.eventId);
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
    });

    it('el evento de un analista muestra su nombre', async () => {
      const id = await insertClaim({});
      await audit.record(db, {
        claimId: id, type: AUDIT_EVENTS.EXPEDIENTE_EVALUADO, actor: 'analista', actorUserId: analystId,
      });
      const last = (await audit.timeline(id)).at(-1)!;
      expect(last.actorName).toBe('Analista de métricas');
    });

    it('el caso al azar existe y los casos sin historia se detectan y se corrigen', async () => {
      const random = await metrics.randomClaim(db);
      expect(random).not.toBeNull();
      expect(random!.referenceCode).toEqual(expect.any(String));

      const before = await metrics.claimsWithoutEvents(db);

      const huerfano = await insertClaim({ withEvent: false });
      expect(await metrics.claimsWithoutEvents(db)).toBe(before + 1);

      await audit.record(db, { claimId: huerfano, type: AUDIT_EVENTS.RECLAMACION_RECIBIDA, actor: 'sistema' });
      expect(await metrics.claimsWithoutEvents(db)).toBe(before);
    });
  });
});