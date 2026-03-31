import AsyncStorage from '@react-native-async-storage/async-storage';
import { environment } from '../config/environment';

const BASE_URL = environment.apiUrl;
const TOKEN_KEY = 'auth_token';

async function getHeaders(): Promise<Record<string, string>> {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

function buildQueryString(params?: Record<string, string | number>): string {
  if (!params) return '';
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return qs ? `?${qs}` : '';
}

/** Unwrap API responses that wrap data in { data: ... } */
function unwrap<T>(body: any): T {
  if (body && typeof body === 'object' && !Array.isArray(body) && 'data' in body) {
    return body.data as T;
  }
  return body as T;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.message || `HTTP ${response.status}`);
  }
  const body = await response.json();
  return unwrap<T>(body);
}

export const api = {
  async get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
    const headers = await getHeaders();
    const response = await fetch(`${BASE_URL}${path}${buildQueryString(params)}`, {
      method: 'GET',
      headers,
    });
    return handleResponse<T>(response);
  },

  async post<T>(path: string, body?: unknown): Promise<T> {
    const headers = await getHeaders();
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body ?? {}),
    });
    return handleResponse<T>(response);
  },

  async patch<T>(path: string, body?: unknown): Promise<T> {
    const headers = await getHeaders();
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body ?? {}),
    });
    return handleResponse<T>(response);
  },

  async delete<T>(path: string): Promise<T> {
    const headers = await getHeaders();
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'DELETE',
      headers,
    });
    return handleResponse<T>(response);
  },
};
