import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User } from '../types';
import { authService } from '../services/auth.service';
import { socketService } from '../services/socket.service';
import { loadPermissions } from '../config/permissions';

interface AuthContextValue {
  isAuthenticated: boolean;
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  isAuthenticated: false,
  user: null,
  isLoading: true,
  login: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = authService.subscribe((auth, u) => {
      setIsAuthenticated(auth);
      setUser(u);
      // Drive the real-time connection from auth state: connect on login /
      // restored session, tear down on logout.
      if (auth && u) {
        void socketService.connect(u.id);
      } else {
        socketService.disconnect();
      }
    });

    authService.init()
      .then(() => { if (authService.isAuthenticated) return loadPermissions(); })
      .finally(() => setIsLoading(false));

    return unsubscribe;
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    await authService.login(email, password);
    await loadPermissions();
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
