  import { Injectable } from '@nestjs/common';
  import { EntityRepository } from '@mikro-orm/postgresql';
  import { InjectRepository } from '@mikro-orm/nestjs';
  import { Game } from './entities/game.entity';
  import { CreateGameDto } from './dto/create-game.dto';
  import { UpdateGameDto } from './dto/update-game.dto';
  
  @Injectable()
  export class GamesService {
    constructor(
      @InjectRepository(Game)
      private readonly gameRepository: EntityRepository<Game>,
    ) {}

    async findAll() {
      return this.gameRepository.findAll();
    }

    async create(createGameDto: CreateGameDto) {
      const game = this.gameRepository.create(createGameDto);

      await this.gameRepository.getEntityManager().flush();

      return game;
    }

    async findOne(id: number) {
    return this.gameRepository.findOne({ id });
  }

    async update(id: number, updateGameDto: UpdateGameDto) {
      const game = await this.gameRepository.findOne({ id });

    if (!game) {
    return null;
  }

  this.gameRepository.assign(game, updateGameDto);

  await this.gameRepository.getEntityManager().flush();

  return game;
}
  async remove(id: number) {
    const game = await this.gameRepository.findOne({ id });

  if (!game) {
    return null;
  }

  await this.gameRepository.getEntityManager().remove(game).flush();

  return game;
}
  }