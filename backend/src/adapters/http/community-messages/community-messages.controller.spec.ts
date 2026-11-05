// src/adapters/http/community-messages/community-messages.controller.spec.ts
import { CommunityMessagesController } from './community-messages.controller';
import type { CommunityMessagesService } from '@app/community-messages/community-messages.service';
import type { CommunityMessage } from '@prisma/client';

describe('CommunityMessagesController', () => {
  let controller: CommunityMessagesController;
  let mockService: {
    findAll: jest.Mock;
    create: jest.Mock;
    findById: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    seedDefaults: jest.Mock;
  };

  const sampleMessage: CommunityMessage = {
    id: 'msg-1',
    text: 'Presque dix ans que la GG-Lan existe !',
    category: 'fun_fact',
    active: true,
    tournamentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockService = {
      findAll: jest.fn(),
      create: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      seedDefaults: jest.fn(),
    };

    controller = new CommunityMessagesController(
      mockService as unknown as CommunityMessagesService,
    );
  });

  it('GET /community-messages returns public active messages', async () => {
    mockService.findAll.mockResolvedValueOnce([sampleMessage]);

    const res = await controller.getPublicMessages('tourn-1');
    expect(res).toEqual([sampleMessage]);
    expect(mockService.findAll).toHaveBeenCalledWith({
      activeOnly: true,
      tournamentId: 'tourn-1',
    });
  });

  it('GET /admin/community-messages lists messages with filters', async () => {
    mockService.findAll.mockResolvedValueOnce([sampleMessage]);

    const res = await controller.listMessages('tourn-1', 'true', 'fun_fact');
    expect(res).toEqual([sampleMessage]);
    expect(mockService.findAll).toHaveBeenCalledWith({
      tournamentId: 'tourn-1',
      activeOnly: true,
      category: 'fun_fact',
    });
  });

  it('POST /admin/community-messages creates a message', async () => {
    mockService.create.mockResolvedValueOnce(sampleMessage);

    const res = await controller.createMessage({ text: 'Nouveau message' });
    expect(res).toEqual(sampleMessage);
    expect(mockService.create).toHaveBeenCalledWith({ text: 'Nouveau message' });
  });

  it('GET /admin/community-messages/:id retrieves a message', async () => {
    mockService.findById.mockResolvedValueOnce(sampleMessage);

    const res = await controller.getMessage('msg-1');
    expect(res).toEqual(sampleMessage);
  });

  it('PATCH /admin/community-messages/:id updates a message', async () => {
    mockService.update.mockResolvedValueOnce({ ...sampleMessage, active: false });

    const res = await controller.updateMessage('msg-1', { active: false });
    expect(res.active).toBe(false);
  });

  it('DELETE /admin/community-messages/:id deletes a message', async () => {
    mockService.delete.mockResolvedValueOnce(undefined);

    const res = await controller.deleteMessage('msg-1');
    expect(res).toEqual({ success: true });
  });

  it('POST /admin/community-messages/seed triggers defaults seed', async () => {
    mockService.seedDefaults.mockResolvedValueOnce(3);

    const res = await controller.seedDefaults();
    expect(res).toEqual({ success: true, inserted: 3 });
  });
});
