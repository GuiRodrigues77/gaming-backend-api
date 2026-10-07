import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { GameSessionsService } from './game-sessions.service';
import { CreateGameSessionDto } from './dto/create-game-session.dto';

@ApiTags('Game Sessions')
@Controller('game-sessions')
export class GameSessionsController {
  constructor(
    private readonly gameSessionsService: GameSessionsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all game sessions' })
  @ApiResponse({
    status: 200,
    description: 'Game sessions successfully retrieved.',
  })
  findAll() {
    return this.gameSessionsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a game session by ID' })
  @ApiParam({
    name: 'id',
    description: 'Game session ID',
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: 'Game session successfully retrieved.',
  })
  findOne(@Param('id') id: string) {
    return this.gameSessionsService.findOne(Number(id));
  }

  @Post()
@ApiOperation({ summary: 'Create a new game session' })
@ApiResponse({
  status: 201,
  description: 'Game session successfully created.',
})
@ApiResponse({
  status: 400,
  description: 'Invalid game session data.',
})
create(@Body() createGameSessionDto: CreateGameSessionDto) {
  return this.gameSessionsService.create(createGameSessionDto);
}

}