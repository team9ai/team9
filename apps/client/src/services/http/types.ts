export interface HttpRequestConfig extends RequestInit {
  baseURL?: string;
  timeout?: number;
  params?: Record<string, any>;
  data?: any;
}

export interface HttpResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: Headers;
  config: HttpRequestConfig;
}

export interface HttpError extends Error {
  config?: HttpRequestConfig;
  code?: string;
  status?: number;
  response?: HttpResponse;
}

export type RequestInterceptor = (
  config: HttpRequestConfig,
) => HttpRequestConfig | Promise<HttpRequestConfig>;

export type ResponseInterceptor = <T = any>(
  response: HttpResponse<T>,
) => HttpResponse<T> | Promise<HttpResponse<T>>;

export type ErrorInterceptor = (
  error: HttpError,
) => Promise<never> | Promise<any>;

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
