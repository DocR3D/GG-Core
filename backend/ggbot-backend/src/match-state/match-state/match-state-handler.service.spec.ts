import { Test, TestingModule } from '@nestjs/testing';
import { MatchStateHandlerService } from './match-state-handler.service';

describe('MatchStateHandlerService', () => {
  let service: MatchStateHandlerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MatchStateHandlerService],
    }).compile();

    service = module.get<MatchStateHandlerService>(MatchStateHandlerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
