import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  employeeId: string;
  badgeId: string | null;
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
    this.currentUserSubject.next(null);
    this.router.navigate(['/login']);
  }

  hasRole(...roles: string[]): boolean {
    return roles.includes(this.userRole);
  }
}
