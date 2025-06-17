import { Body, Controller, Post, Req } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { ProcessDTO } from './dto/process.dto';
import { getUser } from 'src/common/utils/user';
import { Request } from 'express';

@Controller('monitoring')
export class MonitoringController {
  constructor(private readonly monitoringService: MonitoringService) { }

  @Post('/process')
  updateProcess(@Body() processDTO) {
    // return this.monitoringService.processLinkPublicV1(processDTO)
  }
}
