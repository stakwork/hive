import { Controller, Get, Query } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { ActivityQueryDto } from './dto/activity-query.dto';

@Controller('activity')
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Get('my-activity')
  async getMyActivity(@Query() query: ActivityQueryDto) {
    return this.activityService.getMyActivity(query);
  }
}
