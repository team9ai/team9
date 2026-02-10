import http from "../http";

export interface User {
  id: string;
  email: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Gateway Auth API types (matching server/apps/gateway/src/auth/dto)
export interface RegisterRequest {
  email: string;
  username: string;
  displayName?: string;
}

export interface LoginRequest {
  email: string;
}

export interface LoginResponse {
  message: string;
  email: string;
  /** Verification link returned in dev mode when DEV_SKIP_EMAIL_VERIFICATION=true */
  verificationLink?: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface RegisterResponse {
  message: string;
  email: string;
  /** Verification link returned in dev mode when DEV_SKIP_EMAIL_VERIFICATION=true */
  verificationLink?: string;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const authApi = {
  login: async (data: LoginRequest): Promise<LoginResponse> => {
    const response = await http.post<LoginResponse>("/v1/auth/login", data);
    return response.data;
  },

  register: async (data: RegisterRequest): Promise<RegisterResponse> => {
    const response = await http.post<RegisterResponse>(
      "/v1/auth/register",
      data,
    );
    return response.data;
  },

  verifyEmail: async (token: string): Promise<AuthResponse> => {
    const response = await http.get<AuthResponse>(
      `/v1/auth/verify-email?token=${token}`,
    );

    const authData = response.data;

    // Store tokens after successful verification
    localStorage.setItem("auth_token", authData.accessToken);
    localStorage.setItem("refresh_token", authData.refreshToken);

    return authData;
  },

  googleLogin: async (credential: string): Promise<AuthResponse> => {
    const response = await http.post<AuthResponse>("/v1/auth/google", {
      credential,
    });

    const authData = response.data;

    // Store tokens after successful Google login
    localStorage.setItem("auth_token", authData.accessToken);
    localStorage.setItem("refresh_token", authData.refreshToken);

    return authData;
  },

  resendVerification: async (
    email: string,
  ): Promise<{ message: string; verificationLink?: string }> => {
    const response = await http.post<{
      message: string;
      verificationLink?: string;
    }>("/v1/auth/resend-verification", { email });
    return response.data;
  },

  logout: async (): Promise<void> => {
    try {
      await http.post("/v1/auth/logout", {});
    } finally {
      // Always clear local storage even if the request fails
      localStorage.removeItem("auth_token");
      localStorage.removeItem("refresh_token");
    }
  },

  getCurrentUser: async (): Promise<User> => {
    const response = await http.get<User>("/v1/auth/me");
    return response.data;
  },

  refreshToken: async (): Promise<TokenPair> => {
    const refreshToken = localStorage.getItem("refresh_token");

    if (!refreshToken) {
      throw new Error("No refresh token available");
    }

    const response = await http.post<TokenPair>("/v1/auth/refresh", {
      refreshToken,
    });

    const tokenData = response.data;

    localStorage.setItem("auth_token", tokenData.accessToken);
    localStorage.setItem("refresh_token", tokenData.refreshToken);

    return tokenData;
  },
};

export const userApi = {
  getUsers: async (
    params?: PaginationParams,
  ): Promise<PaginatedResponse<User>> => {
    const response = await http.get<PaginatedResponse<User>>("/users", {
      params,
    });
    return response.data;
  },

  getUser: async (id: string): Promise<User> => {
    const response = await http.get<User>(`/users/${id}`);
    return response.data;
  },

  createUser: async (data: Omit<User, "id">): Promise<User> => {
    const response = await http.post<User>("/users", data);
    return response.data;
  },

  updateUser: async (id: string, data: Partial<User>): Promise<User> => {
    const response = await http.put<User>(`/users/${id}`, data);
    return response.data;
  },

  deleteUser: async (id: string): Promise<void> => {
    await http.delete(`/users/${id}`);
  },
};

import imApi from "./im";
import workspaceApi from "./workspace";
import notificationApi from "./notification";
import searchApi from "./search";
import applicationsApi from "./applications";

export const api = {
  auth: authApi,
  user: userApi,
  im: imApi,
  workspace: workspaceApi,
  notification: notificationApi,
  search: searchApi,
  applications: applicationsApi,
};

export default api;
