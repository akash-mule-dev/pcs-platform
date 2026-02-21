import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface TimeEntry {
  id: string;
  userId: string;
  user?: { id: string; firstName: string; lastName: string };
  workOrderStageId: string;
  workOrderStage?: {
    id: string;
    status: string;
    workOrder?: { id: string; orderNumber: string };
    stage?: { id: string; name: string; targetTimeSeconds: number; sequence: number };
  };
  stationId: string | null;
  startTime: string;
  endTime: string | null;
  durationSeconds: number | null;
  breakSeconds: number;
  idleSeconds: number;
  inputMethod: string;
  isRework: boolean;
  notes: string | null;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class TimeTrackingService {
  constructor(private api: ApiService) {}

  clockIn(workOrderStageId: string, stationId?: string): Observable<TimeEntry> {
    return this.api.post<TimeEntry>('/time-tracking/clock-in', {
      workOrderStageId,
      stationId: stationId || undefined,
      inputMethod: 'mobile'
    });
  }

  clockOut(timeEntryId: string, notes?: string): Observable<TimeEntry> {
    return this.api.post<TimeEntry>('/time-tracking/clock-out', {
      timeEntryId,
      notes: notes || undefined
    });
  }

  getActive(): Observable<TimeEntry[]> {
    return this.api.get<TimeEntry[]>('/time-tracking/active');
  }

  getHistory(params: Record<string, string | number> = {}): Observable<TimeEntry[]> {
    return this.api.get<TimeEntry[]>('/time-tracking/history', params);
  }
}
