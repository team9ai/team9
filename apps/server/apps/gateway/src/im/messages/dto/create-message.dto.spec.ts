import 'reflect-metadata';
import { describe, it, expect, afterEach, jest } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AttachmentDto } from './create-message.dto.js';

async function findError(
  dto: AttachmentDto,
  property: keyof AttachmentDto,
): Promise<string[] | undefined> {
  const errors = await validate(dto);
  return errors.find((e) => e.property === property)?.constraints
    ? Object.values(errors.find((e) => e.property === property)!.constraints!)
    : undefined;
}

describe('AttachmentDto', () => {
  function build(input: Partial<AttachmentDto>): AttachmentDto {
    return plainToInstance(AttachmentDto, {
      fileName: 'video.mp4',
      mimeType: 'video/mp4',
      fileSize: 1024,
      ...input,
    });
  }

  it('accepts a fileKey-only owned-upload attachment', async () => {
    const dto = build({ fileKey: 'workspace-x/2026/04/29/abc.mp4' });
    expect(await validate(dto)).toEqual([]);
  });

  it('accepts a fileUrl-only external pass-through attachment', async () => {
    const dto = build({
      fileUrl: 'https://capability-hub.example/seedance/abc.mp4',
    });
    expect(await validate(dto)).toEqual([]);
  });

  it('accepts localhost-only fileUrl (capability-hub in local dev)', async () => {
    // Regression: the production /api/v1/files/presign-less path uses raw
    // `http://localhost:9002/...` URLs for capability-hub-mirrored content.
    // require_tld must be off so class-validator does not reject them.
    const dto = build({
      fileUrl:
        'http://localhost:9002/capability-hub/seedance/2026/04/29/019dd95e.mp4',
    });
    expect(await validate(dto)).toEqual([]);
  });

  it('accepts private/internal cluster DNS for fileUrl', async () => {
    const dto = build({
      fileUrl: 'http://capability-hub.svc.cluster.local/file.mp4',
    });
    expect(await validate(dto)).toEqual([]);
  });

  it('rejects fileUrl without protocol (require_protocol: true)', async () => {
    const dto = build({ fileUrl: 'capability-hub.example/file.mp4' });
    expect(await findError(dto, 'fileUrl')).toBeDefined();
  });

  it('rejects javascript: / file: schemes (allowlist enforced)', async () => {
    const jsDto = build({
      fileUrl: 'javascript:alert(1)' as unknown as string,
    });
    expect(await findError(jsDto, 'fileUrl')).toBeDefined();

    const fileDto = build({ fileUrl: 'file:///etc/passwd' });
    expect(await findError(fileDto, 'fileUrl')).toBeDefined();
  });

  it('rejects an attachment with neither fileKey nor fileUrl', async () => {
    const dto = build({});
    const errs = await validate(dto);
    // Both validators trip when both are missing.
    expect(errs.some((e) => e.property === 'fileKey')).toBe(true);
    expect(errs.some((e) => e.property === 'fileUrl')).toBe(true);
  });
});

// The protocol allowlist is fixed when create-message.dto.ts is loaded, so
// switching NODE_ENV at runtime no longer toggles it. This block reloads the
// module under a stubbed NODE_ENV to lock in the production-only-https rule.
describe('AttachmentDto fileUrl protocol allowlist (NODE_ENV-sensitive)', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.resetModules();
  });

  async function importFresh(): Promise<{
    new (): AttachmentDto;
  }> {
    const mod = (await import(`./create-message.dto.js?t=${Date.now()}`)) as {
      AttachmentDto: new () => AttachmentDto;
    };
    return mod.AttachmentDto;
  }

  it('rejects http fileUrl in production', async () => {
    process.env.NODE_ENV = 'production';
    jest.resetModules();
    const Cls = await importFresh();
    const dto = plainToInstance(Cls, {
      fileName: 'video.mp4',
      mimeType: 'video/mp4',
      fileSize: 1,
      fileUrl: 'http://capability-hub.example/seedance/abc.mp4',
    });
    const errs = await validate(dto);
    expect(errs.some((e) => e.property === 'fileUrl')).toBe(true);
  });

  it('accepts https fileUrl in production', async () => {
    process.env.NODE_ENV = 'production';
    jest.resetModules();
    const Cls = await importFresh();
    const dto = plainToInstance(Cls, {
      fileName: 'video.mp4',
      mimeType: 'video/mp4',
      fileSize: 1,
      fileUrl: 'https://capability-hub.example/seedance/abc.mp4',
    });
    expect(await validate(dto)).toEqual([]);
  });

  it('still accepts http fileUrl outside production (dev/test)', async () => {
    process.env.NODE_ENV = 'test';
    jest.resetModules();
    const Cls = await importFresh();
    const dto = plainToInstance(Cls, {
      fileName: 'video.mp4',
      mimeType: 'video/mp4',
      fileSize: 1,
      fileUrl: 'http://localhost:9002/capability-hub/seedance/abc.mp4',
    });
    expect(await validate(dto)).toEqual([]);
  });
});
