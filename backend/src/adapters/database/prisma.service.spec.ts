import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should handle onModuleInit gracefully when database is unavailable', async () => {
    jest.spyOn(service, '$connect').mockRejectedValueOnce(new Error('Connection refused'));
    await expect(service.onModuleInit()).resolves.not.toThrow();
  });

  it('should handle onModuleDestroy gracefully', async () => {
    jest.spyOn(service, '$disconnect').mockResolvedValueOnce(undefined);
    await expect(service.onModuleDestroy()).resolves.not.toThrow();
  });
});
