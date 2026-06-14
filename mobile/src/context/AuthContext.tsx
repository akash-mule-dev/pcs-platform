import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User } from '../types';
import { authService } from '../services/auth.service';
import { socketService } from '../services/socket.service';
import { loadPermissions, clearPermissions } from '../config/permissions';

interface AuthContextValue {
  isAuthenticated: boolean;
  user: User | null;
  isLoading: boolean;
  /** True once the caller's fine-grained permission set has been fetched. */
  permissionsReady: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  isAuthenticated: false,
  user: null,
  isLoading: true,
  permissionsReady: false,
  login: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [permissionsReady, setPermissionsReady] = useState(false);

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

    authService.init().finally(() => setIsLoading(false));

    return unsubscribe;
  }, []);

  // Fine-grained permissions live in a module-level cache that the nav/tab gates
  // read synchronously. authService flips auth state (via notify) BEFORE the set
  // is fetched, so we (re)load it here keyed on auth state and expose a
  // `permissionsReady` flag the UI waits on — otherwise the tab bar renders with
  // an empty set and hides every gated tab (only the always-visible More/Profile
  // survive), with no re-render once the set finally arrives.
  useEffect(() => {
    let cancelled = false;
    if (isAuthenticated) {
      setPermissionsReady(false);
      loadPermissions().finally(() => { if (!cancelled) setPermissionsReady(true); });
    } else {
      clearPermissions();
      setPermissionsReady(false);
    }
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  const login = useCallback(async (email: string, password: string) => {
    // Permissions are (re)loaded by the effect above, keyed on auth state.
    await authService.login(email, password);
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, isLoading, permissionsReady, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
