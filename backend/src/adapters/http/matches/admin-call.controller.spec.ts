import { NotFoundException } from '@nestjs/common';
import { AdminCallController } from './admin-call.controller';

describe('AdminCallController', () => {
  let controller: AdminCallController;
  let mockService: any;

  const MATCH_ID = 'm-ctrl-admin-call';

  beforeEach(() => {
    mockService = {
      getCalls: jest.fn().mockResolvedValue([{ id: 'call-1', message: 'test' }]),
      ackCall: jest.fn().mockResolvedValue({ id: 'call-1', status: 'acknowledged' }),
      resolveCall: jest.fn().mockResolvedValue({ id: 'call-1', status: 'resolved' }),
    };

    controller = new AdminCallController(mockService);
  });

  describe('getCalls', () => {
    it('returns calls from service', async () => {
      const res = await controller.getCalls(MATCH_ID);
      expect(res.calls).toHaveLength(1);
      expect(mockService.getCalls).toHaveBeenCalledWith(MATCH_ID);
    });
  });

  describe('ackCall', () => {
    it('acknowledges a call', async () => {
      const req: any = { ggSession: { name: 'AdminBob' } };
      const res = await controller.ackCall(MATCH_ID, 'call-1', req);
      expect(res.success).toBe(true);
      expect(mockService.ackCall).toHaveBeenCalledWith(MATCH_ID, 'call-1', 'AdminBob');
    });

    it('throws NotFoundException if call not found', async () => {
      mockService.ackCall.mockResolvedValueOnce(null);
      const req: any = { ggSession: { name: 'AdminBob' } };
      await expect(controller.ackCall(MATCH_ID, 'unknown', req)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('resolveCall', () => {
    it('resolves a call', async () => {
      const req: any = { ggSession: { name: 'AdminAlice' } };
      const res = await controller.resolveCall(MATCH_ID, 'call-1', req);
      expect(res.success).toBe(true);
      expect(mockService.resolveCall).toHaveBeenCalledWith(MATCH_ID, 'call-1', 'AdminAlice');
    });
  });
});
