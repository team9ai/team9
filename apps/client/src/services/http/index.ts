import HttpClient from "./client";
import {
  requestLogger,
  responseLogger,
  errorLogger,
  authInterceptor,
  handleUnauthorized,
} from "./interceptors";

const http = new HttpClient({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api",
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

http.interceptors.request.use(authInterceptor);
http.interceptors.request.use(requestLogger);
http.interceptors.response.use(responseLogger, errorLogger);
http.interceptors.response.use((response) => response, handleUnauthorized);

export default http;

export { HttpClient };
export * from "./types";
export * from "./errors";
export * from "./interceptors";
