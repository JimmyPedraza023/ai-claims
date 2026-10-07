// modules/clock-watch/clock-watch.service.ts
// AJUSTA los nombres de columna a lo que devuelva fn_claim_clock() (0004_metrics.sql).

import { Injectable } from "@nestjs/common/decorators/core/index.js";
import { Logger } from "@nestjs/common/services/index.js";
import { ConfigService } from "@nestjs/config";
import {NotificationsRepository} from "../notifications/notifications.repository.js";
import {JobsRepository} from "../jobs/jobs.repository.js";
import {AuditService} from "../audit/audit.service.js";
import {draftClockAlert} from "./clock-alerts.js";
import {DatabaseService} from "../../database/database.service.js";
import {AUDIT_EVENTS} from "../audit/event-types.js";
import { Env } from "../../config/env.schema.js";
 

interface ClockRow {
  claim_id: string;
  reference_code: string;
  deadline_date: string; 
  day_of_term: number;
  days_remaining: number;
  clock_state: 'en_plazo' | 'en_riesgo' | 'vencido';
  days_elapsed: number;
  days_total: number;
}

@Injectable()
export class ClockWatchService {
  private readonly logger = new Logger(ClockWatchService.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly db: DatabaseService,
    private readonly notifications: NotificationsRepository,
    private readonly jobs: JobsRepository,
    private readonly audit: AuditService,
  ) {}

  async run() {
    const analystEmail = this.config.get('ANALYST_ALERT_EMAIL', { infer: true });
    if (!analystEmail) throw new Error('ANALYST_ALERT_EMAIL es obligatoria para la vigilancia del reloj');

    const { rows: runRows } = await this.db.query<{ id: string }>(
      'INSERT INTO clock_watch_runs DEFAULT VALUES RETURNING id');
    const runId = runRows[0].id;

    try {
      const { rows } = await this.db.query<ClockRow>(
        `SELECT claim_id, reference_code,
                to_char(deadline_date, 'YYYY-MM-DD') AS deadline_date,
                days_elapsed, days_total, days_remaining, clock_state
            FROM fn_claim_clock()
            WHERE clock_state IN ('en_riesgo', 'vencido')`,
        );
      let created = 0, failed = 0;

      for (const row of rows) {
        try {
          created += (await this.alert(row, analystEmail)) ? 1 : 0;
        } catch (err) {
          failed++;
          this.logger.error({ msg: 'Falló la alerta del reloj', claimId: row.claim_id,
                              error: err instanceof Error ? err.name : 'error' });
        }
      }

      const summary = {
        checked: rows.length,
        atRisk: rows.filter((r) => r.clock_state === 'en_riesgo').length,
        expired: rows.filter((r) => r.clock_state === 'vencido').length,
        alertsCreated: created, failed,
      };
      await this.db.query(
        `UPDATE clock_watch_runs SET finished_at = now(), claims_checked = $2, at_risk = $3,
                expired = $4, alerts_created = $5, failed = $6 WHERE id = $1`,
        [runId, summary.checked, summary.atRisk, summary.expired, summary.alertsCreated, summary.failed]);

      if (failed === 0) await this.pingHeartbeat();
      return summary;
    } catch (err) {
      await this.db.query('UPDATE clock_watch_runs SET finished_at = now(), error = $2 WHERE id = $1',
        [runId, err instanceof Error ? err.name : 'error']);
      throw err;
    }
  }

  /** true si creó una alerta nueva. */
  private alert(row: ClockRow, analystEmail: string): Promise<boolean> {
    const kind = row.clock_state === 'vencido' ? 'alerta_vencido' : 'alerta_riesgo';
    const draft = draftClockAlert(kind, row.claim_id, {
        referenceCode: row.reference_code,
        deadlineDate: row.deadline_date,
        daysElapsed: row.days_elapsed,
        daysTotal: row.days_total,
        daysRemaining: row.days_remaining,
    });
    return this.db.withTransaction(async (c) => {
      const id = await this.notifications.insertIfNew(c, {
        claimId: row.claim_id, kind, audience: 'analistas', recipient: analystEmail,
        subject: draft.subject, body: draft.body, dedupeKey: draft.dedupeKey,
      });
      if (!id) return false; // ya se avisó: repetir la corrida no reenvía nada
      await this.jobs.enqueue(c, { kind: 'enviar_aviso', claimId: row.claim_id,
                                   notificationId: id, dedupeKey: `aviso:${id}` });
      await this.audit.record(c, {
        claimId: row.claim_id, actor: 'sistema',
        type: kind === 'alerta_vencido' ? AUDIT_EVENTS.RELOJ_VENCIDO : AUDIT_EVENTS.RELOJ_EN_RIESGO,
        payload: { daysElapsed: row.days_elapsed, daysTotal: row.days_total, deadlineDate: row.deadline_date },
      });
      return true;
    });
  }

  private async pingHeartbeat(): Promise<void> {
    const url = this.config.get('CLOCK_WATCH_PING_URL', { infer: true });
    if (!url) return;
    try {
      await fetch(url, { method: 'POST', signal: AbortSignal.timeout(5_000) });
    } catch { /* el latido no debe tumbar la corrida */ }
  }
}