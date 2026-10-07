import {
  Controller,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';

import { ClockWatchGuard } from './clock-watch.guard';
import { ClockWatchService } from './clock-watch.service';

@Controller('internal')
export class ClockWatchController {
  constructor(private readonly service: ClockWatchService) {}

  @Post('clock-watch')
  @HttpCode(200)
  @UseGuards(ClockWatchGuard)
  run() {
    return this.service.run();
  }
}