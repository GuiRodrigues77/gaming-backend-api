import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({
    example: 'Guilherme',
    description: 'User name',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    example: 'guilherme@email.com',
    description: 'User email',
  })
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}