import { IsOptional, IsString, IsBoolean } from 'class-validator';

export class ActivityQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsBoolean()
  filterMilestones?: boolean;

  @IsOptional()
  @IsString()
  sort?: string;
}
