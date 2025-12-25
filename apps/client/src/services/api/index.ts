import http from "../http";

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
}

// Matrix protocol types
export interface MatrixLoginRequest {
  type: "m.login.password";
  identifier: {
    type: "m.id.user";
    user: string;
  };
  password: string;
  initial_device_display_name?: string;
  refresh_token?: boolean;
}

export interface MatrixLoginResponse {
  user_id: string;
  access_token: string;
  device_id: string;
  home_server?: string;
  well_known?: {
    "m.homeserver": {
      base_url: string;
    };
  };
  expires_in?: number;
  refresh_token?: string;
}

export interface MatrixRegisterRequest {
  username: string;
  password: string;
  auth?: {
    type: string;
    session?: string;
    token?: string;
  };
  initial_device_display_name?: string;
  refresh_token?: boolean;
  inhibit_login?: boolean;
}

export interface MatrixRegisterResponse {
  user_id: string;
  access_token?: string;
  device_id?: string;
  refresh_token?: string;
  expires_in?: number;
}

export interface MatrixWhoamiResponse {
  user_id: string;
  device_id?: string;
  is_guest?: boolean;
}

export interface LoginRequest {
  username: string;
  password: string;
  deviceName?: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
  deviceName?: string;
  registrationToken?: string;
}

export interface LoginResponse {
  token: string;
  user: User;
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
    const matrixRequest: MatrixLoginRequest = {
      type: "m.login.password",
      identifier: {
        type: "m.id.user",
        user: data.username,
      },
      password: data.password,
      initial_device_display_name: data.deviceName,
      refresh_token: true,
    };

    const response = await http.post<MatrixLoginResponse>(
      "/_matrix/client/v3/login",
      matrixRequest,
    );

    const matrixData = response.data;

    // Store tokens
    localStorage.setItem("auth_token", matrixData.access_token);
    if (matrixData.refresh_token) {
      localStorage.setItem("refresh_token", matrixData.refresh_token);
    }
    if (matrixData.device_id) {
      localStorage.setItem("device_id", matrixData.device_id);
    }

    // Transform Matrix response to our User format
    return {
      token: matrixData.access_token,
      user: {
        id: matrixData.user_id,
        name: matrixData.user_id.split(":")[0].substring(1), // Extract localpart from @user:domain
        email: "",
      },
    };
  },

  register: async (data: RegisterRequest): Promise<LoginResponse> => {
    let matrixRequest: MatrixRegisterRequest = {
      username: data.username,
      password: data.password,
      initial_device_display_name: data.deviceName,
      refresh_token: true,
      inhibit_login: false,
    };

    try {
      // First attempt - this will likely return 401 with flows
      const response = await http.post<MatrixRegisterResponse>(
        "/_matrix/client/v3/register",
        matrixRequest,
      );

      const matrixData = response.data;

      // Store tokens if registration didn't inhibit login
      if (matrixData.access_token) {
        localStorage.setItem("auth_token", matrixData.access_token);
        if (matrixData.refresh_token) {
          localStorage.setItem("refresh_token", matrixData.refresh_token);
        }
        if (matrixData.device_id) {
          localStorage.setItem("device_id", matrixData.device_id);
        }
      }

      // Transform Matrix response to our User format
      return {
        token: matrixData.access_token || "",
        user: {
          id: matrixData.user_id,
          name: matrixData.user_id.split(":")[0].substring(1),
          email: "",
        },
      };
    } catch (error: any) {
      // Check if this is a UIA (User-Interactive Authentication) 401 response
      if (error?.response?.status === 401 && error?.response?.data?.flows) {
        const session = error.response.data.session;
        const flows = error.response.data.flows;

        // Check if m.login.dummy is available (most common for open registration)
        const hasDummyAuth = flows.some((flow: any) =>
          flow.stages.includes("m.login.dummy"),
        );

        // Check if registration token is available
        const hasTokenAuth = flows.some((flow: any) =>
          flow.stages.includes("m.login.registration_token"),
        );

        if (hasDummyAuth) {
          // Retry with dummy auth
          matrixRequest.auth = {
            type: "m.login.dummy",
            session: session,
          };

          const retryResponse = await http.post<MatrixRegisterResponse>(
            "/_matrix/client/v3/register",
            matrixRequest,
          );

          const matrixData = retryResponse.data;

          // Store tokens
          if (matrixData.access_token) {
            localStorage.setItem("auth_token", matrixData.access_token);
            if (matrixData.refresh_token) {
              localStorage.setItem("refresh_token", matrixData.refresh_token);
            }
            if (matrixData.device_id) {
              localStorage.setItem("device_id", matrixData.device_id);
            }
          }

          return {
            token: matrixData.access_token || "",
            user: {
              id: matrixData.user_id,
              name: matrixData.user_id.split(":")[0].substring(1),
              email: "",
            },
          };
        } else if (hasTokenAuth && data.registrationToken) {
          // Retry with registration token
          matrixRequest.auth = {
            type: "m.login.registration_token",
            token: data.registrationToken,
            session: session,
          };

          const retryResponse = await http.post<MatrixRegisterResponse>(
            "/_matrix/client/v3/register",
            matrixRequest,
          );

          const matrixData = retryResponse.data;

          // Store tokens
          if (matrixData.access_token) {
            localStorage.setItem("auth_token", matrixData.access_token);
            if (matrixData.refresh_token) {
              localStorage.setItem("refresh_token", matrixData.refresh_token);
            }
            if (matrixData.device_id) {
              localStorage.setItem("device_id", matrixData.device_id);
            }
          }

          return {
            token: matrixData.access_token || "",
            user: {
              id: matrixData.user_id,
              name: matrixData.user_id.split(":")[0].substring(1),
              email: "",
            },
          };
        } else if (hasTokenAuth && !data.registrationToken) {
          // Token required but not provided
          throw new Error(
            "Registration token required. Please contact your administrator for a registration token.",
          );
        } else {
          // Registration requires other auth methods not supported
          throw new Error(
            `Registration requires authentication methods: ${flows
              .map((f: any) => f.stages.join(", "))
              .join(" or ")}`,
          );
        }
      }

      // Re-throw if it's not a UIA error
      throw error;
    }
  },

  logout: async (): Promise<void> => {
    await http.post("/_matrix/client/v3/logout", {});
    localStorage.removeItem("auth_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("device_id");
  },

  logoutAll: async (): Promise<void> => {
    await http.post("/_matrix/client/v3/logout/all", {});
    localStorage.removeItem("auth_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("device_id");
  },

  getCurrentUser: async (): Promise<User> => {
    const response = await http.get<MatrixWhoamiResponse>(
      "/_matrix/client/v3/account/whoami",
    );

    const matrixData = response.data;

    return {
      id: matrixData.user_id,
      name: matrixData.user_id.split(":")[0].substring(1),
      email: "",
    };
  },

  refreshToken: async (): Promise<{ token: string }> => {
    const refreshToken = localStorage.getItem("refresh_token");

    if (!refreshToken) {
      throw new Error("No refresh token available");
    }

    const response = await http.post<{
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    }>("/_matrix/client/v3/refresh", {
      refresh_token: refreshToken,
    });

    const data = response.data;

    localStorage.setItem("auth_token", data.access_token);
    if (data.refresh_token) {
      localStorage.setItem("refresh_token", data.refresh_token);
    }

    return { token: data.access_token };
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

export const api = {
  auth: authApi,
  user: userApi,
};

export default api;
