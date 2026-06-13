import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';

export interface User {
  id: string;
  email: string | null;
  mobileNo: string;
  firstName: string;
  lastName: string;
  employeeId: string;
  role: { id: string; name: string };
  isActive: boolean;
}

export interface LoginResponse {
  accessToken: string;
  user: User;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  currentUser$ = this.currentUserSubject.asObservable();

  constructor(private http: HttpClient, private router: Router) {
    const stored = localStorage.getItem('pcs_user');
    if (stored) {
      try { this.currentUserSubject.next(JSON.parse(stored)); } catch {}
    }
  }

  get token(): string | null {
    return localStorage.getItem('pcs_token');
  }

  get currentUser(): User | null {
    return this.currentUserSubject.value;
  }

  get isLoggedIn(): boolean {
    return !!this.token;
  }

  get userRole(): string {
    const role = this.currentUser?.role;
    if (typeof role === 'string') return role;
    return role?.name || '';
  }

  login(email: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${environment.apiUrl}/auth/login`, { email, password }).pipe(
      tap(res => {
        localStorage.setItem('pcs_token', res.accessToken);
        localStorage.setItem('pcs_user', JSON.stringify(res.user));
        this.currentUserSubject.next(res.user);
      })
    );
  }

  getProfile(): Observable<User> {
    return this.http.get<User>(`${environment.apiUrl}/auth/profile`).pipe(
      tap(user => {
        localStorage.setItem('pcs_user', JSON.stringify(user));
        this.currentUserSubject.next(user);
      })
    );
  }

  logout(): void {
    localStorage.removeItem('pcs_token');
    localStorage.removeItem('pcs_user');
    localStorage.removeItem('pcs_impersonation');
    localStorage.removeItem('pcs_token_platform');
    localStorage.removeItem('pcs_user_platform');
    this.currentUserSubject.next(null);
    this.router.navigate(['/login']);
  }

  /** Are we currently inside a support (impersonation) session? */
  get impersonation(): { organizationName: string } | null {
    const raw = localStorage.getItem('pcs_impersonation');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  /**
   * Enter a support session: back up the platform token/user, then swap in the
   * impersonation token returned by POST /organizations/:id/impersonate.
   */
  startImpersonation(res: { accessToken: string; user: any; organization: { name: string } }): void {
    const curToken = localStorage.getItem('pcs_token');
    const curUser = localStorage.getItem('pcs_user');
    if (curToken) localStorage.setItem('pcs_token_platform', curToken);
    if (curUser) localStorage.setItem('pcs_user_platform', curUser);
    localStorage.setItem('pcs_token', res.accessToken);
    localStorage.setItem('pcs_user', JSON.stringify(res.user));
    localStorage.setItem('pcs_impersonation', JSON.stringify({ organizationName: res.organization.name }));
    this.currentUserSubject.next(res.user);
  }

  /** Leave a support session and restore the platform operator's own session. */
  stopImpersonation(): void {
    const token = localStorage.getItem('pcs_token_platform');
    const user = localStorage.getItem('pcs_user_platform');
    if (token) localStorage.setItem('pcs_token', token); else localStorage.removeItem('pcs_token');
    if (user) localStorage.setItem('pcs_user', user); else localStorage.removeItem('pcs_user');
    localStorage.removeItem('pcs_token_platform');
    localStorage.removeItem('pcs_user_platform');
    localStorage.removeItem('pcs_impersonation');
    try { this.currentUserSubject.next(user ? JSON.parse(user) : null); } catch { this.currentUserSubject.next(null); }
  }

  hasRole(...roles: string[]): boolean {
    return roles.includes(this.userRole);
  }
}
