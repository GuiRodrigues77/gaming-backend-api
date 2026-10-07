import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { GamesModule } from './games/games.module';
import { GameSessionsModule } from './game-sessions/game-sessions.module';
import config from '../mikro-orm.config';

@Module({
  imports: [
    MikroOrmModule.forRoot(config),
    UsersModule,
    GamesModule,
    GameSessionsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}