import { Injectable } from '@nestjs/common';
import { ActivityQueryDto } from './dto/activity-query.dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ActivityService {
  constructor(private prisma: PrismaService) {}

  async getMyActivity(query: ActivityQueryDto) {
    const { filterMilestones, search } = query;
    
    const where: any = {};

    if (filterMilestones) {
      where.type = 'MILESTONE';
    }

    if (search) {
      where.description = { contains: search, mode: 'insensitive' };
    }

    return this.prisma.activity.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }
}
