import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, {
  type LoginRequest,
  type RegisterRequest,
  type User,
} from "@/services/api";
import { appActions } from "@/stores";

// Sync user data to Zustand store
const syncUserToStore = (user: User | null) => {
  if (user) {
    appActions.setUser({
      id: user.id,
      name: user.displayName || user.username,
      email: user.email,
      avatarUrl: user.avatarUrl,
    });
  } else {
    appActions.setUser(null);
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
      syncUserToStore(null);
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
