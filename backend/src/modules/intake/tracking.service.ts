// backend/src/modules/intake/tracking.service.ts
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { ClaimsService } from '../claims/claims.service';
import { DocumentsService } from '../documents/documents.service';
import { buildTrackingView } from './tracking.view';
import type { TrackingView } from './tracking.view';

/** randomBytes(32) en base64url mide siempre 43 caracteres: cualquier otra cosa ni se consulta. */
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

@Injectable()
export class TrackingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly claims: ClaimsService,
    private readonly documents: DocumentsService,
  ) {}

  /** Devuelve null si el token no corresponde a ningún caso: el llamador no distingue el motivo. */
  async view(token: string): Promise<TrackingView | null> {
    if (!TOKEN_FORMAT.test(token)) return null;

    const claim = await this.claims.findByTrackingToken(this.db, token);
    if (!claim) return null;

    const documents = await this.documents.listByClaim(this.db, claim.id);
    return buildTrackingView(claim, documents);
  }
}