import {
  Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Query, Res, UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { parseInput } from '../../common/http/parse-input';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ClaimsRepository } from '../claims/claims.repository';
import { FILE_STORAGE, type FileStorage } from '../documents/file-storage';
import { PanelRepository } from './panel.repository';

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const FILE_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
};

/** Todo el panel está detrás del login: el guard va a nivel de clase para que no se pueda olvidar en un método. */
@Controller('panel')
@UseGuards(JwtAuthGuard)
export class PanelController {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: PanelRepository,
    private readonly claims: ClaimsRepository,
    private readonly audit: AuditService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  @Get('claims')
  async list(@Query() raw: unknown) {
    const { limit, offset } = parseInput(listQuery, raw);
    return { claims: await this.repo.listOpenClaims(this.db, limit, offset), limit, offset };
  }

  @Get('review-queue')
  reviewQueue() {
    return this.repo.reviewQueue(this.db);
  }

  /** Qué llegó, qué determinó el sistema, con qué información y cuándo. */
  @Get('claims/:claimId')
  async detail(@Param('claimId', ParseUUIDPipe) claimId: string) {
    const claim = await this.claims.findById(this.db, claimId);
    if (!claim) throw new NotFoundException();
    const [clock, documents, evaluation, classifications, aiRuns, decisions, timeline] = await Promise.all([
      this.repo.clockFor(this.db, claimId),
      this.repo.documentsDetail(this.db, claimId),
      this.repo.latestEvaluation(this.db, claimId),
      this.repo.classifications(this.db, claimId),
      this.repo.aiRuns(this.db, claimId),
      this.repo.decisions(this.db, claimId),
      this.audit.timeline(claimId),
    ]);
    return { claim, clock, documents, evaluation, classifications, aiRuns, decisions, timeline };
  }

  @Get('claims/:claimId/documents/:documentId/file')
  async file(
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Res() res: Response,
  ) {
    const doc = await this.repo.documentFile(this.db, claimId, documentId);
    if (!doc) throw new NotFoundException();
    const extension = FILE_EXTENSIONS[doc.mimeType];
    const data = await this.storage.read(doc.storagePath);
    res.set({
      'Content-Type': extension ? doc.mimeType : 'application/octet-stream',
      // Nunca el nombre original (lo escribe un desconocido): se arma con el id.
      'Content-Disposition': `${extension ? 'inline' : 'attachment'}; filename="documento-${doc.id}.${extension ?? 'bin'}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    });
    res.send(data);
  }
}