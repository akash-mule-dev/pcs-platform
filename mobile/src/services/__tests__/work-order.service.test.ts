import { workOrderService } from '../work-order.service';

jest.mock('../api.service', () => ({
  api: {
    get: jest.fn(),
    getList: jest.fn(),
    patch: jest.fn(),
  },
}));

const { api } = require('../api.service');

describe('work-order.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAll', () => {
    it('calls GET /work-orders without params', async () => {
      const mockList = [
        { id: 'wo1', orderNumber: 'WO-2026-0001', status: 'in_progress' },
      ];
      api.getList.mockResolvedValue(mockList);

      const result = await workOrderService.getAll();

      expect(api.getList).toHaveBeenCalledWith('/work-orders', undefined);
      expect(result).toEqual(mockList);
    });

    it('passes filter params (status, priority, page)', async () => {
      api.getList.mockResolvedValue([]);

      await workOrderService.getAll({ status: 'in_progress', limit: 50 });

      expect(api.getList).toHaveBeenCalledWith('/work-orders', {
        status: 'in_progress',
        limit: 50,
      });
    });
  });

  describe('getById', () => {
    it('calls GET /work-orders/:id', async () => {
      const mockWO = {
        id: 'wo-123',
        orderNumber: 'WO-2026-0005',
        stages: [
          { id: 's1', status: 'pending', stage: { name: 'Cutting' } },
        ],
      };
      api.get.mockResolvedValue(mockWO);

      const result = await workOrderService.getById('wo-123');

      expect(api.get).toHaveBeenCalledWith('/work-orders/wo-123');
      expect(result).toEqual(mockWO);
    });

    it('propagates 404 for non-existent WO', async () => {
      api.get.mockRejectedValue(new Error('Work order not found'));

      await expect(workOrderService.getById('nope')).rejects.toThrow(
        'Work order not found',
      );
    });
  });

  describe('updateStatus', () => {
    it('calls PATCH /work-orders/:id/status', async () => {
      const mockWO = { id: 'wo1', status: 'in_progress' };
      api.patch.mockResolvedValue(mockWO);

      const result = await workOrderService.updateStatus('wo1', 'in_progress');

      expect(api.patch).toHaveBeenCalledWith('/work-orders/wo1/status', {
        status: 'in_progress',
      });
      expect(result).toEqual(mockWO);
    });

    it('propagates invalid transition errors', async () => {
      api.patch.mockRejectedValue(new Error('Invalid status transition'));

      await expect(workOrderService.updateStatus('wo1', 'completed')).rejects.toThrow(
        'Invalid status transition',
      );
    });
  });

  describe('updateStageStatus', () => {
    it('calls PATCH /work-orders/:id/stages/:stageId/status', async () => {
      const mockWO = {
        id: 'wo1',
        stages: [{ id: 'stage1', status: 'completed' }],
      };
      api.patch.mockResolvedValue(mockWO);

      const result = await workOrderService.updateStageStatus(
        'wo1',
        'stage1',
        'completed',
      );

      expect(api.patch).toHaveBeenCalledWith(
        '/work-orders/wo1/stages/stage1/status',
        { status: 'completed' },
      );
      expect(result).toEqual(mockWO);
    });
  });
});
