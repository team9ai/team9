export interface HttpRequestConfig extends RequestInit {
  baseURL?: string;
  url?: string;
  timeout?: number;
  params?: object;
  data?: unknown;
}

export interface HttpResponse<T = unknown> {
  data: T;
  status: number;
  statusText: string;
  headers: Headers;
  config: HttpRequestConfig;
}

export interface HttpError<T = unknown> extends Error {
  config?: HttpRequestConfig;
  code?: string;
  status?: number;
  response?: HttpResponse<T>;
}

export type RequestInterceptor = (
  config: HttpRequestConfig,
) => HttpRequestConfig | Promise<HttpRequestConfig>;

export type ResponseInterceptor = <T = unknown>(
  response: HttpResponse<T>,
) => HttpResponse<T> | Promise<HttpResponse<T>>;

export type ErrorInterceptor = (
  error: HttpError,
) => Promise<never> | Promise<HttpResponse<unknown>>;

export interface InterceptorManager {
  request: {
    use: (onFulfilled: RequestInterceptor) => number;
    eject: (id: number) => void;
  };
  response: {
    use: (
      onFulfilled: ResponseInterceptor,
      onRejected?: ErrorInterceptor,
    ) => number;
    eject: (id: number) => void;
  };
}
