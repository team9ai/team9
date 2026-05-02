/**
 * Structural smoke tests for the im_message_forwards Drizzle schema.
 *
 * Mirrors the pattern established by ahand-devices.schema.spec.ts — no real
 * database connection, just type + column surface guards and FK-config
 * inspection. The four acceptance-criteria scenarios map to:
 *
 *   1. Insert a single forward row (all required fields) — verified via
 *      NewMessageForward type assignment and column presence.
 *   2. Cascade on forwardedMessageId delete — verified via FK config.
 *   3. Set null on sourceMessageId delete — verified via FK config.
 *   4. NOT NULL guard on sourceChannelId — verified via column.notNull.
 */
import { describe, it, expect } from '@jest/globals';
import * as schema from '../index.js';

const FK_INLINE = Symbol.for('drizzle:PgInlineForeignKeys');

type ForeignKeyEntry = {
  onDelete: string;
  reference: () => {
    columns: { name: string }[];
    foreignTable: { [key: symbol]: string };
  };
};

describe('im_message_forwards schema', () => {
  it('exports messageForwards table with all required columns', () => {
    const table = schema.messageForwards;
    expect(table).toBeDefined();

    const expectedCols = [
      'id',
      'forwardedMessageId',
      'position',
      'sourceMessageId',
      'sourceChannelId',
      'sourceWorkspaceId',
      'sourceSenderId',
      'sourceCreatedAt',
      'sourceSeqId',
      'contentSnapshot',
      'contentAstSnapshot',
      'attachmentsSnapshot',
      'sourceType',
      'createdAt',
    ] as const;

    for (const col of expectedCols) {
      expect(table[col as keyof typeof table]).toBeDefined();
    }
  });

  it('insert (1): NewMessageForward accepts all required fields and persists type contract', () => {
    // This verifies the TypeScript type allows a minimal valid insert shape.
    // DB-level persistence is verified by pnpm db:migrate + psql in the task notes.
    const row: schema.NewMessageForward = {
      forwardedMessageId: '00000000-0000-0000-0000-000000000001',
      position: 0,
      sourceChannelId: '00000000-0000-0000-0000-000000000002',
      sourceCreatedAt: new Date('2026-01-01T00:00:00Z'),
      sourceType: 'text',
    };

    expect(row.forwardedMessageId).toBe('00000000-0000-0000-0000-000000000001');
    expect(row.position).toBe(0);
    expect(row.sourceChannelId).toBe('00000000-0000-0000-0000-000000000002');
    expect(row.sourceType).toBe('text');
    // Optional fields default to undefined (DB supplies null or default)
    expect(row.sourceMessageId).toBeUndefined();
    expect(row.sourceWorkspaceId).toBeUndefined();
    expect(row.sourceSenderId).toBeUndefined();
    expect(row.contentSnapshot).toBeUndefined();
    expect(row.id).toBeUndefined(); // DB generates via gen_random_uuid()
  });

  it('cascade (2): forwardedMessageId FK has onDelete=cascade', () => {
    const table = schema.messageForwards;
    const fks: ForeignKeyEntry[] = (
      table as unknown as Record<symbol, ForeignKeyEntry[]>
    )[FK_INLINE];

    expect(fks).toBeDefined();

    const cascadeFk = fks.find((fk) => {
      const ref = fk.reference();
      return ref.columns.some((c) => c.name === 'forwarded_message_id');
    });

    expect(cascadeFk).toBeDefined();
    expect(cascadeFk?.onDelete).toBe('cascade');
  });

  it('set null (3): sourceMessageId FK has onDelete=set null', () => {
    const table = schema.messageForwards;
    const fks: ForeignKeyEntry[] = (
      table as unknown as Record<symbol, ForeignKeyEntry[]>
    )[FK_INLINE];

    const setNullFk = fks.find((fk) => {
      const ref = fk.reference();
      return ref.columns.some((c) => c.name === 'source_message_id');
    });

    expect(setNullFk).toBeDefined();
    expect(setNullFk?.onDelete).toBe('set null');
    // sourceChannelId is a separate column and remains not-null (denormalized)
    expect(schema.messageForwards.sourceChannelId.notNull).toBe(true);
  });

  it('not null guard (4): sourceChannelId is NOT NULL in schema', () => {
    expect(schema.messageForwards.sourceChannelId.notNull).toBe(true);
  });

  it('nullable fields encode correct types', () => {
    // sourceMessageId, sourceWorkspaceId, sourceSenderId, sourceSeqId are nullable
    const row: Partial<schema.MessageForward> = {
      sourceMessageId: null,
      sourceWorkspaceId: null,
      sourceSenderId: null,
      sourceSeqId: null,
      contentSnapshot: null,
      contentAstSnapshot: null,
      attachmentsSnapshot: null,
    };

    expect(row.sourceMessageId).toBeNull();
    expect(row.sourceWorkspaceId).toBeNull();
    expect(row.sourceSenderId).toBeNull();
    expect(row.sourceSeqId).toBeNull();
    expect(row.contentSnapshot).toBeNull();
    expect(row.contentAstSnapshot).toBeNull();
    expect(row.attachmentsSnapshot).toBeNull();
  });

  it('messageTypeEnum includes forward as the last value', () => {
    const values = schema.messageTypeEnum.enumValues;
    expect(values).toContain('forward');
    expect(values[values.length - 1]).toBe('forward');
    // Preserve existing ordinals
    expect(values).toEqual([
      'text',
      'file',
      'image',
      'system',
      'tracking',
      'long_text',
      'forward',
    ]);
  });
});
