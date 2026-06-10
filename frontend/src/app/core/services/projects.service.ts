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
  processId: string | null;
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
  processId?: string | null;
  projectNumber?: string | null;
  clientName?: string | null;
  description?: string | null;
  status?: ProjectStatus;
  dueDate?: string | null;
}

export interface ImportResult {
  importFileId: string;
  nodeCount: number;
  counts: Record<string, number>;
}

export interface StageBucket { name: string; sequence: number; total: number; done: number; inProgress: number; pending: number; percent: number; }
export interface ProjectProgress {
  nodes: { total: number; group: number; assembly: number; subassembly: number; part: number };
  status: Record<string, number>;
  percentComplete: number;
  tonnage: { totalKg: number; processedKg: number; shippedKg: number };
  stages: StageBucket[];
  workOrders: number;
}

export type QaStatus = 'pass' | 'fail' | 'warning';
export type QaSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface QualityEntry {
  id: string;
  modelId: string;
  meshName: string;
  regionLabel: string | null;
  status: QaStatus;
  inspector: string | null;
  inspectionDate: string | null;
  notes: string | null;
  defectType: string | null;
  severity: QaSeverity | null;
  measurementValue: number | null;
  measurementUnit: string | null;
  toleranceMin: number | null;
  toleranceMax: number | null;
  signoffStatus: 'pending' | 'approved' | 'rejected';
  assemblyNodeId: string | null;
  projectId: string | null;
  createdAt: string;
}

export interface RecordQuality {
  status: QaStatus;
  inspector?: string;
  notes?: string;
  defectType?: string;
  severity?: QaSeverity;
  measurementValue?: number;
  measurementUnit?: string;
  toleranceMin?: number;
  toleranceMax?: number;
  regionLabel?: string;
}

export interface RaiseNcr {
  title?: string;
  description?: string;
  severity?: QaSeverity;
  qualityDataId?: string;
}

export interface NcrRef { id: string; number: string; title: string; status: string; severity: string; }

export interface NodeQualityStatus {
  status: QaStatus | null;
  pass: number; fail: number; warning: number; total: number;
  openNcr: number;
  lastInspectedAt: string | null;
}
export interface ProjectQualitySummary {
  nodes: Record<string, NodeQualityStatus>;
  totals: { inspected: number; failed: number; openNcr: number };
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

  /** Link any queued-conversion GLBs back to the project tree; reports how many are still converting. */
  resolveModels(projectId: string): Observable<{ linked: number; pending: number; failed: number }> {
    return this.http.post<{ linked: number; pending: number; failed: number }>(`${this.base}/${projectId}/resolve-models`, {});
  }

  getProgress(projectId: string): Observable<ProjectProgress> {
    return this.http.get<ProjectProgress>(`${this.base}/${projectId}/progress`);
  }

  /** GLB node (mesh) names to isolate for a node + its descendants. */
  nodeMeshes(projectId: string, nodeId: string): Observable<string[]> {
    return this.http.get<string[]>(`${this.base}/${projectId}/nodes/${nodeId}/meshes`);
  }

  /**
   * URL of an isolated GLB containing ONLY this node's geometry (its part, or
   * every part under an assembly). Public, like the model-file route, so it can
   * be fed straight to the 3D viewer's `modelUrl`. Falls back to the full model
   * server-side when the node has no isolatable geometry.
   */
  nodeGlbUrl(projectId: string, nodeId: string): string {
    return `${this.base}/${projectId}/nodes/${nodeId}/glb`;
  }

  // ── Quality ──
  /** A node's quality inspections (newest first). */
  nodeQuality(projectId: string, nodeId: string): Observable<QualityEntry[]> {
    return this.http.get<QualityEntry[]>(`${this.base}/${projectId}/nodes/${nodeId}/quality`);
  }

  /** Record a quality check on a node (server auto-fails out-of-tolerance measurements). */
  recordQuality(projectId: string, nodeId: string, body: RecordQuality): Observable<QualityEntry> {
    return this.http.post<QualityEntry>(`${this.base}/${projectId}/nodes/${nodeId}/quality`, body);
  }

  /** Raise an NCR pre-filled from a node (links node/project/work-order/quality record). */
  raiseNodeNcr(projectId: string, nodeId: string, body: RaiseNcr): Observable<NcrRef> {
    return this.http.post<NcrRef>(`${this.base}/${projectId}/nodes/${nodeId}/ncr`, body);
  }

  /** Per-node quality status + open-NCR map for the project (badges + ship gate). */
  qualitySummary(projectId: string): Observable<ProjectQualitySummary> {
    return this.http.get<ProjectQualitySummary>(`${this.base}/${projectId}/quality-summary`);
  }
}
