import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, from, switchMap, tap, map } from 'rxjs';
import { Storage } from '@ionic/storage-angular';
import { ApiService } from './api.service';
import { Router } from '@angular/router';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  employeeId: string;
  badgeId: string | null;
  role: { id: string; name: string } | string;
  isActive: boolean;
}

export interface LoginResponse {
  accessToken: string;
  user: User;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly TOKEN_KEY = 'auth_token';
  private readonly USER_KEY = 'auth_user';

  isAuthenticated$ = new BehaviorSubject<boolean>(false);
  currentUser$ = new BehaviorSubject<User | null>(null);
  private storageReady = false;

  constructor(
    private api: ApiService,
    private storage: Storage,
    private router: Router
  ) {}

  async init(): Promise<void> {
    if (!this.storageReady) {
      await this.storage.create();
      this.storageReady = true;
    }
    const token = await this.storage.get(this.TOKEN_KEY);
    const user = await this.storage.get(this.USER_KEY);
    if (token && user) {
      this.isAuthenticated$.next(true);
      this.currentUser$.next(user);
    }
  }

  async getToken(): Promise<string | null> {
    if (!this.storageReady) {
      await this.storage.create();
      this.storageReady = true;
    }
    return this.storage.get(this.TOKEN_KEY);
  }

  login(email: string, password: string): Observable<LoginResponse> {
    return this.api.post<LoginResponse>('/auth/login', { email, password }).pipe(
      switchMap(response =>
        from(this.storeAuth(response)).pipe(map(() => response))
      )
    );
  }

  private async storeAuth(response: LoginResponse): Promise<void> {
    await this.storage.set(this.TOKEN_KEY, response.accessToken);
    await this.storage.set(this.USER_KEY, response.user);
    this.isAuthenticated$.next(true);
    this.currentUser$.next(response.user);
  }

  getProfile(): Observable<User> {
    return this.api.get<User>('/auth/profile').pipe(
      tap(user => this.currentUser$.next(user))
    );
  }

  async logout(): Promise<void> {
    await this.storage.remove(this.TOKEN_KEY);
    await this.storage.remove(this.USER_KEY);
    this.isAuthenticated$.next(false);
    this.currentUser$.next(null);
    await this.router.navigate(['/login']);
  }
}
