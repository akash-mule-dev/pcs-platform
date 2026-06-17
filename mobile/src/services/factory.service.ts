import { api } from './api.service';

// Lightweight types for the mobile views of the newer back-office modules.
// Field sets mirror the backend list responses (see /materials, /equipment,
// /skills). Kept local to this service to avoid touching the shared types file.
export interface Material {
  id: string;
  code: string;
  name: string;
  type?: string | null;
  unitOfMeasure?: string | null;
  unitCost?: number | string | null;
  reorderLevel?: number | null;
  isActive?: boolean;
}

export const materialsService = {
  getAll(params?: Record<string, string | number>): Promise<Material[]> {
    return api.getList<Material>('/materials', params);
  },
};
