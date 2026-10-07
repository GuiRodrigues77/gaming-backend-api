import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateGameDto {
  @ApiPropertyOptional({
    example: 'Cyber Arena 2',
    description: 'Updated game name',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    example: 'RPG',
    description: 'Updated game genre',
  })
  @IsOptional()
  @IsString()
  genre?: string;

  @ApiPropertyOptional({
    example: 'PC',
    description: 'Updated game platform',
  })
  @IsOptional()
  @IsString()
  platform?: string;
}