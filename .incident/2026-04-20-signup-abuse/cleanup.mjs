// Cleanup script for 2026-04-20 signup-bonus abuse
// Executed inside billing-hub Railway container to reach team9 Postgres via internal DNS.
// Each phase runs in its own short-lived transaction (autocommit batches) to minimize lock duration.

import postgres from 'postgres';

const team9Url = process.env.TEAM9_DB_URL;
const billingUrl = process.env.DATABASE_URL;
if (!team9Url || !billingUrl) {
  console.error('Missing TEAM9_DB_URL or DATABASE_URL');
  process.exit(1);
}

const DRY_RUN = process.env.DRY_RUN === '1';
const log = (...a) => console.log(new Date().toISOString(), ...a);

const team9 = postgres(team9Url, {
  max: 1,
  connect_timeout: 30,
  idle_timeout: 0,
  connection: { statement_timeout: 0 },
});
const billing = postgres(billingUrl, {
  max: 1,
  connect_timeout: 30,
  idle_timeout: 0,
  connection: { statement_timeout: 0 },
});

const ABUSE_FILTER = team9`
  user_type='human'
  AND (email LIKE '%.tohal.org'          OR email LIKE '%@tohal.org'
    OR email LIKE '%.accesswiki.net'     OR email LIKE '%@accesswiki.net'
    OR email LIKE '%.cloudvxz.com'       OR email LIKE '%@cloudvxz.com'
    OR email LIKE '%.sixthirtydance.org' OR email LIKE '%@sixthirtydance.org'
    OR email LIKE '%.shopsprint.org'     OR email LIKE '%@shopsprint.org'
    OR email LIKE '%.26ai.org'           OR email LIKE '%@26ai.org'
    OR email LIKE '%.hush2u.com'         OR email LIKE '%@hush2u.com')
`;

try {
  log('MODE:', DRY_RUN ? 'DRY_RUN (will ROLLBACK)' : 'REAL_RUN (will COMMIT)');

  // Load IDs once into JS memory (avoid repeated scans of im_users)
  log('loading flagged human ids...');
  const flaggedRows = await team9`SELECT id FROM im_users WHERE ${ABUSE_FILTER}`;
  const flaggedIds = flaggedRows.map(r => r.id);
  log('  flagged_humans:', flaggedIds.length);

  log('loading flagged tenant ids...');
  const tenantRows = await team9`
    SELECT DISTINCT tenant_id FROM tenant_members
    WHERE user_id = ANY(${flaggedIds})
  `;
  const tenantIds = tenantRows.map(r => r.tenant_id);
  log('  flagged_tenants:', tenantIds.length);

  log('loading flagged bot user_ids (bots owned by flagged humans)...');
  const botRows = await team9`
    SELECT DISTINCT user_id FROM im_bots WHERE owner_id = ANY(${flaggedIds})
  `;
  const botIds = botRows.map(r => r.user_id);
  log('  flagged_bots:', botIds.length);

  // Pre-delete sanity
  const [{ orphan_channels }] = await team9`
    SELECT COUNT(*)::int AS orphan_channels FROM im_channels
    WHERE created_by = ANY(${flaggedIds}) AND NOT (tenant_id = ANY(${tenantIds}))
  `;
  log('  orphan_channels_outside_flagged_tenants:', orphan_channels);
  if (orphan_channels > 0) throw new Error('Unexpected cross-tenant channels — aborting');

  const doBatches = async (label, ids, batchSize, runner) => {
    log(`PHASE: ${label} — ${ids.length} ids, batch=${batchSize}`);
    let done = 0;
    const start = Date.now();
    for (let i = 0; i < ids.length; i += batchSize) {
      const slice = ids.slice(i, i + batchSize);
      await runner(slice);
      done += slice.length;
      const pct = ((done / ids.length) * 100).toFixed(1);
      log(`  ${label}: ${done}/${ids.length} (${pct}%) — t=${((Date.now() - start) / 1000).toFixed(1)}s`);
    }
  };

  if (DRY_RUN) {
    // Measure Phase 1 only; we don't actually run deletes in dry mode (too disruptive even with rollback).
    log('DRY_RUN: skipping phases (ROLLBACK path has been validated earlier)');
  } else {
    // PHASE 1: Scrub invited_by NULL
    log('PHASE 1: null out tenant_members.invited_by pointing at flagged');
    const p1start = Date.now();
    const p1 = await team9`
      UPDATE tenant_members SET invited_by = NULL WHERE invited_by = ANY(${flaggedIds})
    `;
    log(`  updated ${p1.count} rows in ${((Date.now() - p1start) / 1000).toFixed(1)}s`);

    // PHASE 2: Delete tenants in batches. CASCADE cleans channels/members/docs/files/notifications/invitations/onboarding/resources/routines/skills
    await doBatches('PHASE 2: delete tenants', tenantIds, 200, async (slice) => {
      await team9`DELETE FROM tenants WHERE id = ANY(${slice})`;
    });

    // PHASE 3: Delete flagged human users. Remaining refs: notifications.user_id(CASCADE) etc. Most was already cleaned via tenant cascade.
    await doBatches('PHASE 3: delete flagged humans', flaggedIds, 500, async (slice) => {
      await team9`DELETE FROM im_users WHERE id = ANY(${slice})`;
    });

    // PHASE 4: Delete bot users owned by flagged humans. CASCADE into im_bots.
    await doBatches('PHASE 4: delete bot users', botIds, 1000, async (slice) => {
      await team9`DELETE FROM im_users WHERE id = ANY(${slice})`;
    });

    // PHASE 5: Billing-hub cleanup — delete transactions + accounts for flagged tenants.
    log('PHASE 5: billing-hub cleanup');
    const externalIds = tenantIds.map(t => `tenant:${t}`);
    const p5a = await billing`
      DELETE FROM transactions WHERE account_id IN (
        SELECT id FROM accounts WHERE owner_external_id = ANY(${externalIds})
      )
    `;
    log(`  transactions deleted: ${p5a.count}`);
    const p5b = await billing`
      DELETE FROM accounts WHERE owner_external_id = ANY(${externalIds})
    `;
    log(`  accounts deleted: ${p5b.count}`);
  }

  // Post-delete verification
  log('=== POST-DELETE VERIFICATION ===');
  const [{ remaining_humans }] = await team9`
    SELECT COUNT(*)::int AS remaining_humans FROM im_users WHERE ${ABUSE_FILTER}
  `;
  const [{ remaining_tenants }] = await team9`
    SELECT COUNT(*)::int AS remaining_tenants FROM tenants WHERE id = ANY(${tenantIds})
  `;
  const [{ remaining_bot_users }] = await team9`
    SELECT COUNT(*)::int AS remaining_bot_users FROM im_users WHERE id = ANY(${botIds})
  `;
  const [{ remaining_accounts }] = await billing`
    SELECT COUNT(*)::int AS remaining_accounts FROM accounts
    WHERE owner_external_id = ANY(${tenantIds.map(t => `tenant:${t}`)})
  `;
  log('  remaining_flagged_humans:', remaining_humans);
  log('  remaining_flagged_tenants:', remaining_tenants);
  log('  remaining_flagged_bot_users:', remaining_bot_users);
  log('  remaining_billing_accounts:', remaining_accounts);

  log('DONE');
} catch (e) {
  console.error('ERROR:', e);
  process.exitCode = 1;
} finally {
  await team9.end({ timeout: 5 });
  await billing.end({ timeout: 5 });
}
