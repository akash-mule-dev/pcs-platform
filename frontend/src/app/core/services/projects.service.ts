import { Injectable } from '@angular/core';
import { HttpClient, HttpEvent, HttpRequest } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

export type ProjectStatus = 'planning' | 'active' | 'on_hold' | 'completed' | 'archived';
export type NodeType = 'group' | 'assembly' | 'subassembly' | 'part';
export type NodeProductionStatus =
  | 'not_started' | 'in_progress' | 'ready_to_ship' | 'shipped' | 'on_hold';

export interface Project {
  id: string;
  name: string;
  projectNumber: string | null;
  clientName: string | null;
  description: string | null;
  status: ProjectStatus;
  dueDate: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AssemblyNode {
  id: string;
  projectId: string;
  parentId: string | null;
  nodeType: NodeType;
  name: string;
  mark: string | null;
  quantity: number;
  ifcGuid: string | null;
  ifcClass: string | null;
  sourceFormat: string | null;
  profile: string | null;
  materialGrade: string | null;
  lengthMm: number | null;
  weightKg: number | null;
  modelId: string | null;
  meshName: string | null;
  productionStatus: NodeProductionStatus;
  currentStageId: string | null;
  percentComplete: number;
  qtyComplete: number;
  qtyShipped: number;
  depth: number;
  sortIndex: number;
  properties: Record<string, unknown> | null;
}

export interface CreateProject {
  name: string;
  projectNumber?: string;
  clientName?: string;
  description?: string;
  status?: ProjectStatus;
  dueDate?: string;
}

export interface ImportResult {
  importFileId: string;
  nodeCount: number;
  counts: Record<string, number>;
}

@Injectable({ providedIn: 'root' })
export class ProjectsService {
  private readonly base = `${environment.apiUrl}/projects`;

  constructor(private http: HttpClient) {}

  list(): Observable<Project[]> {
    return this.http.get<Project[]>(this.base);
  }

  get(id: string): Observable<Project> {
    return this.http.get<Project>(`${this.base}/${id}`);
  }

  create(dto: CreateProject): Observable<Project> {
    return this.http.post<Project>(this.base, dto);
  }

  update(id: string, dto: Partial<CreateProject>): Observable<Project> {
    return this.http.patch<Project>(`${this.base}/${id}`, dto);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  /** Flat list of a project's assembly nodes, ordered for tree rendering. */
  nodes(id: string): Observable<AssemblyNode[]> {
    return this.http.get<AssemblyNode[]>(`${this.base}/${id}/nodes`);
  }

  /** Upload an IFC file and extract its assembly tree; emits HttpEvents for progress. */
  importIfc(projectId: string, file: File): Observable<HttpEvent<ImportResult>> {
    const fd = new FormData();
    fd.append('file', file);
    const req = new HttpRequest('POST', `${this.base}/${projectId}/import-ifc`, fd, {
      reportProgress: true,
    });
    return this.http.request<ImportResult>(req);
  }

  /** Processes available for work-order routing (tolerant of array or paged responses). */
  listProcesses(): Observable<{ id: string; name: string }[]> {
    return this.http.get<any>(`${environment.apiUrl}/processes`).pipe(
      map((r) => (Array.isArray(r) ? r : (r?.data ?? r?.items ?? []))),
    );
  }

  generateWorkOrders(projectId: string, processId: string): Observable<{ created: number; skipped: number }> {
    return this.http.post<{ created: number; skipped: number }>(`${this.base}/${projectId}/generate-work-orders`, { processId });
  }

  recomputeStatus(projectId: string): Observable<{ updated: number; projectStatus: string | null }> {
    return this.http.post<{ updated: number; projectStatus: string | null }>(`${this.base}/${projectId}/recompute-status`, {});
  }
}
