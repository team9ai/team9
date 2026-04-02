import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { env } from '@team9/shared';

// ── Response types from file-keeper ───────────────────────────────────

export interface FileKeeperDirEntry {
  name: string;
  type: 'file' | 'directory';
  size?: number;
  modified: string;
}

export interface FileKeeperListResponse {
  path: string;
  entries: FileKeeperDirEntry[];
}

// ── Service ──────────────────────────────────────────────────────────

@Injectable()
export class FileKeeperService {
  private readonly logger = new Logger(FileKeeperService.name);

  private get baseUrl(): string | undefined {
    return env.FILE_KEEPER_BASE_URL;
  }

  private get jwtSecret(): string | undefined {
    return env.FILE_KEEPER_JWT_SECRET;
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private isNotFoundError(error: unknown): boolean {
    return error instanceof Error && error.message.includes('404');
  }

  /**
   * Whether the File-Keeper integration is configured.
   * If false, all API calls will be skipped gracefully.
   */
  isConfigured(): boolean {
    return !!this.baseUrl && !!this.jwtSecret;
  }

  // ── API methods ────────────────────────────────────────────────────

  /**
   * List workspace directories for an instance.
   *
   * Discovers workspaces in two formats:
   * 1. Sibling directories: .openclaw/workspace-{name}/ (preferred, new format)
   * 2. Subdirectories: .openclaw/workspace/{name}/ (legacy format)
   *
   * Also detects the "default" workspace (files directly in .openclaw/workspace/).
   */
  async listWorkspaces(
    instanceId: string,
    baseUrl?: string,
  ): Promise<FileKeeperDirEntry[]> {
    const resolvedBaseUrl = baseUrl || this.baseUrl;
    if (!resolvedBaseUrl || !this.jwtSecret) {
      this.logger.debug('File-Keeper not configured, skipping listWorkspaces');
      return [];
    }

    const workspaces = new Map<string, FileKeeperDirEntry>();

    // Fetch both directory listings in parallel
    const [rootSettled, wsSettled] = await Promise.allSettled([
      this.request<FileKeeperListResponse>(
        'GET',
        `/api/instances/${instanceId}/data-dir?path=.`,
        instanceId,
        undefined,
        resolvedBaseUrl,
      ),
      this.request<FileKeeperListResponse>(
        'GET',
        `/api/instances/${instanceId}/data-dir?path=workspace`,
        instanceId,
        undefined,
        resolvedBaseUrl,
      ),
    ]);

    // 1. Process .openclaw/ root for workspace-{name} sibling directories
    if (rootSettled.status === 'fulfilled') {
      for (const entry of rootSettled.value.entries) {
        if (entry.type === 'directory' && entry.name.startsWith('workspace-')) {
          const name = entry.name.slice('workspace-'.length);
          if (name) {
            workspaces.set(name, { ...entry, name });
          }
        }
      }
    } else {
      const error: unknown = rootSettled.reason;
      if (!this.isNotFoundError(error)) {
        this.logger.warn(
          `Failed to scan root for instance ${instanceId}: ${this.getErrorMessage(error)}`,
        );
      }
    }

    // 2. Process .openclaw/workspace/ for subdirectory workspaces and default workspace
    if (wsSettled.status === 'fulfilled') {
      const directories = wsSettled.value.entries.filter(
        (e) => e.type === 'directory',
      );

      // Add subdirectory workspaces (only if not already found as sibling)
      for (const dir of directories) {
        if (!workspaces.has(dir.name)) {
          workspaces.set(dir.name, dir);
        }
      }

      // Detect default workspace (files directly in workspace/ with no subdirectories)
      if (directories.length === 0 && wsSettled.value.entries.length > 0) {
        const latestModified = wsSettled.value.entries.reduce((latest, e) => {
          return e.modified > latest ? e.modified : latest;
        }, wsSettled.value.entries[0].modified);

        if (!workspaces.has('default')) {
          workspaces.set('default', {
            name: 'default',
            type: 'directory' as const,
            modified: latestModified,
          });
        }
      }
    } else {
      const error: unknown = wsSettled.reason;
      if (!this.isNotFoundError(error)) {
        this.logger.warn(
          `Failed to list workspaces for instance ${instanceId}: ${this.getErrorMessage(error)}`,
        );
      }
    }

    if (workspaces.size === 0) {
      this.logger.debug(`No workspaces found for instance ${instanceId}`);
    }

    return Array.from(workspaces.values());
  }

  /**
   * Issue a scoped JWT token for the frontend to call file-keeper directly.
   * Returns the token, base URL, instanceId, and expiration time.
   */
  issueToken(
    instanceId: string,
    scopes: string[] = ['workspace-dir'],
    baseUrl?: string,
  ): { token: string; baseUrl: string; instanceId: string; expiresAt: string } {
    const resolvedBaseUrl = baseUrl || this.baseUrl;
    if (!resolvedBaseUrl || !this.jwtSecret) {
      throw new Error('File-Keeper is not configured');
    }
    const token = this.signToken(instanceId, scopes);
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
    return {
      token,
      baseUrl: resolvedBaseUrl,
      instanceId,
      expiresAt,
    };
  }

  // ── JWT signing ────────────────────────────────────────────────────

  /**
   * Sign a HS256 JWT compatible with file-keeper's auth.Claims structure.
   * Uses Node.js built-in crypto (zero external dependencies).
   */
  private signToken(
    instanceId: string,
    scopes: string[] = ['data-dir:ro'],
  ): string {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: 'file-keeper',
      sub: instanceId,
      iat: now,
      exp: now + 3600,
      instance_id: instanceId,
      scopes,
    };

    const header = Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    ).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.jwtSecret!)
      .update(`${header}.${body}`)
      .digest('base64url');

    return `${header}.${body}.${signature}`;
  }

  // ── Internal helpers ───────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    instanceId: string,
    scopes?: string[],
    baseUrl?: string,
  ): Promise<T> {
    const url = `${baseUrl || this.baseUrl}${path}`;
    const token = this.signToken(instanceId, scopes);

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `File-Keeper API error: ${method} ${path} responded ${res.status} — ${text}`,
      );
    }

    if (res.status === 204 || res.headers.get('content-length') === '0') {
      return undefined as unknown as T;
    }

    return (await res.json()) as T;
  }
}
