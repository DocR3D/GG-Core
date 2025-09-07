import { Test, TestingModule } from '@nestjs/testing';
import { Cs2LogsController } from './cs2-logs.controller';

describe('Cs2LogsController', () => {
  let controller: Cs2LogsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [Cs2LogsController],
    }).compile();

    controller = module.get<Cs2LogsController>(Cs2LogsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
