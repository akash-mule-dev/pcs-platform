import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../core/services/api.service';

/** API layer for Workforce — skills/certs + shifts (Phase 4). */
@Injectable({ providedIn: 'root' })
export class WorkforceApiService {
  constructor(private api: ApiService) {}

  listSkills(): Observable<any> { return this.api.get('/skills'); }
  createSkill(b: any): Observable<any> { return this.api.post('/skills', b); }
  assignSkill(b: any): Observable<any> { return this.api.post('/skills/assign', b); }
  userSkills(userId: string): Observable<any> { return this.api.get(`/skills/user/${userId}`); }

  listShifts(): Observable<any> { return this.api.get('/shifts'); }
  createShift(b: any): Observable<any> { return this.api.post('/shifts', b); }

  listUsers(): Observable<any> { return this.api.get('/users'); }
}
