import { Test, TestingModule } from '@nestjs/testing';
import { Cs2LogsService } from './cs2-logs.service';

describe('Cs2LogsService', () => {
  let service: Cs2LogsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [Cs2LogsService],
    }).compile();

    service = module.get<Cs2LogsService>(Cs2LogsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
