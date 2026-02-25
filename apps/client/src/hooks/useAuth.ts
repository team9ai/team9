import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Sentry from "@sentry/react";
import api, {
  type LoginRequest,
  type RegisterRequest,
  type User,
} from "@/services/api";
import {
  appActions,
  workspaceActions,
  homeActions,
  notificationActions,
} from "@/stores";

// Sync user data to Zustand store and Sentry context
const syncUserToStore = (user: User | null) => {
  if (user) {
    appActions.setUser({
      id: user.id,
      name: user.displayName || user.username,
      email: user.email,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
    });
    Sentry.setUser({ id: user.id, email: user.email });
  } else {
    appActions.setUser(null);
    Sentry.setUser(null);
  }
};

export const useLogin = () => {
  return useMutation({
    mutationFn: (data: LoginRequest) => api.auth.login(data),
    // Login now sends a magic link email, no tokens returned
  });
};

export const useRegister = () => {
  return useMutation({
    mutationFn: (data: RegisterRequest) => api.auth.register(data),
    // No longer auto-login after registration
    // User needs to verify email first
  });
};

export const useVerifyEmail = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (token: string) => api.auth.verifyEmail(token),
    onSuccess: (data) => {
      // Tokens are stored in api.auth.verifyEmail
      queryClient.setQueryData(["currentUser"], data.user);
      syncUserToStore(data.user);
    },
  });
};

export const useGoogleAuth = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (credential: string) => api.auth.googleLogin(credential),
    onSuccess: (data) => {
      // Tokens are stored in api.auth.googleLogin
      queryClient.setQueryData(["currentUser"], data.user);
      syncUserToStore(data.user);
    },
  });
};

export const useResendVerification = () => {
  return useMutation({
    mutationFn: (email: string) => api.auth.resendVerification(email),
  });
};

export const useLogout = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.auth.logout(),
    onSuccess: () => {
      // Tokens are already removed in api.auth.logout
      queryClient.clear();

      // Clear Sentry user context
      Sentry.setUser(null);

      // Reset all Zustand stores to prevent stale data on next login
      appActions.reset();
      workspaceActions.reset();
      homeActions.reset();
      notificationActions.reset();

      // Clear sessionStorage flags
      sessionStorage.removeItem("app_initialized");
    },
  });
};

export const useCurrentUser = () => {
  return useQuery({
    queryKey: ["currentUser"],
    queryFn: async () => {
      const user = await api.auth.getCurrentUser();
      syncUserToStore(user);
      return user;
    },
    enabled: !!localStorage.getItem("auth_token"),
  });
};
