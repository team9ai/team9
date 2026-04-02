import type {
  HttpRequestConfig,
  HttpResponse,
  HttpError,
  RequestInterceptor,
  ResponseInterceptor,
  ErrorInterceptor,
  InterceptorManager,
} from "./types";

class HttpClient {
  private baseURL: string;
  private timeout: number;
  private defaultHeaders: HeadersInit;
  private requestInterceptors: RequestInterceptor[] = [];
  private responseInterceptors: Array<{
    onFulfilled: ResponseInterceptor;
    onRejected?: ErrorInterceptor;
  }> = [];

  constructor(config: HttpRequestConfig = {}) {
    this.baseURL = config.baseURL || "";
    this.timeout = config.timeout || 30000;
    this.defaultHeaders = config.headers || {
      "Content-Type": "application/json",
    };
  }

  get interceptors(): InterceptorManager {
    return {
      request: {
        use: (onFulfilled: RequestInterceptor) => {
          this.requestInterceptors.push(onFulfilled);
          return this.requestInterceptors.length - 1;
        },
        eject: (id: number) => {
          this.requestInterceptors.splice(id, 1);
        },
      },
      response: {
        use: (
          onFulfilled: ResponseInterceptor,
          onRejected?: ErrorInterceptor,
        ) => {
          this.responseInterceptors.push({ onFulfilled, onRejected });
          return this.responseInterceptors.length - 1;
        },
        eject: (id: number) => {
          this.responseInterceptors.splice(id, 1);
        },
      },
    };
  }

  private buildURL(url: string, params?: object): string {
    const fullURL = url.startsWith("http") ? url : `${this.baseURL}${url}`;

    if (!params) return fullURL;

    const urlObj = new URL(fullURL);
    Object.entries(params as Record<string, unknown>).forEach(
      ([key, value]) => {
        if (value !== undefined && value !== null) {
          urlObj.searchParams.append(key, String(value));
        }
      },
    );

    return urlObj.toString();
  }

  private async applyRequestInterceptors(
    config: HttpRequestConfig,
  ): Promise<HttpRequestConfig> {
    let finalConfig = { ...config };

    for (const interceptor of this.requestInterceptors) {
      finalConfig = await interceptor(finalConfig);
    }

    return finalConfig;
  }

  private async applyResponseInterceptors<T>(
    response: HttpResponse<T>,
  ): Promise<HttpResponse<T>> {
    let finalResponse = response;

    for (const { onFulfilled } of this.responseInterceptors) {
      finalResponse = await onFulfilled(finalResponse);
    }

    return finalResponse;
  }

  private async applyErrorInterceptors<T>(
    error: HttpError<T>,
  ): Promise<HttpResponse<T>> {
    let finalError = error;

    for (const { onRejected } of this.responseInterceptors) {
      if (onRejected) {
        try {
          const recoveredResponse = await onRejected(finalError);
          return recoveredResponse as HttpResponse<T>;
        } catch (err) {
          finalError = err as HttpError<T>;
        }
      }
    }

    throw finalError;
  }

  private createError<T = unknown>(
    message: string,
    config?: HttpRequestConfig,
    code?: string,
    response?: HttpResponse<T>,
  ): HttpError<T> {
    const error = new Error(message) as HttpError<T>;
    error.config = config;
    error.code = code;
    error.response = response;
    error.status = response?.status;
    return error;
  }

  private async parseResponseData<T>(response: Response): Promise<T> {
    if (response.headers.get("content-type")?.includes("application/json")) {
      return (await response.json()) as T;
    }

    return (await response.text()) as T;
  }

  private isAbortError(error: unknown): error is Error {
    return error instanceof Error && error.name === "AbortError";
  }

  private isManagedHttpError(error: unknown): error is HttpError {
    return (
      error instanceof Error &&
      ("config" in error ||
        "code" in error ||
        "status" in error ||
        "response" in error)
    );
  }

  private async request<T = unknown>(
    url: string,
    config: HttpRequestConfig = {},
  ): Promise<HttpResponse<T>> {
    let requestConfig: HttpRequestConfig = {
      ...config,
      baseURL: this.baseURL,
      url,
    };

    try {
      requestConfig = await this.applyRequestInterceptors(requestConfig);

      const fullURL = this.buildURL(url, requestConfig.params);

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        requestConfig.timeout || this.timeout,
      );

      const headers = new Headers({
        ...this.defaultHeaders,
        ...requestConfig.headers,
      });

      let body: string | FormData | undefined;
      if (requestConfig.data) {
        if (requestConfig.data instanceof FormData) {
          body = requestConfig.data;
          headers.delete("Content-Type");
        } else {
          body = JSON.stringify(requestConfig.data);
        }
      }

      const response = await fetch(fullURL, {
        ...requestConfig,
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await this.parseResponseData<T>(response);

      const httpResponse: HttpResponse<T> = {
        data,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        config: requestConfig,
      };

      if (!response.ok) {
        throw this.createError(
          `Request failed with status ${response.status}`,
          requestConfig,
          `ERR_${response.status}`,
          httpResponse,
        );
      }

      return await this.applyResponseInterceptors(httpResponse);
    } catch (error: unknown) {
      if (this.isAbortError(error)) {
        throw this.createError(
          "Request timeout",
          requestConfig,
          "ECONNABORTED",
        );
      }

      if (error instanceof Error && !this.isManagedHttpError(error)) {
        throw this.createError(
          error.message,
          requestConfig,
          "ERR_NETWORK",
          undefined,
        );
      }

      return await this.applyErrorInterceptors(error as HttpError<T>);
    }
  }

  async get<T = unknown>(
    url: string,
    config?: HttpRequestConfig,
  ): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...config, method: "GET" });
  }

  async post<T = unknown>(
    url: string,
    data?: unknown,
    config?: HttpRequestConfig,
  ): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...config, method: "POST", data });
  }

  async put<T = unknown>(
    url: string,
    data?: unknown,
    config?: HttpRequestConfig,
  ): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...config, method: "PUT", data });
  }

  async patch<T = unknown>(
    url: string,
    data?: unknown,
    config?: HttpRequestConfig,
  ): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...config, method: "PATCH", data });
  }

  async delete<T = unknown>(
    url: string,
    config?: HttpRequestConfig,
  ): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...config, method: "DELETE" });
  }
}

export default HttpClient;
