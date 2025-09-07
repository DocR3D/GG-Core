import { Test, TestingModule } from '@nestjs/testing';
import { CommandsProcessorService } from './commands-processor.service';

describe('CommandsProcessorService', () => {
  let service: CommandsProcessorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CommandsProcessorService],
    }).compile();

    service = module.get<CommandsProcessorService>(CommandsProcessorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
