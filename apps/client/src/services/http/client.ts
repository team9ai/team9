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

  private buildURL(url: string, params?: Record<string, any>): string {
    const fullURL = url.startsWith("http") ? url : `${this.baseURL}${url}`;

    if (!params) return fullURL;

    const urlObj = new URL(fullURL);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        urlObj.searchParams.append(key, String(value));
      }
    });

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

  private async applyErrorInterceptors(error: HttpError): Promise<never> {
    let finalError = error;

    for (const { onRejected } of this.responseInterceptors) {
      if (onRejected) {
        try {
          await onRejected(finalError);
        } catch (err) {
          finalError = err as HttpError;
        }
      }
    }

    throw finalError;
  }

  private createError(
    message: string,
    config?: HttpRequestConfig,
    code?: string,
    response?: HttpResponse,
  ): HttpError {
    const error = new Error(message) as HttpError;
    error.config = config;
    error.code = code;
    error.response = response;
    error.status = response?.status;
    return error;
  }

  private async request<T = any>(
    url: string,
    config: HttpRequestConfig = {},
  ): Promise<HttpResponse<T>> {
    try {
      let requestConfig = await this.applyRequestInterceptors({
        ...config,
        baseURL: this.baseURL,
        url, // Save the URL for potential retry
      });

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

      const contentType = response.headers.get("content-type");
      let data: T;

      if (contentType?.includes("application/json")) {
        data = await response.json();
      } else {
        data = (await response.text()) as any;
      }

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
    } catch (error: any) {
      if (error.name === "AbortError") {
        throw this.createError("Request timeout", config, "ECONNABORTED");
      }

      if (error instanceof Error && !("config" in error)) {
        throw this.createError(error.message, config, "ERR_NETWORK", undefined);
      }

      return await this.applyErrorInterceptors(error as HttpError);
    }
  }

  async get<T = any>(
    url: string,
    config?: HttpRequestConfig,
  ): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...config, method: "GET" });
  }

  async post<T = any>(
    url: string,
    data?: any,
    config?: HttpRequestConfig,
  ): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...config, method: "POST", data });
  }

  async put<T = any>(
    url: string,
    data?: any,
    config?: HttpRequestConfig,
  ): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...config, method: "PUT", data });
  }

  async patch<T = any>(
    url: string,
    data?: any,
    config?: HttpRequestConfig,
  ): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...config, method: "PATCH", data });
  }

  async delete<T = any>(
    url: string,
    config?: HttpRequestConfig,
  ): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...config, method: "DELETE" });
  }
}

export default HttpClient;
