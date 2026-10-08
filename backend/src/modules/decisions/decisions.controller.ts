import {
  BadRequestException, Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/jwt-auth.guard';
import { DecisionsService } from './decisions.service';
import { decisionSchema } from './decisions.schema';

@Controller('panel/claims/:claimId/decisions')
@UseGuards(JwtAuthGuard)
export class DecisionsController {
  constructor(private readonly service: DecisionsService) {}

  @Post()
  @HttpCode(201)
  register(
    @CurrentUser() user: AuthUser,
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Body() body: unknown,
  ) {
    const parsed = decisionSchema.safeParse(body);
    if (!parsed.success) {
      // Mismo formato que el resto de la API: errors con field y message.
      throw new BadRequestException({
        errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    return this.service.register(user, claimId, parsed.data);
  }
}