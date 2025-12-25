import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { type LoginRequest, type RegisterRequest } from "@/services/api";

export const useLogin = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: LoginRequest) => api.auth.login(data),
    onSuccess: (data) => {
      localStorage.setItem("auth_token", data.token);
      queryClient.setQueryData(["currentUser"], data.user);
    },
  });
};

export const useRegister = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: RegisterRequest) => api.auth.register(data),
    onSuccess: (data) => {
      if (data.token) {
        localStorage.setItem("auth_token", data.token);
        queryClient.setQueryData(["currentUser"], data.user);
      }
    },
  });
};

export const useLogout = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.auth.logout(),
    onSuccess: () => {
      queryClient.clear();
      localStorage.removeItem("auth_token");
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
