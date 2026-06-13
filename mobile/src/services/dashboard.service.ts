import { api } from './api.service';

/**
 * Mirrors the web portal's dashboard endpoints so both clients show the SAME
 * server-computed numbers (`/api/dashboard/*`), instead of re-deriving stats
 * client-side from raw history (the old behaviour, which drifted from web).
 */

export interface WorkOrderStatusCount {
  status: string;
  /** Raw COUNT(*) — arrives as a string from the API, same as on web. */
  count: string;
}

export interface DashboardSummary {
  workOrdersByStatus: WorkOrderStatusCount[];
  activeOperators: number;
  todayCompletedStages: number;
  avgEfficiency: number | null;
}

export interface LiveStatusEntry {
  id: string;
  startTime: string;
  elapsedSeconds: number;
  user: { firstName?: string | null; lastName?: string | null };
  station: { name: string } | null;
  workOrderStage: {
    stage: { name: string } | null;
    workOrder: { orderNumber: string } | null;
  };
}

export interface MyDayStats {
  trackedSeconds: number;
  entriesCompleted: number;
  workOrdersWorked: number;
}

export const dashboardService = {
  /** Org-wide KPIs — identical payload to the web dashboard. */
  async getSummary(): Promise<DashboardSummary> {
    return api.get<DashboardSummary>('/dashboard/summary');
  },

  /** Active time entries across the shop floor (web "Live Stage Status"). */
  async getLiveStatus(): Promise<LiveStatusEntry[]> {
    return api.getList<LiveStatusEntry>('/dashboard/live-status');
  },

  /** The caller's own stats for today, computed server-side. */
  async getMyDay(): Promise<MyDayStats> {
    return api.get<MyDayStats>('/dashboard/my-day');
  },
};
