import { IsEmail, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto {
  @ApiPropertyOptional({
    example: 'Guilherme Rodrigues',
    description: 'Updated user name',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    example: 'guilherme@email.com',
    description: 'Updated user email',
  })
  @IsOptional()
  @IsEmail()
  email?: string;
}