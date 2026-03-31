import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api.service';
import { User, LoginResponse } from '../types';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

export type AuthChangeCallback = (isAuthenticated: boolean, user: User | null) => void;

let _isAuthenticated = false;
let _currentUser: User | null = null;
let _listeners: AuthChangeCallback[] = [];

function notify() {
  _listeners.forEach((cb) => cb(_isAuthenticated, _currentUser));
}

export const authService = {
  get isAuthenticated(): boolean {
    return _isAuthenticated;
  },

  get currentUser(): User | null {
    return _currentUser;
  },

  subscribe(cb: AuthChangeCallback): () => void {
    _listeners.push(cb);
    return () => {
      _listeners = _listeners.filter((l) => l !== cb);
    };
  },

  async init(): Promise<void> {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    const userJson = await AsyncStorage.getItem(USER_KEY);
    if (token && userJson) {
      _isAuthenticated = true;
      _currentUser = JSON.parse(userJson);
      notify();
    }
  },

  async getToken(): Promise<string | null> {
    return AsyncStorage.getItem(TOKEN_KEY);
  },

  async login(email: string, password: string): Promise<LoginResponse> {
    const result = await api.post<LoginResponse>('/auth/login', { email, password });
    await AsyncStorage.setItem(TOKEN_KEY, result.accessToken);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(result.user));
    _isAuthenticated = true;
    _currentUser = result.user;
    notify();
    return result;
  },

  async getProfile(): Promise<User> {
    const user = await api.get<User>('/auth/profile');
    _currentUser = user;
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
    notify();
    return user;
  },

  async logout(): Promise<void> {
    await AsyncStorage.removeItem(TOKEN_KEY);
    await AsyncStorage.removeItem(USER_KEY);
    _isAuthenticated = false;
    _currentUser = null;
    notify();
  },
};
