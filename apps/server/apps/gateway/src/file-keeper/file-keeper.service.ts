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
   * Calls GET /api/instances/{instanceId}/data-dir?path=workspace
   * Returns directory entries (each directory = one workspace).
   * If the workspace directory contains files directly (no subdirectories),
   * it is treated as a single "default" workspace.
   */
  async listWorkspaces(instanceId: string): Promise<FileKeeperDirEntry[]> {
    if (!this.isConfigured()) {
      this.logger.debug('File-Keeper not configured, skipping listWorkspaces');
      return [];
    }

    try {
      const result = await this.request<FileKeeperListResponse>(
        'GET',
        `/api/instances/${instanceId}/data-dir?path=workspace`,
        instanceId,
      );

      const directories = result.entries.filter((e) => e.type === 'directory');

      // If workspace/ has subdirectories, each is a named workspace
      if (directories.length > 0) {
        return directories;
      }

      // If workspace/ has files but no subdirectories, the OpenClaw daemon
      // stores the default workspace content directly in workspace/
      if (result.entries.length > 0) {
        // Find the most recent modification time among entries
        const latestModified = result.entries.reduce((latest, e) => {
          return e.modified > latest ? e.modified : latest;
        }, result.entries[0].modified);

        return [
          {
            name: 'default',
            type: 'directory' as const,
            modified: latestModified,
          },
        ];
      }

      return [];
    } catch (error) {
      // 404 = workspace directory doesn't exist yet (new instance)
      if (error instanceof Error && error.message.includes('404')) {
        this.logger.debug(`No workspace directory for instance ${instanceId}`);
        return [];
      }
      this.logger.warn(
        `Failed to list workspaces for instance ${instanceId}: ${error}`,
      );
      return [];
    }
  }

  /**
   * Issue a scoped JWT token for the frontend to call file-keeper directly.
   * Returns the token, base URL, instanceId, and expiration time.
   */
  issueToken(
    instanceId: string,
    scopes: string[] = ['workspace-dir'],
  ): { token: string; baseUrl: string; instanceId: string; expiresAt: string } {
    if (!this.isConfigured()) {
      throw new Error('File-Keeper is not configured');
    }
    const token = this.signToken(instanceId, scopes);
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
    return {
      token,
      baseUrl: this.baseUrl!,
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
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
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
