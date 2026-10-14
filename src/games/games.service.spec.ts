
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import { GamesService } from './games.service';
import { Game } from './entities/game.entity';

describe('GamesService', () => {
  let service: GamesService;

  const mockGameRepository = {
    findAndCount: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GamesService,
        {
          provide: getRepositoryToken(Game),
          useValue: mockGameRepository,
        },
      ],
    }).compile();

    service = module.get<GamesService>(GamesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should paginate games', async () => {
    mockGameRepository.findAndCount.mockResolvedValueOnce([
      [
        {
          id: 1,
          name: 'Cyber Arena',
          genre: 'Action',
          platform: 'PC',
        },
      ],
      2,
    ]);

    const result = await service.findAll({
      page: 1,
      limit: 1,
    });

    expect(mockGameRepository.findAndCount).toHaveBeenCalledWith(
      {},
      {
        limit: 1,
        offset: 0,
        orderBy: { id: 'ASC' },
      },
    );

    expect(result.meta).toEqual({
      total: 2,
      page: 1,
      limit: 1,
      totalPages: 2,
    });
  });

  it('should filter games by name', async () => {
    mockGameRepository.findAndCount.mockResolvedValueOnce([[], 0]);

    await service.findAll({
      page: 1,
      limit: 10,
      name: 'Cyber',
    });

    expect(mockGameRepository.findAndCount).toHaveBeenCalledWith(
      {
        name: { $ilike: '%Cyber%' },
      },
      {
        limit: 10,
        offset: 0,
        orderBy: { id: 'ASC' },
      },
    );
  });
});
