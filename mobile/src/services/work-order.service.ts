import { api } from './api.service';
import { WorkOrder } from '../types';

export const workOrderService = {
  async getAll(params?: Record<string, string | number>): Promise<WorkOrder[]> {
    return api.get<WorkOrder[]>('/work-orders', params);
  },

  async getById(id: string): Promise<WorkOrder> {
    return api.get<WorkOrder>(`/work-orders/${id}`);
  },

  async updateStatus(id: string, status: string): Promise<WorkOrder> {
    return api.patch<WorkOrder>(`/work-orders/${id}/status`, { status });
  },

  async updateStageStatus(
    workOrderId: string,
    stageId: string,
    status: string,
  ): Promise<WorkOrder> {
    return api.patch<WorkOrder>(`/work-orders/${workOrderId}/stages/${stageId}/status`, {
      status,
    });
  },
};
