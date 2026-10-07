import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Patch,
  Delete,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { GamesService } from './games.service';
import { CreateGameDto } from './dto/create-game.dto';
import { UpdateGameDto } from './dto/update-game.dto';

@ApiTags('Games')
@Controller('games')
export class GamesController {
  constructor(private readonly gamesService: GamesService) {}

  @Get()
  @ApiOperation({ summary: 'List all games' })
  @ApiResponse({ status: 200, description: 'Games successfully retrieved.' })
  findAll() {
    return this.gamesService.findAll();
  }
  @Get(':id')
@ApiOperation({ summary: 'Get a game by ID' })
@ApiParam({ name: 'id', description: 'Game ID', example: 1 })
@ApiResponse({ status: 200, description: 'Game successfully retrieved.' })
findOne(@Param('id') id: string) {
  return this.gamesService.findOne(Number(id));
}
  @Post()
  @ApiOperation({ summary: 'Create a new game' })
  @ApiResponse({ status: 201, description: 'Game successfully created.' })
  @ApiResponse({ status: 400, description: 'Invalid game data.' })
  create(@Body() createGameDto: CreateGameDto) {
    return this.gamesService.create(createGameDto);
  }
  @Patch(':id')
@ApiOperation({ summary: 'Update a game' })
@ApiParam({ name: 'id', description: 'Game ID', example: 1 })
@ApiResponse({ status: 200, description: 'Game successfully updated.' })
@ApiResponse({ status: 400, description: 'Invalid game data.' })
update(
  @Param('id') id: string,
  @Body() updateGameDto: UpdateGameDto,
) {
  return this.gamesService.update(Number(id), updateGameDto);
}

@Delete(':id')
@ApiOperation({ summary: 'Delete a game' })
@ApiParam({ name: 'id', description: 'Game ID', example: 1 })
@ApiResponse({ status: 200, description: 'Game successfully deleted.' })
@ApiResponse({ status: 404, description: 'Game not found.' })
remove(@Param('id') id: string) {
  return this.gamesService.remove(Number(id));
}

}