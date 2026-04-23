import http from "../http";
import {
  clearAuthTokens,
  getRefreshToken,
  refreshAccessToken,
  setAuthTokens,
} from "../auth-session";

export interface User {
  id: string;
  email: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  isActive: boolean;
  /** IETF BCP 47 language tag. Null when the user has not yet reported a preference. */
  language?: string | null;
  /** IANA time zone name. Null when the user has not yet reported a preference. */
  timeZone?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  isNewUser: boolean;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface PollLoginResponse {
  status: "pending" | "verified";
  accessToken?: string;
  refreshToken?: string;
  user?: User;
}

// --- New unified auth flow types ---
export interface AuthStartRequest {
  email: string;
  displayName?: string;
  signupSource?: "self" | "invite";
  turnstileToken?: string;
}

export interface AuthStartResponse {
  action: "code_sent" | "need_display_name";
  email: string;
  challengeId?: string;
  expiresInSeconds?: number;
  /** Verification code returned in dev mode */
  verificationCode?: string;
}

export interface VerifyCodeRequest {
  email: string;
  challengeId: string;
  code: string;
}

export interface GoogleLoginRequest {
  credential: string;
  signupSource?: "self" | "invite";
}

export interface DesktopSessionResponse {
  sessionId: string;
  expiresInSeconds: number;
}

export interface CompleteDesktopSessionRequest {
  sessionId: string;
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
  // --- New unified auth flow ---
  authStart: async (data: AuthStartRequest): Promise<AuthStartResponse> => {
    const response = await http.post<AuthStartResponse>("/v1/auth/start", data);
    return response.data;
  },

  verifyCode: async (data: VerifyCodeRequest): Promise<AuthResponse> => {
    const response = await http.post<AuthResponse>(
      "/v1/auth/verify-code",
      data,
    );
    const authData = response.data;
    setAuthTokens(authData);
    return authData;
  },

  createDesktopSession: async (): Promise<DesktopSessionResponse> => {
    const response = await http.post<DesktopSessionResponse>(
      "/v1/auth/create-desktop-session",
    );
    return response.data;
  },

  completeDesktopSession: async (
    data: CompleteDesktopSessionRequest,
  ): Promise<{ success: boolean }> => {
    const response = await http.post<{ success: boolean }>(
      "/v1/auth/complete-desktop-session",
      data,
    );
    return response.data;
  },

  verifyEmail: async (token: string): Promise<AuthResponse> => {
    const response = await http.get<AuthResponse>(
      `/v1/auth/verify-email?token=${token}`,
    );

    const authData = response.data;

    setAuthTokens(authData);

    return authData;
  },

  googleLogin: async (data: GoogleLoginRequest): Promise<AuthResponse> => {
    const response = await http.post<AuthResponse>("/v1/auth/google", data);

    const authData = response.data;

    setAuthTokens(authData);

    return authData;
  },

  resendVerification: async (
    email: string,
  ): Promise<{
    message: string;
    loginSessionId: string;
    verificationLink?: string;
  }> => {
    const response = await http.post<{
      message: string;
      loginSessionId: string;
      verificationLink?: string;
    }>("/v1/auth/resend-verification", { email });
    return response.data;
  },

  pollLogin: async (sessionId: string): Promise<PollLoginResponse> => {
    const response = await http.get<PollLoginResponse>(
      `/v1/auth/poll-login?sessionId=${encodeURIComponent(sessionId)}`,
    );
    return response.data;
  },

  logout: async (): Promise<void> => {
    const refreshToken = getRefreshToken();

    try {
      await http.post("/v1/auth/logout", refreshToken ? { refreshToken } : {});
    } finally {
      clearAuthTokens();
    }
  },

  getCurrentUser: async (): Promise<User> => {
    const response = await http.get<User>("/v1/auth/me");
    return response.data;
  },

  refreshToken: async (): Promise<TokenPair> => {
    const accessToken = await refreshAccessToken();
    const nextRefreshToken = getRefreshToken();

    if (!accessToken || !nextRefreshToken) {
      throw new Error("Failed to refresh token");
    }

    return {
      accessToken,
      refreshToken: nextRefreshToken,
    };
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

import imApi, { accountApi } from "./im";
import workspaceApi from "./workspace";
import notificationApi from "./notification";
import searchApi from "./search";
import applicationsApi from "./applications";
import documentsApi from "./documents";
import routinesApi from "./routines";
import resourcesApi from "./resources";
import skillsApi from "./skills";
import * as pushSubscriptionApi from "./push-subscription";
import * as notificationPreferencesApi from "./notification-preferences";
import propertiesApi from "./properties";
import { viewsApi, tabsApi } from "./views";
import wikisApi from "./wikis";

export const api = {
  auth: authApi,
  user: userApi,
  im: imApi,
  account: accountApi,
  workspace: workspaceApi,
  notification: notificationApi,
  search: searchApi,
  applications: applicationsApi,
  documents: documentsApi,
  routines: routinesApi,
  resources: resourcesApi,
  skills: skillsApi,
  pushSubscription: pushSubscriptionApi,
  notificationPreferences: notificationPreferencesApi,
  properties: propertiesApi,
  views: viewsApi,
  tabs: tabsApi,
  wikis: wikisApi,
};

export default api;
