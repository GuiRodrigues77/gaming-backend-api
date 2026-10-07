import { Test, TestingModule } from '@nestjs/testing';
import { GameSessionsController } from './game-sessions.controller';

describe('GameSessionsController', () => {
  let controller: GameSessionsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GameSessionsController],
    }).compile();

    controller = module.get<GameSessionsController>(GameSessionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
