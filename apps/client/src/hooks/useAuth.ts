import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Sentry from "@sentry/react";
import { invoke } from "@tauri-apps/api/core";
import api, {
  type LoginRequest,
  type RegisterRequest,
  type AuthStartRequest,
  type VerifyCodeRequest,
  type CompleteDesktopSessionRequest,
  type User,
} from "@/services/api";
import { getHttpErrorStatus } from "@/lib/http-error";
import {
  appActions,
  workspaceActions,
  homeActions,
  notificationActions,
} from "@/stores";
import { setAuthTokens } from "@/services/auth-session";

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

export const useLoginPolling = (
  sessionId: string | null,
  onSuccess: (data: {
    user: User;
    accessToken: string;
    refreshToken: string;
  }) => void,
  onExpired?: () => void,
) => {
  return useQuery({
    queryKey: ["loginPolling", sessionId],
    queryFn: async () => {
      try {
        const result = await api.auth.pollLogin(sessionId!);
        if (
          result.status === "verified" &&
          result.accessToken &&
          result.refreshToken &&
          result.user
        ) {
          setAuthTokens({
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
          });
          syncUserToStore(result.user);
          onSuccess({
            user: result.user,
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
          });
        }
        return result;
      } catch (err: unknown) {
        // 404 means session expired or not found
        if (getHttpErrorStatus(err) === 404) {
          onExpired?.();
        }
        throw err;
      }
    },
    enabled: !!sessionId,
    refetchInterval: (query) => {
      // Stop polling once verified or errored
      if (query.state.data?.status === "verified") return false;
      if (query.state.error) return false;
      return 3000; // Poll every 3 seconds
    },
    retry: false,
  });
};

// --- New unified auth flow hooks ---

export const useAuthStart = () => {
  return useMutation({
    mutationFn: (data: AuthStartRequest) => api.auth.authStart(data),
  });
};

export const useVerifyCode = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: VerifyCodeRequest) => api.auth.verifyCode(data),
    onSuccess: (data) => {
      queryClient.setQueryData(["currentUser"], data.user);
      syncUserToStore(data.user);
    },
  });
};

export const useCreateDesktopSession = () => {
  return useMutation({
    mutationFn: () => api.auth.createDesktopSession(),
  });
};

export const useCompleteDesktopSession = () => {
  return useMutation({
    mutationFn: (data: CompleteDesktopSessionRequest) =>
      api.auth.completeDesktopSession(data),
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

      // Stop aHand daemon on logout (desktop app only).
      // Use __TAURI_INTERNALS__ for Tauri v2 detection (v1 used __TAURI__).
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        invoke("ahand_stop").catch(() => {});
      }
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
