import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsPositive } from 'class-validator';

export class CreateGameSessionDto {
  @ApiProperty({
    example: 1,
    description: 'ID of the user',
  })
  @IsInt()
  @IsPositive()
  @IsNotEmpty()
  userId!: number;

  @ApiProperty({
    example: 1,
    description: 'ID of the game',
  })
  @IsInt()
  @IsPositive()
  @IsNotEmpty()
  gameId!: number;

  @ApiProperty({
    example: 45,
    description: 'Session duration in minutes',
  })
  @IsInt()
  @IsPositive()
  @IsNotEmpty()
  durationMinutes!: number;

  @ApiProperty({
    example: '2026-10-06T20:00:00.000Z',
    description: 'Session start date and time',
  })
  @IsNotEmpty()
  startedAt!: Date;
}