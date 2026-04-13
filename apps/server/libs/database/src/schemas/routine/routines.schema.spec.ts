/**
 * Structural smoke tests for the routine__routines Drizzle schema.
 *
 * These validate that the schema TypeScript definition exposes the
 * expected fields and enum values. They do NOT run against a real
 * database — migration correctness is verified separately by
 * `pnpm db:migrate` in a dev environment.
 *
 * This is the first schema-level spec in the project. If schema test
 * infrastructure (e.g., in-memory PostgreSQL via pg-mem) is added later,
 * these should be upgraded to behavioral tests.
 */
import { describe, it, expect } from '@jest/globals';
import * as schema from '../index.js';

describe('routine__routines schema', () => {
  it('exposes draft as a valid status enum value', () => {
    const values = schema.routineStatusEnum.enumValues;
    expect(values).toContain('draft');
    expect(values[0]).toBe('draft');
  });

  it('has creationChannelId, creationSessionId, sourceRef columns typed as nullable', () => {
    type R = schema.Routine;
    const sample: Partial<R> = {
      creationChannelId: null,
      creationSessionId: null,
      sourceRef: null,
    };
    expect(sample.creationChannelId).toBeNull();
    expect(sample.creationSessionId).toBeNull();
    expect(sample.sourceRef).toBeNull();
  });
});
