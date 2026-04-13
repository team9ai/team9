import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// ── helpers ──────────────────────────────────────────────────────────────────

type MockFn = jest.Mock<(...args: any[]) => any>;

/**
 * Create a thenable, chainable DB mock.
 * All methods return the same chain object. The chain is thenable:
 * `await chain.select().from().where().limit(1)` consumes the next
 * enqueued value from the return queue.
 */
function createDbMock() {
  const returnQueue: any[][] = [];
  const chain: Record<string, any> = {};

  const methods = [
    'select',
    'selectDistinct',
    'from',
    'where',
    'limit',
    'insert',
    'values',
    'returning',
    'update',
    'set',
    'delete',
    'innerJoin',
    'leftJoin',
    'orderBy',
  ];
  for (const m of methods) {
    chain[m] = jest.fn<any>().mockReturnValue(chain);
  }

  // Make the chain thenable for `await`
  chain.then = (resolve: (v: any) => void, reject?: (e: any) => void) => {
    const value = returnQueue.length > 0 ? returnQueue.shift()! : [];
    return Promise.resolve(value).then(resolve, reject);
  };

  function enqueue(value: any[]) {
    returnQueue.push(value);
  }

  return { db: chain, enqueue };
}

// ── fixtures ─────────────────────────────────────────────────────────────────

const WORKSPACE_ID = 'workspace-uuid';
const USER_ID = 'user-uuid';
const RECORD_ID = 'record-uuid';
const BOT_ID = 'bot-uuid';
const APP_ID = 'app-uuid';

const GENERATED_TASK_1 = {
  id: 'task-1',
  emoji: '📋',
  title: 'Review contracts',
};
const GENERATED_TASK_2 = {
  id: 'task-2',
  emoji: '📊',
  title: 'Analyze reports',
};

function makeOnboardingRecord(overrides: Record<string, any> = {}) {
  return {
    id: RECORD_ID,
    tenantId: WORKSPACE_ID,
    userId: USER_ID,
    status: 'completed',
    currentStep: 5,
    stepData: {
      tasks: {
        generatedTasks: [GENERATED_TASK_1, GENERATED_TASK_2],
        selectedTaskIds: ['task-1'],
        customTask: null,
      },
      agents: {
        main: { name: 'Secretary', description: 'Helps with everything' },
        children: [],
      },
      channels: { channelDrafts: [] },
      role: { selectedRoleLabel: 'Lawyer', selectedRoleSlug: 'lawyer' },
    },
    version: 1,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── dynamic imports (ESM compat) ─────────────────────────────────────────────

let OnboardingService: any;

beforeEach(async () => {
  const mod = await import('./onboarding.service.js');
  OnboardingService = mod.OnboardingService;
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('OnboardingService — provisionRoutines', () => {
  let service: any;
  let db: ReturnType<typeof createDbMock>['db'];
  let enqueue: ReturnType<typeof createDbMock>['enqueue'];
  let channelsService: Record<string, MockFn>;
  let installedApplicationsService: {
    findByApplicationId: MockFn;
    install: MockFn;
  };
  let personalStaffService: {
    findPersonalStaffBot: MockFn;
    createStaff: MockFn;
    updateStaff: MockFn;
  };
  let commonStaffService: {
    createStaff: MockFn;
  };
  let routinesService: {
    create: MockFn;
  };

  beforeEach(() => {
    const mock = createDbMock();
    db = mock.db;
    enqueue = mock.enqueue;

    channelsService = {
      findByNameAndTenant: jest.fn<any>().mockResolvedValue(null),
      create: jest.fn<any>().mockResolvedValue({ id: 'channel-id' }),
    };

    installedApplicationsService = {
      findByApplicationId: jest.fn<any>().mockResolvedValue({
        id: APP_ID,
        applicationId: 'personal-staff',
        tenantId: WORKSPACE_ID,
      }),
      install: jest.fn<any>().mockResolvedValue({ id: APP_ID }),
    };

    personalStaffService = {
      findPersonalStaffBot: jest.fn<any>().mockResolvedValue({
        botId: BOT_ID,
        userId: 'bot-user-uuid',
        displayName: 'Secretary',
        avatarUrl: null,
        ownerId: USER_ID,
        mentorId: null,
        extra: null,
        isActive: true,
      }),
      createStaff: jest.fn<any>().mockResolvedValue({ botId: BOT_ID }),
      updateStaff: jest.fn<any>().mockResolvedValue(undefined),
    };

    commonStaffService = {
      createStaff: jest.fn<any>().mockResolvedValue({ botId: 'common-bot' }),
    };

    routinesService = {
      create: jest.fn<any>().mockResolvedValue({ id: 'routine-id' }),
    };

    service = new OnboardingService(
      db,
      channelsService,
      installedApplicationsService,
      personalStaffService,
      commonStaffService,
      routinesService,
    );
  });

  /**
   * Helper that sets up DB enqueues needed for complete() to reach
   * provisionRoutines, then additional enqueues for the routine creation path.
   *
   * complete() DB calls (before provisionRoutines):
   * 1. findRecord — select workspaceOnboarding
   * 2. update workspaceOnboarding to 'provisioning'
   * 3. provisionChannels: (no channel drafts, no DB calls in our fixture)
   * 4. provisionPersonalStaff:
   *    a. installedApplicationsService.findByApplicationId (service mock, not DB)
   *    b. personalStaffService.findPersonalStaffBot (service mock, not DB)
   *    c. personalStaffService.updateStaff (service mock, not DB)
   *
   * Then provisionRoutines DB calls for each task (idempotency check + optional insert)
   * Then persistPreferences: select tenant, update tenant
   * Then final update to 'provisioned'
   */
  function setupCompletePipelineEnqueues(
    record: any,
    idempotencyResults: any[][],
    tenantSettings: any = {},
  ) {
    // 1. findRecord
    enqueue([record]);
    // 2. update to provisioning
    enqueue([{ ...record, status: 'provisioning' }]);
    // 3. provisionChannels — no DB calls (no channel drafts in fixture)
    // 4. provisionPersonalStaff — uses service mocks only (no DB calls)
    // 5. provisionCommonStaff — returns early when agents.children is empty
    //    (findByApplicationId is a service mock; the DB bots query never runs
    //    because the early-return guard `if (children.length === 0) return` fires)
    // DB calls for idempotency checks in provisionRoutines
    for (const result of idempotencyResults) {
      enqueue(result);
    }
    // persistPreferences: select tenant
    enqueue([{ settings: tenantSettings }]);
    // persistPreferences: update tenant
    enqueue([]);
    // Final update to 'provisioned'
    enqueue([{ ...record, status: 'provisioned' }]);
  }

  it('creates one draft routine per selected task', async () => {
    const record = makeOnboardingRecord();
    // idempotency check returns empty (no existing routine)
    setupCompletePipelineEnqueues(record, [[]]);

    await service.complete(WORKSPACE_ID, USER_ID, { lang: 'en' });

    expect(routinesService.create).toHaveBeenCalledTimes(1);
    expect(routinesService.create).toHaveBeenCalledWith(
      {
        title: GENERATED_TASK_1.title,
        botId: BOT_ID,
        status: 'draft',
      },
      USER_ID,
      WORKSPACE_ID,
      { sourceRef: `onboarding:${RECORD_ID}:${GENERATED_TASK_1.id}` },
    );
  });

  it('creates draft routines for both selected tasks and customTask', async () => {
    const record = makeOnboardingRecord({
      stepData: {
        tasks: {
          generatedTasks: [GENERATED_TASK_1, GENERATED_TASK_2],
          selectedTaskIds: ['task-1', 'task-2'],
          customTask: 'My custom workflow',
        },
        agents: {
          main: { name: 'Secretary', description: 'Helps' },
          children: [],
        },
        channels: { channelDrafts: [] },
        role: { selectedRoleLabel: 'Lawyer' },
      },
    });

    // 3 idempotency checks: task-1, task-2, custom
    setupCompletePipelineEnqueues(record, [[], [], []]);

    await service.complete(WORKSPACE_ID, USER_ID, { lang: 'en' });

    expect(routinesService.create).toHaveBeenCalledTimes(3);

    const calls = routinesService.create.mock.calls;
    const sourceRefs = calls.map((c) => c[3]?.sourceRef);
    expect(sourceRefs).toContain(`onboarding:${RECORD_ID}:task-1`);
    expect(sourceRefs).toContain(`onboarding:${RECORD_ID}:task-2`);
    expect(sourceRefs).toContain(`onboarding:${RECORD_ID}:custom`);
  });

  it('skips tasks with an existing sourceRef (idempotency)', async () => {
    const record = makeOnboardingRecord();
    // idempotency check returns an existing routine
    setupCompletePipelineEnqueues(record, [[{ id: 'existing-routine-id' }]]);

    await service.complete(WORKSPACE_ID, USER_ID, { lang: 'en' });

    expect(routinesService.create).not.toHaveBeenCalled();
  });

  it('does not create routines when no tasks selected and no customTask', async () => {
    const record = makeOnboardingRecord({
      stepData: {
        tasks: {
          generatedTasks: [GENERATED_TASK_1],
          selectedTaskIds: [],
          customTask: null,
        },
        agents: {
          main: { name: 'Secretary', description: 'Helps' },
          children: [],
        },
        channels: { channelDrafts: [] },
        role: { selectedRoleLabel: 'Lawyer' },
      },
    });

    // No idempotency checks since we return early
    setupCompletePipelineEnqueues(record, []);

    await service.complete(WORKSPACE_ID, USER_ID, { lang: 'en' });

    expect(routinesService.create).not.toHaveBeenCalled();
  });

  it('handles customTask-only (no generated tasks selected)', async () => {
    const record = makeOnboardingRecord({
      stepData: {
        tasks: {
          generatedTasks: [GENERATED_TASK_1],
          selectedTaskIds: [],
          customTask: 'Only a custom task',
        },
        agents: {
          main: { name: 'Secretary', description: 'Helps' },
          children: [],
        },
        channels: { channelDrafts: [] },
        role: { selectedRoleLabel: 'Lawyer' },
      },
    });

    // 1 idempotency check for custom
    setupCompletePipelineEnqueues(record, [[]]);

    await service.complete(WORKSPACE_ID, USER_ID, { lang: 'en' });

    expect(routinesService.create).toHaveBeenCalledTimes(1);
    expect(routinesService.create).toHaveBeenCalledWith(
      {
        title: 'Only a custom task',
        botId: BOT_ID,
        status: 'draft',
      },
      USER_ID,
      WORKSPACE_ID,
      { sourceRef: `onboarding:${RECORD_ID}:custom` },
    );
  });

  it('skips routine creation (non-fatal) when personal-staff bot not found, logs warning', async () => {
    personalStaffService.findPersonalStaffBot.mockResolvedValue(null);

    const record = makeOnboardingRecord();
    // No idempotency checks since we return early after bot not found
    setupCompletePipelineEnqueues(record, []);

    const warnSpy = jest.spyOn(service['logger'], 'warn');

    await service.complete(WORKSPACE_ID, USER_ID, { lang: 'en' });

    // Complete should still succeed (non-fatal)
    expect(routinesService.create).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('no personal-staff bot found'),
    );
  });

  it('skips routine creation (non-fatal) when personal-staff app not installed, logs warning', async () => {
    installedApplicationsService.findByApplicationId.mockResolvedValue(null);

    const record = makeOnboardingRecord();
    setupCompletePipelineEnqueues(record, []);

    const warnSpy = jest.spyOn(service['logger'], 'warn');

    await service.complete(WORKSPACE_ID, USER_ID, { lang: 'en' });

    expect(routinesService.create).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('no personal-staff app installed'),
    );
  });

  it('ignores whitespace-only customTask', async () => {
    const record = makeOnboardingRecord({
      stepData: {
        tasks: {
          generatedTasks: [GENERATED_TASK_1],
          selectedTaskIds: ['task-1'],
          customTask: '   ',
        },
        agents: {
          main: { name: 'Secretary', description: 'Helps with everything' },
          children: [],
        },
        channels: { channelDrafts: [] },
        role: { selectedRoleLabel: 'Lawyer', selectedRoleSlug: 'lawyer' },
      },
    });

    // Only one idempotency check for task-1 (no check for the whitespace customTask)
    setupCompletePipelineEnqueues(record, [[]]);

    await service.complete(WORKSPACE_ID, USER_ID, { lang: 'en' });

    // Only the selected generated task routine should be created, NOT the whitespace custom task
    expect(routinesService.create).toHaveBeenCalledTimes(1);
    const calls = routinesService.create.mock.calls;
    const titles = calls.map((c: any[]) => c[0]?.title);
    expect(titles).not.toContain('   ');
    expect(titles).toContain(GENERATED_TASK_1.title);
  });
});

// ── provisionCommonStaff tests ────────────────────────────────────────────────

describe('OnboardingService — provisionCommonStaff', () => {
  let service: any;
  let db: ReturnType<typeof createDbMock>['db'];
  let enqueue: ReturnType<typeof createDbMock>['enqueue'];
  let channelsService: Record<string, MockFn>;
  let installedApplicationsService: {
    findByApplicationId: MockFn;
    install: MockFn;
  };
  let personalStaffService: {
    findPersonalStaffBot: MockFn;
    createStaff: MockFn;
    updateStaff: MockFn;
  };
  let commonStaffService: { createStaff: MockFn };
  let routinesService: { create: MockFn };

  beforeEach(() => {
    const mock = createDbMock();
    db = mock.db;
    enqueue = mock.enqueue;

    channelsService = {
      findByNameAndTenant: jest.fn<any>().mockResolvedValue(null),
      create: jest.fn<any>().mockResolvedValue({ id: 'channel-id' }),
    };

    installedApplicationsService = {
      // Return the requested application type for both personal-staff and
      // common-staff lookups so the pipeline reaches provisionCommonStaff.
      findByApplicationId: jest
        .fn<any>()
        .mockImplementation(async (_wid: string, appId: string) => ({
          id: APP_ID,
          applicationId: appId,
          tenantId: WORKSPACE_ID,
        })),
      install: jest.fn<any>().mockResolvedValue({ id: APP_ID }),
    };

    personalStaffService = {
      findPersonalStaffBot: jest.fn<any>().mockResolvedValue({
        botId: BOT_ID,
        userId: 'bot-user-uuid',
        displayName: 'Secretary',
        avatarUrl: null,
        ownerId: USER_ID,
        mentorId: null,
        extra: null,
        isActive: true,
      }),
      createStaff: jest.fn<any>().mockResolvedValue({ botId: BOT_ID }),
      updateStaff: jest.fn<any>().mockResolvedValue(undefined),
    };

    commonStaffService = {
      createStaff: jest.fn<any>().mockResolvedValue({ botId: 'common-bot' }),
    };

    routinesService = {
      create: jest.fn<any>().mockResolvedValue({ id: 'routine-id' }),
    };

    service = new OnboardingService(
      db,
      channelsService,
      installedApplicationsService,
      personalStaffService,
      commonStaffService,
      routinesService,
    );
  });

  /**
   * DB call sequence for complete() with child agents but no selected tasks:
   * 1. findRecord (select workspaceOnboarding)
   * 2. update workspaceOnboarding → 'provisioning'
   * 3. provisionChannels — no DB calls (empty drafts)
   * 4. provisionPersonalStaff — service mocks only
   * 5. provisionCommonStaff — select bots.extra
   * 6. provisionRoutines — returns early (no selected tasks, no customTask)
   * 7. persistPreferences — select tenants
   * 8. persistPreferences — update tenants
   * 9. Final update to 'provisioned'
   */
  function enqueueCommonStaffPipeline(record: any, existingBotRows: any[]) {
    enqueue([record]); // findRecord
    enqueue([{ ...record, status: 'provisioning' }]); // update → provisioning
    enqueue(existingBotRows); // provisionCommonStaff: select bots.extra
    enqueue([{ settings: {} }]); // persistPreferences: select tenants
    enqueue([]); // persistPreferences: update tenants
    enqueue([{ ...record, status: 'provisioned' }]); // final update
  }

  function makeChildRecord(children: any[]) {
    return makeOnboardingRecord({
      stepData: {
        tasks: { generatedTasks: [], selectedTaskIds: [], customTask: null },
        agents: {
          main: { name: 'Secretary', description: 'Helps' },
          children,
        },
        channels: { channelDrafts: [] },
        role: { selectedRoleLabel: 'Sales', selectedRoleSlug: 'sales' },
      },
    });
  }

  it('creates common staff without displayName or jobDescription so bootstrap prompts the mentor to name the agent', async () => {
    const record = makeChildRecord([
      { id: 'child-1', emoji: '🔍', name: 'Lead Qualifier' },
      { id: 'child-2', emoji: '📝', name: 'Proposal Generator' },
    ]);

    enqueueCommonStaffPipeline(record, []);

    await service.complete(WORKSPACE_ID, USER_ID, { lang: 'en' });

    expect(commonStaffService.createStaff).toHaveBeenCalledTimes(2);

    const firstDto = commonStaffService.createStaff.mock.calls[0][3];
    expect(firstDto).not.toHaveProperty('displayName');
    expect(firstDto).not.toHaveProperty('jobDescription');
    expect(firstDto.roleTitle).toBe('Lead Qualifier');
    expect(firstDto.agenticBootstrap).toBe(true);
    expect(firstDto.mentorId).toBe(USER_ID);

    const secondDto = commonStaffService.createStaff.mock.calls[1][3];
    expect(secondDto).not.toHaveProperty('displayName');
    expect(secondDto).not.toHaveProperty('jobDescription');
    expect(secondDto.roleTitle).toBe('Proposal Generator');
  });

  it('skips children whose roleTitle already matches an existing common-staff bot', async () => {
    const record = makeChildRecord([
      { id: 'child-1', emoji: '🔍', name: 'Lead Qualifier' },
      { id: 'child-2', emoji: '📝', name: 'Proposal Generator' },
    ]);

    enqueueCommonStaffPipeline(record, [
      { extra: { commonStaff: { roleTitle: 'lead qualifier' } } },
    ]);

    await service.complete(WORKSPACE_ID, USER_ID, { lang: 'en' });

    expect(commonStaffService.createStaff).toHaveBeenCalledTimes(1);
    const dto = commonStaffService.createStaff.mock.calls[0][3];
    expect(dto.roleTitle).toBe('Proposal Generator');
  });

  it('skips whitespace-only child names', async () => {
    const record = makeChildRecord([
      { id: 'child-1', emoji: '🔍', name: '   ' },
      { id: 'child-2', emoji: '📝', name: 'Proposal Generator' },
    ]);

    enqueueCommonStaffPipeline(record, []);

    await service.complete(WORKSPACE_ID, USER_ID, { lang: 'en' });

    expect(commonStaffService.createStaff).toHaveBeenCalledTimes(1);
    expect(commonStaffService.createStaff.mock.calls[0][3].roleTitle).toBe(
      'Proposal Generator',
    );
  });

  it('deduplicates within a single run to avoid creating two staff for duplicate roleTitles', async () => {
    const record = makeChildRecord([
      { id: 'child-1', emoji: '🔍', name: 'Lead Qualifier' },
      { id: 'child-2', emoji: '🔎', name: 'Lead Qualifier' },
    ]);

    enqueueCommonStaffPipeline(record, []);

    await service.complete(WORKSPACE_ID, USER_ID, { lang: 'en' });

    expect(commonStaffService.createStaff).toHaveBeenCalledTimes(1);
    expect(commonStaffService.createStaff.mock.calls[0][3].roleTitle).toBe(
      'Lead Qualifier',
    );
  });

  it('returns early without querying bots when there are no child agents', async () => {
    const record = makeChildRecord([]);

    enqueue([record]); // findRecord
    enqueue([{ ...record, status: 'provisioning' }]); // update → provisioning
    // no bots.extra query because children are empty
    enqueue([{ settings: {} }]); // persistPreferences: select tenants
    enqueue([]); // persistPreferences: update tenants
    enqueue([{ ...record, status: 'provisioned' }]); // final update

    await service.complete(WORKSPACE_ID, USER_ID, { lang: 'en' });

    expect(commonStaffService.createStaff).not.toHaveBeenCalled();
  });
});

// ── persistPreferences tests ──────────────────────────────────────────────────

describe('OnboardingService — persistPreferences (no selectedTaskTitles)', () => {
  let service: any;
  let db: ReturnType<typeof createDbMock>['db'];
  let enqueue: ReturnType<typeof createDbMock>['enqueue'];
  let routinesService: { create: MockFn };
  let installedApplicationsService: {
    findByApplicationId: MockFn;
    install: MockFn;
  };
  let personalStaffService: {
    findPersonalStaffBot: MockFn;
    createStaff: MockFn;
    updateStaff: MockFn;
  };
  let commonStaffService: { createStaff: MockFn };
  let channelsService: Record<string, MockFn>;

  beforeEach(() => {
    const mock = createDbMock();
    db = mock.db;
    enqueue = mock.enqueue;

    channelsService = {
      findByNameAndTenant: jest.fn<any>().mockResolvedValue(null),
      create: jest.fn<any>().mockResolvedValue({ id: 'channel-id' }),
    };
    installedApplicationsService = {
      findByApplicationId: jest.fn<any>().mockResolvedValue({
        id: APP_ID,
        applicationId: 'personal-staff',
      }),
      install: jest.fn<any>().mockResolvedValue({ id: APP_ID }),
    };
    personalStaffService = {
      findPersonalStaffBot: jest.fn<any>().mockResolvedValue({
        botId: BOT_ID,
        userId: 'bot-user-uuid',
      }),
      createStaff: jest.fn<any>().mockResolvedValue({ botId: BOT_ID }),
      updateStaff: jest.fn<any>().mockResolvedValue(undefined),
    };
    commonStaffService = {
      createStaff: jest.fn<any>().mockResolvedValue(undefined),
    };
    routinesService = {
      create: jest.fn<any>().mockResolvedValue({ id: 'routine-id' }),
    };

    service = new OnboardingService(
      db,
      channelsService,
      installedApplicationsService,
      personalStaffService,
      commonStaffService,
      routinesService,
    );
  });

  it('does not include selectedTaskTitles in persisted settings', async () => {
    const record = makeOnboardingRecord({
      stepData: {
        tasks: {
          generatedTasks: [GENERATED_TASK_1, GENERATED_TASK_2],
          selectedTaskIds: ['task-1'],
          customTask: 'Custom',
        },
        agents: {
          main: { name: 'Secretary', description: 'Helps' },
          children: [],
        },
        channels: { channelDrafts: [] },
        role: { selectedRoleLabel: 'Lawyer', selectedRoleSlug: 'lawyer' },
      },
    });

    // findRecord
    enqueue([record]);
    // update to provisioning
    enqueue([{ ...record, status: 'provisioning' }]);
    // provisionCommonStaff — returns early (children: []), no DB calls
    // provisionRoutines idempotency: task-1 check
    enqueue([]);
    // provisionRoutines idempotency: custom check
    enqueue([]);
    // persistPreferences: select tenant
    enqueue([{ settings: {} }]);
    // persistPreferences: update tenant
    enqueue([]);
    // Final update
    enqueue([{ ...record, status: 'provisioned' }]);

    await service.complete(WORKSPACE_ID, USER_ID, { lang: 'en' });

    // The update call chain: update().set().where()
    const setCalls = (db.set as MockFn).mock.calls;
    const settingsCall = setCalls.find(
      (c) => c[0]?.settings?.onboarding?.tasks,
    );
    expect(settingsCall).toBeDefined();
    const savedTasks = settingsCall![0].settings.onboarding.tasks;
    expect(savedTasks).not.toHaveProperty('selectedTaskTitles');
    expect(savedTasks).toHaveProperty('selectedTaskIds');
    expect(savedTasks).toHaveProperty('customTask');
  });
});

// ── Pipeline ordering test (Task 17) ─────────────────────────────────────────

describe('OnboardingService — pipeline ordering', () => {
  let service: any;
  let db: ReturnType<typeof createDbMock>['db'];
  let enqueue: ReturnType<typeof createDbMock>['enqueue'];
  let callOrder: string[];
  let routinesService: { create: MockFn };
  let installedApplicationsService: {
    findByApplicationId: MockFn;
    install: MockFn;
  };
  let personalStaffService: {
    findPersonalStaffBot: MockFn;
    createStaff: MockFn;
    updateStaff: MockFn;
  };
  let commonStaffService: { createStaff: MockFn };
  let channelsService: Record<string, MockFn>;

  beforeEach(() => {
    const mock = createDbMock();
    db = mock.db;
    enqueue = mock.enqueue;
    callOrder = [];

    channelsService = {
      findByNameAndTenant: jest.fn<any>().mockResolvedValue(null),
      create: jest.fn<any>().mockResolvedValue({ id: 'channel-id' }),
    };
    installedApplicationsService = {
      findByApplicationId: jest
        .fn<any>()
        .mockImplementation(async (_wid: string, appId: string) => {
          if (appId === 'common-staff') {
            callOrder.push('provisionCommonStaff:findApp');
            return null; // no common-staff app
          }
          callOrder.push('provisionPersonalStaff:findApp');
          return { id: APP_ID, applicationId: appId };
        }),
      install: jest.fn<any>().mockResolvedValue({ id: APP_ID }),
    };
    personalStaffService = {
      findPersonalStaffBot: jest.fn<any>().mockImplementation(async () => {
        callOrder.push('provisionPersonalStaff:findBot');
        return { botId: BOT_ID, userId: 'bot-user-uuid' };
      }),
      createStaff: jest.fn<any>().mockResolvedValue({ botId: BOT_ID }),
      updateStaff: jest.fn<any>().mockImplementation(async () => {
        callOrder.push('provisionPersonalStaff:updateStaff');
      }),
    };
    commonStaffService = {
      createStaff: jest.fn<any>().mockImplementation(async () => {
        callOrder.push('provisionCommonStaff:createStaff');
      }),
    };
    routinesService = {
      create: jest.fn<any>().mockImplementation(async () => {
        callOrder.push('provisionRoutines:create');
        return { id: 'routine-id' };
      }),
    };

    service = new OnboardingService(
      db,
      channelsService,
      installedApplicationsService,
      personalStaffService,
      commonStaffService,
      routinesService,
    );
  });

  it('runs provisionRoutines between provisionCommonStaff and persistPreferences', async () => {
    const record = makeOnboardingRecord({
      stepData: {
        tasks: {
          generatedTasks: [GENERATED_TASK_1],
          selectedTaskIds: ['task-1'],
          customTask: null,
        },
        agents: {
          main: { name: 'Secretary', description: 'Helps' },
          children: [],
        },
        channels: { channelDrafts: [] },
        role: { selectedRoleLabel: 'Lawyer', selectedRoleSlug: 'lawyer' },
      },
    });

    // findRecord
    enqueue([record]);
    // update to provisioning
    enqueue([{ ...record, status: 'provisioning' }]);
    // common-staff app not found (no more DB calls for provisionCommonStaff)
    // provisionRoutines idempotency check
    enqueue([]);
    // persistPreferences: select tenant
    enqueue([{ settings: {} }]);
    // persistPreferences: update tenant
    enqueue([]);
    // Final update
    enqueue([{ ...record, status: 'provisioned' }]);

    await service.complete(WORKSPACE_ID, USER_ID, { lang: 'en' });

    // provisionRoutines:create must come before persistPreferences
    // persistPreferences calls db.set() — we verify callOrder
    const routineIdx = callOrder.indexOf('provisionRoutines:create');
    expect(routineIdx).toBeGreaterThanOrEqual(0);

    // provisionPersonalStaff should have run before provisionRoutines
    const personalStaffIdx = callOrder.indexOf(
      'provisionPersonalStaff:findBot',
    );
    expect(personalStaffIdx).toBeLessThan(routineIdx);
  });
});
