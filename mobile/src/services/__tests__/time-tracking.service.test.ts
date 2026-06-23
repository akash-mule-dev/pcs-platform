import { timeTrackingService } from '../time-tracking.service';

jest.mock('../api.service', () => ({
  api: {
    post: jest.fn(),
    get: jest.fn(),
    getList: jest.fn(),
  },
}));

const { api } = require('../api.service');

describe('time-tracking.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('clockIn', () => {
    it('calls POST /time-tracking/clock-in with inputMethod=mobile', async () => {
      const mockEntry = { id: 'e1', startTime: '2026-04-17T10:00:00Z' };
      api.post.mockResolvedValue(mockEntry);

      const result = await timeTrackingService.clockIn('stage-123');

      expect(api.post).toHaveBeenCalledWith('/time-tracking/clock-in', {
        workOrderStageId: 'stage-123',
        stationId: undefined,
        inputMethod: 'mobile',
      });
      expect(result).toEqual(mockEntry);
    });

    it('includes optional stationId when provided', async () => {
      api.post.mockResolvedValue({ id: 'e2' });

      await timeTrackingService.clockIn('stage-456', 'station-abc');

      expect(api.post).toHaveBeenCalledWith('/time-tracking/clock-in', {
        workOrderStageId: 'stage-456',
        stationId: 'station-abc',
        inputMethod: 'mobile',
      });
    });

    it('propagates API errors (e.g. already has active entry)', async () => {
      api.post.mockRejectedValue(new Error('User already has an active time entry'));

      await expect(timeTrackingService.clockIn('stage-1')).rejects.toThrow(
        'User already has an active time entry',
      );
    });
  });

  describe('clockOut', () => {
    it('calls POST /time-tracking/clock-out with timeEntryId', async () => {
      const mockEntry = { id: 'e1', endTime: '2026-04-17T11:00:00Z', durationSeconds: 3600 };
      api.post.mockResolvedValue(mockEntry);

      const result = await timeTrackingService.clockOut('entry-xyz');

      expect(api.post).toHaveBeenCalledWith('/time-tracking/clock-out', {
        timeEntryId: 'entry-xyz',
        notes: undefined,
      });
      expect(result).toEqual(mockEntry);
    });

    it('includes optional notes when provided', async () => {
      api.post.mockResolvedValue({ id: 'e1' });

      await timeTrackingService.clockOut('entry-xyz', 'Completed stage 1');

      expect(api.post).toHaveBeenCalledWith('/time-tracking/clock-out', {
        timeEntryId: 'entry-xyz',
        notes: 'Completed stage 1',
      });
    });
  });

  describe('getActive', () => {
    it('calls GET /time-tracking/active', async () => {
      const mockList = [
        { id: 'e1', user: { firstName: 'John' }, endTime: null },
        { id: 'e2', user: { firstName: 'Jane' }, endTime: null },
      ];
      api.getList.mockResolvedValue(mockList);

      const result = await timeTrackingService.getActive();

      expect(api.getList).toHaveBeenCalledWith('/time-tracking/active');
      expect(result).toEqual(mockList);
    });

    it('returns empty array when no active entries', async () => {
      api.getList.mockResolvedValue([]);

      const result = await timeTrackingService.getActive();

      expect(result).toEqual([]);
    });
  });

  describe('getHistory', () => {
    it('calls GET /time-tracking/history without params', async () => {
      const mockHistory = [{ id: 'e1', durationSeconds: 1200 }];
      api.getList.mockResolvedValue(mockHistory);

      const result = await timeTrackingService.getHistory();

      expect(api.getList).toHaveBeenCalledWith('/time-tracking/history', undefined);
      expect(result).toEqual(mockHistory);
    });

    it('passes pagination + filter params', async () => {
      api.getList.mockResolvedValue([]);

      await timeTrackingService.getHistory({
        page: 1,
        limit: 20,
        userId: 'user-123',
        startDate: '2026-01-01',
        endDate: '2026-04-17',
      });

      expect(api.getList).toHaveBeenCalledWith('/time-tracking/history', {
        page: 1,
        limit: 20,
        userId: 'user-123',
        startDate: '2026-01-01',
        endDate: '2026-04-17',
      });
    });
  });
});
