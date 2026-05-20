/**
 * Structural smoke tests for the task run schema. These are intentionally
 * type-level and do not require a database connection.
 */
import { describe, expect, it } from '@jest/globals';
import * as schema from '../index.js';

describe('task schema', () => {
  it('models task runs as standalone records with optional routine linkage', () => {
    type Run = schema.TaskRun;
    const sample: Partial<Run> = {
      routineId: null,
      routineVersion: null,
      title: 'Independent task run',
      status: 'upcoming',
    };

    expect(schema.taskRunStatusEnum.enumValues).toContain('upcoming');
    expect(sample.routineId).toBeNull();
    expect(sample.routineVersion).toBeNull();
  });

  it('stores deliverables under task runs instead of routine executions', () => {
    type Deliverable = schema.TaskDeliverable;
    const sample: Partial<Deliverable> = {
      runId: 'run-1',
      routineId: null,
      fileName: 'result.pdf',
    };

    expect(sample.runId).toBe('run-1');
    expect(sample.routineId).toBeNull();
  });
});
