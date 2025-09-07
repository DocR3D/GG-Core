import { Test, TestingModule } from '@nestjs/testing';
import { MatchStateService } from './match-state.service';

describe('MatchStateService', () => {
  let service: MatchStateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MatchStateService],
    }).compile();

    service = module.get<MatchStateService>(MatchStateService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
