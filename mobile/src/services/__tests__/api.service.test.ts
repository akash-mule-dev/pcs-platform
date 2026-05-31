import { api } from '../api.service';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

// Mock environment
jest.mock('../../config/environment', () => ({
  environment: { apiUrl: 'https://test.api.com/api' },
}));

const AsyncStorage = require('@react-native-async-storage/async-storage');

describe('api.service', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
    jest.clearAllMocks();
  });

  describe('GET', () => {
    it('sends GET request with auth header when token exists', async () => {
      AsyncStorage.getItem.mockResolvedValue('test-token');
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { items: [] } }),
      });

      await api.get('/work-orders');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://test.api.com/api/work-orders',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('sends GET without auth header when no token', async () => {
      AsyncStorage.getItem.mockResolvedValue(null);
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ data: {} }),
      });

      await api.get('/public');

      const callArgs = fetchMock.mock.calls[0][1];
      expect(callArgs.headers.Authorization).toBeUndefined();
    });

    it('unwraps { data: ... } response envelope', async () => {
      AsyncStorage.getItem.mockResolvedValue('token');
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { id: '123', name: 'test' } }),
      });

      const result = await api.get<any>('/test');
      expect(result).toEqual({ id: '123', name: 'test' });
    });

    it('returns raw response when not wrapped in data', async () => {
      AsyncStorage.getItem.mockResolvedValue('token');
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ count: 5 }),
      });

      const result = await api.get<any>('/test');
      expect(result).toEqual({ count: 5 });
    });

    it('builds query string from params', async () => {
      AsyncStorage.getItem.mockResolvedValue('token');
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      });

      await api.get('/items', { page: 2, limit: 20, status: 'active' });

      const url = fetchMock.mock.calls[0][0];
      expect(url).toContain('?');
      expect(url).toContain('page=2');
      expect(url).toContain('limit=20');
      expect(url).toContain('status=active');
    });

    it('filters out null and undefined params', async () => {
      AsyncStorage.getItem.mockResolvedValue('token');
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      });

      await api.get('/items', { page: 1, status: null as any, limit: undefined as any });

      const url = fetchMock.mock.calls[0][0];
      expect(url).toContain('page=1');
      expect(url).not.toContain('status=');
      expect(url).not.toContain('limit=');
    });

    it('URL-encodes special characters in params', async () => {
      AsyncStorage.getItem.mockResolvedValue('token');
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      });

      await api.get('/search', { q: 'hello world & more' });

      const url = fetchMock.mock.calls[0][0];
      expect(url).toContain(encodeURIComponent('hello world & more'));
    });
  });

  describe('POST', () => {
    it('sends POST with JSON body', async () => {
      AsyncStorage.getItem.mockResolvedValue('token');
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { id: '1' } }),
      });

      await api.post('/items', { name: 'test', value: 42 });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://test.api.com/api/items',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'test', value: 42 }),
        }),
      );
    });

    it('sends empty body when no body provided', async () => {
      AsyncStorage.getItem.mockResolvedValue('token');
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ data: {} }),
      });

      await api.post('/action');

      const callArgs = fetchMock.mock.calls[0][1];
      expect(callArgs.body).toBe('{}');
    });
  });

  describe('PATCH', () => {
    it('sends PATCH request with body', async () => {
      AsyncStorage.getItem.mockResolvedValue('token');
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { id: '1' } }),
      });

      await api.patch('/items/1', { status: 'completed' });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://test.api.com/api/items/1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'completed' }),
        }),
      );
    });
  });

  describe('DELETE', () => {
    it('sends DELETE without body', async () => {
      AsyncStorage.getItem.mockResolvedValue('token');
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ data: null }),
      });

      await api.delete('/items/1');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://test.api.com/api/items/1',
        expect.objectContaining({ method: 'DELETE' }),
      );
      const callArgs = fetchMock.mock.calls[0][1];
      expect(callArgs.body).toBeUndefined();
    });
  });

  describe('Error handling', () => {
    it('throws error with message from response body', async () => {
      AsyncStorage.getItem.mockResolvedValue('token');
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Invalid request' }),
      });

      await expect(api.get('/test')).rejects.toThrow('Invalid request');
    });

    it('falls back to HTTP status when no message', async () => {
      AsyncStorage.getItem.mockResolvedValue('token');
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => { throw new Error('Cannot parse'); },
      });

      await expect(api.get('/test')).rejects.toThrow('HTTP 500');
    });

    it('handles 401 unauthorized', async () => {
      AsyncStorage.getItem.mockResolvedValue('invalid-token');
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Unauthorized' }),
      });

      await expect(api.get('/protected')).rejects.toThrow('Unauthorized');
    });
  });
});
