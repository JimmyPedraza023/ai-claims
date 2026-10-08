import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { parseInput } from '../../common/http/parse-input';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/jwt-auth.guard';
import { CorrectionsService } from './corrections.service';
import { claimTypeCorrectionSchema, documentCorrectionSchema } from './corrections.schema';

@Controller('panel/claims/:claimId')
@UseGuards(JwtAuthGuard)
export class CorrectionsController {
  constructor(private readonly service: CorrectionsService) {}

  @Post('corrections/claim-type')
  @HttpCode(200)
  correctClaimType(
    @CurrentUser() user: AuthUser,
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Body() body: unknown,
  ) {
    const { claimType } = parseInput(claimTypeCorrectionSchema, body);
    return this.service.correctClaimType(user, claimId, claimType);
  }

  @Post('documents/:documentId/corrections')
  @HttpCode(200)
  correctDocument(
    @CurrentUser() user: AuthUser,
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() body: unknown,
  ) {
    return this.service.correctDocument(user, claimId, documentId, parseInput(documentCorrectionSchema, body));
  }
}