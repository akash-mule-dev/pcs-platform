import { authService } from '../auth.service';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('../api.service', () => ({
  api: {
    post: jest.fn(),
    get: jest.fn(),
  },
}));

const AsyncStorage = require('@react-native-async-storage/async-storage');
const { api } = require('../api.service');

describe('auth.service', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // Reset internal state via the public logout API
    AsyncStorage.removeItem.mockResolvedValue(undefined);
    await authService.logout();
    jest.clearAllMocks();
  });

  describe('login', () => {
    it('calls /auth/login with credentials and stores token + user', async () => {
      const mockResult = {
        accessToken: 'jwt-token-abc',
        user: { id: 'u1', email: 'admin@pcs.com', firstName: 'Admin' },
      };
      api.post.mockResolvedValue(mockResult);

      const result = await authService.login('admin@pcs.com', '123456');

      expect(api.post).toHaveBeenCalledWith('/auth/login', {
        email: 'admin@pcs.com',
        password: '123456',
      });
      expect(AsyncStorage.setItem).toHaveBeenCalledWith('auth_token', 'jwt-token-abc');
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'auth_user',
        JSON.stringify(mockResult.user),
      );
      expect(result).toEqual(mockResult);
      expect(authService.isAuthenticated).toBe(true);
      expect(authService.currentUser).toEqual(mockResult.user);
    });

    it('throws on login failure and does not store token', async () => {
      api.post.mockRejectedValue(new Error('Invalid credentials'));

      await expect(authService.login('bad@user.com', 'wrong')).rejects.toThrow(
        'Invalid credentials',
      );

      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
      expect(authService.isAuthenticated).toBe(false);
    });
  });

  describe('logout', () => {
    it('clears token and user from storage', async () => {
      await authService.logout();

      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('auth_token');
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('auth_user');
      expect(authService.isAuthenticated).toBe(false);
      expect(authService.currentUser).toBeNull();
    });
  });

  describe('init', () => {
    it('restores session from storage if token exists', async () => {
      const storedUser = { id: 'u2', email: 'saved@pcs.com' };
      AsyncStorage.getItem
        .mockResolvedValueOnce('stored-token')
        .mockResolvedValueOnce(JSON.stringify(storedUser));

      await authService.init();

      expect(authService.isAuthenticated).toBe(true);
      expect(authService.currentUser).toEqual(storedUser);
    });

    it('does nothing if no stored token', async () => {
      AsyncStorage.getItem.mockResolvedValue(null);

      await authService.init();

      expect(authService.isAuthenticated).toBe(false);
      expect(authService.currentUser).toBeNull();
    });

    it('does nothing if token exists but user missing', async () => {
      AsyncStorage.getItem
        .mockResolvedValueOnce('token')
        .mockResolvedValueOnce(null);

      await authService.init();

      expect(authService.isAuthenticated).toBe(false);
    });
  });

  describe('getToken', () => {
    it('returns stored token', async () => {
      AsyncStorage.getItem.mockResolvedValue('my-token');
      const token = await authService.getToken();
      expect(token).toBe('my-token');
      expect(AsyncStorage.getItem).toHaveBeenCalledWith('auth_token');
    });

    it('returns null when no token stored', async () => {
      AsyncStorage.getItem.mockResolvedValue(null);
      const token = await authService.getToken();
      expect(token).toBeNull();
    });
  });

  describe('subscribe', () => {
    it('notifies subscribers on login', async () => {
      const listener = jest.fn();
      const unsubscribe = authService.subscribe(listener);

      api.post.mockResolvedValue({
        accessToken: 'tok',
        user: { id: 'u1', email: 'a@b.c' },
      });

      await authService.login('a@b.c', 'p');

      expect(listener).toHaveBeenCalledWith(true, expect.objectContaining({ id: 'u1' }));
      unsubscribe();
    });

    it('notifies subscribers on logout', async () => {
      const listener = jest.fn();
      authService.subscribe(listener);

      await authService.logout();

      expect(listener).toHaveBeenCalledWith(false, null);
    });

    it('unsubscribe stops notifications', async () => {
      const listener = jest.fn();
      const unsubscribe = authService.subscribe(listener);
      unsubscribe();

      await authService.logout();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('getProfile', () => {
    it('fetches profile and updates stored user', async () => {
      const profile = { id: 'u1', email: 'fresh@pcs.com', role: { name: 'admin' } };
      api.get.mockResolvedValue(profile);

      const result = await authService.getProfile();

      expect(api.get).toHaveBeenCalledWith('/auth/profile');
      expect(AsyncStorage.setItem).toHaveBeenCalledWith('auth_user', JSON.stringify(profile));
      expect(result).toEqual(profile);
      expect(authService.currentUser).toEqual(profile);
    });
  });
});
