import {
  IsString,
  IsOptional,
  IsUUID,
  IsArray,
  IsObject,
  IsBoolean,
  IsIn,
  IsUrl,
  ValidateNested,
  ValidateIf,
  MaxLength,
  IsNumber,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { sanitizeMessageContent } from '../utils/sanitize-content.js';

/**
 * fileUrl protocol allowlist.
 *
 * Production / staging require https so that:
 *  - A malicious sender cannot make a recipient's browser auto-fetch
 *    `http://localhost:<port>/...` to silently hit the recipient's local
 *    services (CSRF / internal port scanning). RFC1918 / loopback hosts
 *    almost never have a valid public-CA https cert, so https-only kills
 *    the silent-load path even when require_tld is off.
 *  - Mixed-content blocking on https-served clients adds defense in depth.
 *
 * Dev / test allow http so capability-hub on `http://localhost:9002` works
 * end-to-end without TLS.
 */
const ALLOWED_FILE_URL_PROTOCOLS: ('http' | 'https')[] =
  process.env.NODE_ENV === 'production' ? ['https'] : ['http', 'https'];

/**
 * One attachment on an outgoing message. Two ingestion paths:
 *  - Owned upload: client uploaded to team9's own S3 (presign → S3 → confirm)
 *    and supplies the resulting `fileKey`. The durable `fileUrl` is derived
 *    server-side from `${S3_PUBLIC_URL}/${fileKey}`.
 *  - External pass-through: bytes already live at a stable third-party URL
 *    (e.g. capability-hub-mirrored agent output). Client supplies `fileUrl`
 *    directly; team9 stores it as-is. Caller is responsible for the URL's
 *    durability and public reachability — team9 will not re-fetch.
 *
 * Exactly one of `fileKey` / `fileUrl` must be set.
 */
export class AttachmentDto {
  @ValidateIf((o: AttachmentDto) => !o.fileUrl)
  @IsString()
  fileKey?: string;

  @ValidateIf((o: AttachmentDto) => !o.fileKey)
  // require_tld: false so internal hosts (capability-hub on localhost in dev,
  // private cluster DNS like `capability-hub.svc.cluster.local`, raw IPs)
  // pass format validation in dev. Hostile / silent-CSRF schemes are
  // gated by ALLOWED_FILE_URL_PROTOCOLS — production drops `http` so a
  // malicious sender cannot point a recipient's browser at a plaintext
  // local-network endpoint via auto-loading `<img>` / `<video>` tags.
  @IsUrl({
    require_protocol: true,
    require_tld: false,
    protocols: ALLOWED_FILE_URL_PROTOCOLS,
  })
  @MaxLength(2048)
  fileUrl?: string;

  @IsString()
  @MaxLength(500)
  fileName: string;

  @IsString()
  mimeType: string;

  @IsNumber() // in bytes
  fileSize: number;
}

/**
 * Identifies which client originated a message, so downstream agent runtimes
 * can reason about the user's current device context (e.g. when an agent has
 * access to ahand backends, it can prefer the MacApp the user is currently on).
 *
 * Persisted into `messages.metadata.clientContext`; not indexed or queried.
 */
export class ClientContextDto {
  @IsIn(['macapp', 'web'])
  kind: 'macapp' | 'web';

  @IsString()
  @IsOptional()
  deviceId?: string | null;
}

export class CreateMessageDto {
  @IsString()
  @IsOptional()
  @MaxLength(64)
  clientMsgId?: string;

  @IsString()
  @MaxLength(100000)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? sanitizeMessageContent(value) : value,
  )
  content: string;

  @IsUUID()
  @IsOptional()
  parentId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  @IsOptional()
  attachments?: AttachmentDto[];

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;

  /**
   * Originating-client attribution. When provided, the controller merges it
   * into `metadata.clientContext` before persistence. Accepting it as a
   * top-level field matches the Stream E client's send_message wire shape.
   */
  @ValidateNested()
  @Type(() => ClientContextDto)
  @IsOptional()
  clientContext?: ClientContextDto;

  @IsBoolean()
  @IsOptional()
  skipBroadcast?: boolean;

  @IsObject()
  @IsOptional()
  properties?: Record<string, unknown>;

  // Lexical serialized EditorState produced by the rich-text composer. When
  // present, the client renders this directly via React elements (no HTML
  // sink); `content` is kept as plaintext for search, notifications, and
  // older clients. The service layer re-derives `content` from the AST on
  // write to guarantee they stay in sync.
  @IsObject()
  @IsOptional()
  contentAst?: Record<string, unknown>;
}
