
import { Test, TestingModule } from '@nestjs/testing';
import { GameSessionsController } from './game-sessions.controller';
import { GameSessionsService } from './game-sessions.service';

describe('GameSessionsController', () => {
  let controller: GameSessionsController;

  const mockGameSessionsService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GameSessionsController],
      providers: [
        {
          provide: GameSessionsService,
          useValue: mockGameSessionsService,
        },
      ],
    }).compile();

    controller = module.get<GameSessionsController>(
      GameSessionsController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
