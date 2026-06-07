import { api } from './api.service';

// Lightweight types for the read-only mobile views of the newer back-office
// modules. Field sets mirror the backend list responses (see /materials, /ncr,
// /equipment). Kept local to this service to avoid touching the shared types file.
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

export interface Ncr {
  id: string;
  number: string;
  title: string;
  description?: string | null;
  status: string;
  severity?: string | null;
  disposition?: string | null;
  createdAt?: string;
}

export interface Equipment {
  id: string;
  code: string;
  name: string;
  type?: string | null;
  status: string;
  isActive?: boolean;
  lineId?: string | null;
  stationId?: string | null;
}

export const materialsService = {
  getAll(params?: Record<string, string | number>): Promise<Material[]> {
    return api.getList<Material>('/materials', params);
  },
};

export const ncrService = {
  getAll(params?: Record<string, string | number>): Promise<Ncr[]> {
    return api.getList<Ncr>('/ncr', params);
  },
};

export const equipmentService = {
  getAll(params?: Record<string, string | number>): Promise<Equipment[]> {
    return api.getList<Equipment>('/equipment', params);
  },
};
