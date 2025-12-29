import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { type LoginRequest, type RegisterRequest } from "@/services/api";

export const useLogin = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: LoginRequest) => api.auth.login(data),
    onSuccess: (data) => {
      // Tokens are already stored in api.auth.login
      queryClient.setQueryData(["currentUser"], data.user);
    },
  });
};

export const useRegister = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: RegisterRequest) => api.auth.register(data),
    onSuccess: (data) => {
      // Tokens are already stored in api.auth.register
      queryClient.setQueryData(["currentUser"], data.user);
    },
  });
};

export const useLogout = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.auth.logout(),
    onSuccess: () => {
      // Tokens are already removed in api.auth.logout
      queryClient.clear();
    },
  });
};

export const useCurrentUser = () => {
  return useQuery({
    queryKey: ["currentUser"],
    queryFn: () => api.auth.getCurrentUser(),
    enabled: !!localStorage.getItem("auth_token"),
  });
};
