import { Injectable } from '@nestjs/common';
import { EntityRepository } from '@mikro-orm/postgresql';
import { InjectRepository } from '@mikro-orm/nestjs';
import { GameSession } from './entities/game-session.entity';
import { CreateGameSessionDto } from './dto/create-game-session.dto';
import { User } from '../users/entities/user.entity';
import { Game } from '../games/entities/game.entity';

@Injectable()
export class GameSessionsService {
  constructor(
    @InjectRepository(GameSession)
    private readonly gameSessionRepository: EntityRepository<GameSession>,
  ) {}

  async findAll() {
    return this.gameSessionRepository.findAll();
  }

  async findOne(id: number) {
    return this.gameSessionRepository.findOne({ id });
  }

  async create(createGameSessionDto: CreateGameSessionDto) {
  const user = this.gameSessionRepository
    .getEntityManager()
    .getReference(User, createGameSessionDto.userId);

  const game = this.gameSessionRepository
    .getEntityManager()
    .getReference(Game, createGameSessionDto.gameId);

  const session = this.gameSessionRepository.create({
    user,
    game,
    durationMinutes: createGameSessionDto.durationMinutes,
    startedAt: createGameSessionDto.startedAt,
  });

  await this.gameSessionRepository.getEntityManager().flush();

  return session;
}
}