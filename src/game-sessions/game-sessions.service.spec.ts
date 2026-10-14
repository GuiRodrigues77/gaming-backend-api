
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import { GameSessionsService } from './game-sessions.service';
import { GameSession } from './entities/game-session.entity';

describe('GameSessionsService', () => {
  let service: GameSessionsService;

  const mockGameSessionRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    create: jest.fn(),
    persistAndFlush: jest.fn(),
    assign: jest.fn(),
    flush: jest.fn(),
    removeAndFlush: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameSessionsService,
        {
          provide: getRepositoryToken(GameSession),
          useValue: mockGameSessionRepository,
        },
      ],
    }).compile();

    service = module.get<GameSessionsService>(GameSessionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
