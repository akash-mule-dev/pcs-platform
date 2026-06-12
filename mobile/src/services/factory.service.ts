import { api } from './api.service';

// Lightweight types for the mobile views of the newer back-office modules.
// Field sets mirror the backend list responses (see /materials, /ncr,
// /equipment, /skills). Kept local to this service to avoid touching the shared
// types file.
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
  dispositionNote?: string | null;
  projectName?: string | null;
  itemMark?: string | null;
  closedAt?: string | null;
  createdAt?: string;
  /** Present on GET /ncr/:id — legal next statuses (drives the action buttons). */
  allowedTransitions?: string[];
}

/** One row of the NCR timeline (GET /ncr/:id/events). */
export interface NcrEvent {
  id: string;
  type: 'created' | 'status_change' | 'disposition' | 'assignment' | 'comment';
  fromStatus?: string | null;
  toStatus?: string | null;
  note?: string | null;
  actorName?: string | null;
  createdAt: string;
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

export interface Skill {
  id: string;
  code: string;
  name: string;
  category?: string | null;
  description?: string | null;
}

/** Payload for raising an NCR from the floor (POST /ncr). */
export interface CreateNcrInput {
  title: string;
  description?: string;
  severity?: string; // low | medium | high | critical
}

export const materialsService = {
  getAll(params?: Record<string, string | number>): Promise<Material[]> {
    return api.getList<Material>('/materials', params);
  },
};

export const ncrService = {
  /** Filters: status, severity, projectId, open ('true' → not closed/cancelled), q. */
  getAll(params?: Record<string, string | number>): Promise<Ncr[]> {
    return api.getList<Ncr>('/ncr', params);
  },
  getOne(id: string): Promise<Ncr> {
    return api.get<Ncr>(`/ncr/${id}`);
  },
  create(body: CreateNcrInput): Promise<Ncr> {
    return api.post<Ncr>('/ncr', body);
  },
  /** Transition / disposition — server validates against the workflow state machine. */
  update(id: string, body: { status?: string; disposition?: string; dispositionNote?: string }): Promise<Ncr> {
    return api.patch<Ncr>(`/ncr/${id}`, body);
  },
  events(id: string): Promise<NcrEvent[]> {
    return api.getList<NcrEvent>(`/ncr/${id}/events`);
  },
  addComment(id: string, note: string): Promise<NcrEvent> {
    return api.post<NcrEvent>(`/ncr/${id}/comments`, { note });
  },
};

export const equipmentService = {
  getAll(params?: Record<string, string | number>): Promise<Equipment[]> {
    return api.getList<Equipment>('/equipment', params);
  },
};

export const skillsService = {
  getAll(): Promise<Skill[]> {
    return api.getList<Skill>('/skills');
  },
};
