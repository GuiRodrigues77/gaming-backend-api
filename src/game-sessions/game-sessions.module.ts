import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { GameSession } from './entities/game-session.entity';
import { GameSessionsController } from './game-sessions.controller';
import { GameSessionsService } from './game-sessions.service';

@Module({
  imports: [MikroOrmModule.forFeature([GameSession])],
  controllers: [GameSessionsController],
  providers: [GameSessionsService],
})
export class GameSessionsModule {}