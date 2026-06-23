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

/**
 * Org-level quality KPIs (mirrors `GET /quality-data/insights`). The home
 * screen reads FPY + the 30-day inspection mix as health signals and the
 * open-NCR / pending-sign-off / aging counts as its QC attention queue — one
 * call backs the whole Quality section.
 */
export interface QualityInsights {
  inspections30d: { total: number; pass: number; fail: number; warning: number };
  pendingSignoffs: number;
  firstPassYield: { ratePct: number | null; passedFirst: number; inspectedNodes: number };
  openNcrBySeverity: Record<string, number>;
  ncrAging: { under7: number; d7to30: number; over30: number };
  avgCloseDays90d: number | null;
  closed90d: number;
  topDefects: { defectType: string; count: number; failCount: number }[];
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

  /** Org-level quality KPIs — backs the home screen's Quality + attention sections. */
  async getQualityInsights(): Promise<QualityInsights> {
    return api.get<QualityInsights>('/quality-data/insights');
  },
};
