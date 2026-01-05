/**
 * Generic HTTP API Tool
 * A flexible tool for calling any HTTP API with configurable authentication
 */

import type {
  ToolDefinition,
  ToolExecutor,
  Tool,
  ToolResult,
} from '@team9/agent-framework';

/**
 * Authentication configuration for HTTP API Tool
 */
export interface HttpApiAuthConfig {
  /** Authentication type */
  type: 'none' | 'api_key' | 'bearer' | 'basic';
  /** API key value (for api_key type) */
  apiKey?: string;
  /** Where to put the API key: query, header */
  apiKeyLocation?: 'query' | 'header';
  /** Parameter name for API key (default: 'key' for query, 'X-API-Key' for header) */
  apiKeyName?: string;
  /** Bearer token (for bearer type) */
  bearerToken?: string;
  /** Basic auth username (for basic type) */
  username?: string;
  /** Basic auth password (for basic type) */
  password?: string;
}

/**
 * Configuration for HTTP API Tool
 */
export interface HttpApiToolConfig {
  /** Tool name (unique identifier) */
  name: string;
  /** Tool description for LLM */
  description: string;
  /** Base URL for the API */
  baseUrl: string;
  /** Authentication configuration */
  auth?: HttpApiAuthConfig;
  /** Default headers to include in all requests */
  defaultHeaders?: Record<string, string>;
  /** Request timeout in milliseconds (defaults to 30000) */
  timeout?: number;
  /** Parameter schema for the tool */
  parameters?: ToolDefinition['parameters'];
  /** Tool category */
  category?: 'common' | 'agent' | 'workflow';
}

/**
 * Default parameters for generic HTTP API tool
 */
const defaultHttpApiParameters: ToolDefinition['parameters'] = {
  type: 'object',
  properties: {
    method: {
      type: 'string',
      description: 'HTTP method',
      enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    },
    path: {
      type: 'string',
      description: 'API endpoint path (appended to base URL)',
    },
    query: {
      type: 'object',
      description: 'Query parameters as key-value pairs',
    },
    body: {
      type: 'object',
      description: 'Request body for POST/PUT/PATCH requests',
    },
    headers: {
      type: 'object',
      description: 'Additional headers to include in the request',
    },
  },
  required: ['method', 'path'],
};

/**
 * Create HTTP API tool executor with configuration
 */
export function createHttpApiExecutor(config: HttpApiToolConfig): ToolExecutor {
  const { baseUrl, auth, defaultHeaders = {}, timeout = 30000 } = config;

  return async (args, context): Promise<ToolResult> => {
    const { method, path, query, body, headers } = args as {
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      path: string;
      query?: Record<string, unknown>;
      body?: Record<string, unknown>;
      headers?: Record<string, string>;
    };

    try {
      // Build URL
      const urlPath = path.startsWith('/') ? path : `/${path}`;
      const urlObj = new URL(`${baseUrl}${urlPath}`);

      // Add query parameters
      if (query) {
        for (const [key, value] of Object.entries(query)) {
          if (value !== undefined && value !== null) {
            urlObj.searchParams.set(key, String(value));
          }
        }
      }

      // Add API key to query if configured
      if (auth?.type === 'api_key' && auth.apiKeyLocation === 'query') {
        const keyName = auth.apiKeyName || 'key';
        if (auth.apiKey) {
          urlObj.searchParams.set(keyName, auth.apiKey);
          console.log(
            `[HttpApiTool] Added API key to query: ${keyName}=***${auth.apiKey.slice(-4)}`,
          );
        } else {
          console.warn('[HttpApiTool] API key is configured but empty!');
        }
      }

      // Debug: log final URL (with key masked)
      const debugUrl = urlObj.toString().replace(/key=[^&]+/, 'key=***');
      console.log(`[HttpApiTool] Request: ${method} ${debugUrl}`);

      // Build headers
      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        ...defaultHeaders,
        ...headers,
      };

      // Add authentication headers
      if (auth) {
        switch (auth.type) {
          case 'api_key':
            if (auth.apiKeyLocation === 'header' && auth.apiKey) {
              const headerName = auth.apiKeyName || 'X-API-Key';
              requestHeaders[headerName] = auth.apiKey;
            }
            break;
          case 'bearer':
            if (auth.bearerToken) {
              requestHeaders['Authorization'] = `Bearer ${auth.bearerToken}`;
            }
            break;
          case 'basic':
            if (auth.username && auth.password) {
              const encoded = Buffer.from(
                `${auth.username}:${auth.password}`,
              ).toString('base64');
              requestHeaders['Authorization'] = `Basic ${encoded}`;
            }
            break;
        }
      }

      // Prepare fetch options
      const fetchOptions: RequestInit = {
        method,
        headers: requestHeaders,
        signal: context.signal,
      };

      // Add body for POST/PUT/PATCH requests
      if (['POST', 'PUT', 'PATCH'].includes(method) && body) {
        fetchOptions.body = JSON.stringify(body);
      }

      // Create timeout controller if no signal provided
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      if (!context.signal) {
        const controller = new AbortController();
        fetchOptions.signal = controller.signal;
        timeoutId = setTimeout(() => controller.abort(), timeout);
      }

      try {
        const response = await fetch(urlObj.toString(), fetchOptions);

        // Clear timeout if set
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        // Parse response
        const contentType = response.headers.get('content-type');
        let data: unknown;

        if (contentType?.includes('application/json')) {
          data = await response.json();
        } else {
          data = await response.text();
        }

        // Check response status
        if (!response.ok) {
          return {
            callId: context.callId,
            success: false,
            content: data,
            error: `HTTP ${response.status}: ${response.statusText}`,
          };
        }

        return {
          callId: context.callId,
          success: true,
          content: data,
        };
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    } catch (error) {
      // Handle abort
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          callId: context.callId,
          success: false,
          content: null,
          error: 'Request aborted or timed out',
        };
      }

      return {
        callId: context.callId,
        success: false,
        content: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

/**
 * Create a complete HTTP API Tool with executor
 */
export function createHttpApiTool(config: HttpApiToolConfig): Tool {
  const definition: ToolDefinition = {
    name: config.name,
    description: config.description,
    parameters: config.parameters || defaultHttpApiParameters,
    awaitsExternalResponse: false,
  };

  return {
    definition,
    executor: createHttpApiExecutor(config),
    category: config.category || 'common',
  };
}

// ============================================
// Semrush API Tool (built on top of HTTP API)
// ============================================

/**
 * Configuration for Semrush API Tool
 */
export interface SemrushApiToolConfig {
  /** Semrush API key (if not provided, will use SEMRUSH_API_KEY env var) */
  apiKey?: string;
  /** Request timeout in milliseconds (defaults to 30000) */
  timeout?: number;
}

/**
 * Create Semrush API Tool (Standard Analytics API)
 */
export function createSemrushApiTool(config: SemrushApiToolConfig = {}): Tool {
  const apiKey = config.apiKey || process.env.SEMRUSH_API_KEY;
  console.log(
    `[createSemrushApiTool] API key configured: ${apiKey ? `***${apiKey.slice(-4)}` : 'NOT SET'}`,
  );

  return createHttpApiTool({
    name: 'semrush_api',
    description: `Call Semrush Analytics API. API key is auto-injected.

Base URL: https://api.semrush.com/
All requests use path="/" with report type in query.type parameter.

Report types (query.type):
Domain Reports:
- domain_ranks: Domain rankings across all databases
- domain_rank: Domain rank in specific database
- domain_organic: Organic keywords for domain
- domain_adwords: Paid keywords for domain
- domain_organic_organic: Organic competitors

Keyword Reports:
- phrase_all: Keyword overview
- phrase_organic: Organic results for keyword
- phrase_adwords: Paid results for keyword
- phrase_related: Related keywords

Backlinks:
- backlinks_overview: Backlinks summary
- backlinks: Backlinks list

Required query params:
- type: Report type (see above)
- domain: Target domain (for domain_* reports)
- phrase: Target keyword (for phrase_* reports)
- database: Region code (us/uk/de/fr/ru/jp/br/etc) - required for most reports

Optional query params:
- export_columns: Columns to return (e.g., "Ph,Po,Nq,Cp,Ur,Tr")
- display_limit: Max results
- display_offset: Skip N results
- display_sort: Sort order (e.g., "tr_desc")

Examples:
1. Domain rankings: method=GET, path="/", query={type:"domain_ranks", domain:"amazon.com"}
2. Organic keywords: method=GET, path="/", query={type:"domain_organic", domain:"example.com", database:"us", display_limit:10}
3. Keyword research: method=GET, path="/", query={type:"phrase_all", phrase:"seo tools", database:"us"}`,
    baseUrl: 'https://api.semrush.com',
    auth: apiKey
      ? {
          type: 'api_key',
          apiKey,
          apiKeyLocation: 'query',
          apiKeyName: 'key',
        }
      : { type: 'none' },
    timeout: config.timeout || 30000,
    category: 'common',
  });
}

/**
 * Default Semrush API Tool instance
 */
export const semrushApiTool = createSemrushApiTool();
