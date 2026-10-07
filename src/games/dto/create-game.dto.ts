import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateGameDto {
  @ApiProperty({
    example: 'Cyber Arena',
    description: 'Game name',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    example: 'Action',
    description: 'Game genre',
  })
  @IsString()
  @IsNotEmpty()
  genre!: string;

  @ApiProperty({
    example: 'PC',
    description: 'Game platform',
  })
  @IsString()
  @IsNotEmpty()
  platform!: string;
}