import { api } from './api.service';
import { TimeEntry } from '../types';

export const timeTrackingService = {
  async clockIn(workOrderStageId: string, stationId?: string): Promise<TimeEntry> {
    return api.post<TimeEntry>('/time-tracking/clock-in', {
      workOrderStageId,
      stationId,
      inputMethod: 'mobile',
    });
  },

  async clockOut(timeEntryId: string, notes?: string): Promise<TimeEntry> {
    return api.post<TimeEntry>('/time-tracking/clock-out', {
      timeEntryId,
      notes,
    });
  },

  async getActive(): Promise<TimeEntry[]> {
    return api.get<TimeEntry[]>('/time-tracking/active');
  },

  async getHistory(params?: Record<string, string | number>): Promise<TimeEntry[]> {
    return api.get<TimeEntry[]>('/time-tracking/history', params);
  },
};
