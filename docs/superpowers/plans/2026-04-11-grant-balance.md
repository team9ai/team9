# Grant Balance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate `grant_balance` credit pool to billing-hub, consumed before paid `balance` during deductions, and grant 4000 credits to new Team9 users on signup.

**Architecture:** New `grant_balance` bigint column on `accounts` table. Deduction priority: Quota → Grant Balance → Balance → Credit Limit. The `grant()` operation writes to `grant_balance` instead of `balance`. Redis Lua script, DB fallback path, API serializers, and sync all updated to carry the new field.

**Tech Stack:** TypeScript, PostgreSQL/Drizzle ORM, Redis Lua, Hono (billing-hub), NestJS (team9), Vitest

**Spec:** [docs/superpowers/specs/2026-04-11-grant-balance-design.md](/Users/jiangtao/Desktop/shenjingyuan/team9/docs/superpowers/specs/2026-04-11-grant-balance-design.md)

---

## File Map

### Billing Hub (`/Users/jiangtao/Desktop/shenjingyuan/billing-hub`)

| File                                              | Action | Responsibility                                          |
| ------------------------------------------------- | ------ | ------------------------------------------------------- |
| `server/src/db/schema/accounts.ts`                | Modify | Add `grantBalance` column definition                    |
| `server/src/db/migrations/0008_grant_balance.sql` | Create | ALTER TABLE migration                                   |
| `server/src/services/account.service.ts`          | Modify | BalanceState, BalanceInfo, buildBalanceInfo, cache R/W  |
| `server/src/lib/api-serializers.ts`               | Modify | CreditFields, serializers add grantBalance              |
| `server/src/services/redis-ledger.service.ts`     | Modify | Lua script, types, event payload, hydrate, sync         |
| `server/src/services/billing.service.ts`          | Modify | Types, grant(), deduct() CTE, adjust(), snapshots       |
| `server/src/routes/integration.ts`                | Modify | No schema change; response changes come from serializer |
| `server/src/routes/admin.ts`                      | Modify | adjust schema add `target` param                        |
| `server/src/services/stats.service.ts`            | Modify | Add grantBalance to stats                               |
| `server/test/helpers/fixtures.ts`                 | Modify | createTestAccount supports grantBalance                 |
| `server/test/integration/grant-balance.spec.ts`   | Create | New integration test suite (20 scenarios)               |

### Team9 (`/Users/jiangtao/Desktop/shenjingyuan/team9`)

| File                                                              | Action | Responsibility                   |
| ----------------------------------------------------------------- | ------ | -------------------------------- |
| `apps/server/apps/gateway/src/billing-hub/billing-hub.service.ts` | Modify | Add grantCredits(), update types |
| `apps/server/apps/gateway/src/workspace/workspace.service.ts`     | Modify | Call grantCredits on signup      |

---

## Task 1: Database Schema & Migration

**Files:**

- Modify: `server/src/db/schema/accounts.ts:28-31`
- Create: `server/src/db/migrations/0008_grant_balance.sql`

- [ ] **Step 1: Add grantBalance to schema**

In `server/src/db/schema/accounts.ts`, add after line 28 (`balance` field):

```typescript
    // Current grant balance in credits (grant operations)
    grantBalance: bigint('grant_balance', { mode: 'bigint' }).notNull().default(sql`0`),
```

- [ ] **Step 2: Create migration file**

Create `server/src/db/migrations/0008_grant_balance.sql`:

```sql
ALTER TABLE "accounts" ADD COLUMN "grant_balance" bigint DEFAULT 0 NOT NULL;
```

- [ ] **Step 3: Verify migration applies**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/billing-hub && pnpm --filter server exec drizzle-kit push`

Expected: Schema pushed successfully with new column.

- [ ] **Step 4: Commit**

```bash
cd /Users/jiangtao/Desktop/shenjingyuan/billing-hub
git add server/src/db/schema/accounts.ts server/src/db/migrations/0008_grant_balance.sql
git commit -m "feat: add grant_balance column to accounts table"
```

---

## Task 2: Account Service — BalanceInfo & Cache

**Files:**

- Modify: `server/src/services/account.service.ts`

- [ ] **Step 1: Update BalanceState type**

In `account.service.ts`, the `BalanceState` type (around line 8) currently picks `'balance' | 'quota' | 'quotaExpiresAt' | 'creditLimit'`. Add `'grantBalance'`:

```typescript
type BalanceState = Pick<
  AccountRecord,
  "balance" | "grantBalance" | "quota" | "quotaExpiresAt" | "creditLimit"
>;
```

- [ ] **Step 2: Update CachedBalanceState type**

Add `grantBalance` field:

```typescript
type CachedBalanceState = {
  balance: string;
  grantBalance: string;
  quota: string;
  quotaExpiresAt: string | null;
  creditLimit: string;
};
```

- [ ] **Step 3: Update BalanceInfo interface**

Add `grantBalance: bigint`:

```typescript
export interface BalanceInfo {
  balance: bigint;
  grantBalance: bigint;
  quota: bigint;
  quotaExpiresAt: Date | null;
  effectiveQuota: bigint;
  available: bigint;
  creditLimit: bigint;
}
```

- [ ] **Step 4: Update buildBalanceInfo()**

Change the `available` calculation to include `grantBalance` and return it:

```typescript
export function buildBalanceInfo(
  state: BalanceState,
  now = new Date(),
): BalanceInfo {
  const effectiveQuota = computeEffectiveQuota(
    state.quota,
    state.quotaExpiresAt,
    now,
  );
  const available = addLedgerValues(
    addLedgerValues(
      addLedgerValues(effectiveQuota, state.grantBalance),
      state.balance,
    ),
    state.creditLimit,
  );

  return {
    balance: state.balance,
    grantBalance: state.grantBalance,
    quota: state.quota,
    quotaExpiresAt: state.quotaExpiresAt,
    effectiveQuota,
    available,
    creditLimit: state.creditLimit,
  };
}
```

- [ ] **Step 5: Update getBalance() — DB columns and cache parsing**

In the `getBalance()` method, add `grantBalance: true` to the columns selection. In the cache parsing, add `grantBalance` field:

```typescript
// In cache parsing (where CachedBalanceState is read):
grantBalance: parseCachedBigInt(cached.grantBalance, 'grantBalance'),

// In DB fallback columns:
grantBalance: accounts.grantBalance,
```

- [ ] **Step 6: Update updateBalanceCache()**

Add `grantBalance` to the cached state:

```typescript
grantBalance: state.grantBalance.toString(),
```

- [ ] **Step 7: Update updateAccount()**

If `grantBalance` appears in the account record, no logic change needed — the function already returns the updated account which will include grantBalance from the DB row.

- [ ] **Step 8: Run existing tests to verify no regression**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/billing-hub && pnpm --filter server test -- --run test/integration/account-read.spec.ts`

Expected: All existing tests still pass (grantBalance defaults to 0).

- [ ] **Step 9: Commit**

```bash
git add server/src/services/account.service.ts
git commit -m "feat: add grantBalance to BalanceInfo and account cache"
```

---

## Task 3: API Serializers

**Files:**

- Modify: `server/src/lib/api-serializers.ts`

- [ ] **Step 1: Update CreditFields type**

Add `grantBalance: bigint`:

```typescript
type CreditFields = {
  balance: bigint;
  grantBalance: bigint;
  quota: bigint;
  effectiveQuota: bigint;
  available: bigint;
  creditLimit: bigint;
};
```

- [ ] **Step 2: Update serializeAccount()**

Add `grantBalance` to the serialized output:

```typescript
grantBalance: ledgerToCredits(account.grantBalance),
```

- [ ] **Step 3: Update serializeBillingMutationResult()**

Add `grantBalanceAfter` to the mutation result serializer. The input type needs `grantBalanceAfter: bigint`:

```typescript
grantBalanceAfter: ledgerToCredits(result.grantBalanceAfter),
```

- [ ] **Step 4: Update serializeTransactionDetail()**

If it serializes account balance info, add `grantBalance`.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/api-serializers.ts
git commit -m "feat: add grantBalance to API serializers"
```

---

## Task 4: Redis Lua Script — grantBalance Support

**Files:**

- Modify: `server/src/services/redis-ledger.service.ts`

This is the highest-risk change. The Lua script needs grantBalance in: account init, balance calculation, deduct logic, grant logic, adjust logic, state updates, and event payload.

- [ ] **Step 1: Update types — RedisMutationRawResult, RedisMutationResult, RedisMutationRequest**

In `RedisMutationRawResult` (line 60), add:

```typescript
type RedisMutationRawResult = {
  transactionId: string;
  credits: string;
  balanceAfter: string;
  grantBalanceAfter: string; // NEW
  availableAfter: string;
  quotaAfter: string;
  effectiveQuotaAfter: string;
  quotaExpiresAtMs: string | null;
};
```

In `RedisMutationResult` (line 70), add:

```typescript
type RedisMutationResult = {
  transactionId: string;
  credits: bigint;
  balanceAfter: bigint;
  grantBalanceAfter: bigint; // NEW
  availableAfter: bigint;
  quotaAfter: bigint;
  effectiveQuotaAfter: bigint;
  quotaExpiresAt: Date | null;
  idempotent: boolean;
};
```

In `RedisMutationRequest` (line 140), add `target` field:

```typescript
type RedisMutationRequest = {
  op: "recharge" | "grant" | "refund" | "consume" | "admin_adjust";
  allowCreate: boolean;
  ownerExternalId: string;
  ownerType: "personal" | "organization";
  ownerName: string | null;
  accountId: string;
  amount: string;
  defaultCreditLimit: string;
  transactionId: string;
  operatorExternalId?: string;
  agentId?: string;
  referenceType?: string;
  referenceId?: string;
  description?: string;
  baseMetadata?: Record<string, unknown>;
  transactionType: string;
  target?: "balance" | "grant_balance"; // NEW — for admin_adjust
};
```

- [ ] **Step 2: Update LedgerEventPayload type**

Add grantBalance fields (line 159):

```typescript
type LedgerEventPayload = {
  // ... existing fields ...
  grantBalanceBefore: string; // NEW
  grantBalanceAfter: string; // NEW
  grantUsed: string | null; // NEW — only for consume
  // ... rest unchanged ...
};
```

- [ ] **Step 3: Update Lua script — account initialization (line 516-528)**

When creating a new account, add `grantBalance = '0'`:

```lua
  state.grantBalance = '0'
```

Add after `state.balance = '0'` (line 520).

- [ ] **Step 4: Update Lua script — parse grantBalance (after line 548)**

Add parsing for grantBalance after the creditLimit parsing:

```lua
local grantBalance, grantBalanceError = parse_int64_integer(state.grantBalance or '0', 'grantBalance')
if grantBalanceError then
  return { 'error', grantBalanceError }
end
```

- [ ] **Step 5: Update Lua script — availableBefore calculation (line 560)**

Change from:

```lua
local availableBefore = add_integer_strings(add_integer_strings(balance, effectiveQuotaBefore), creditLimit)
```

To:

```lua
local availableBefore = add_integer_strings(add_integer_strings(add_integer_strings(effectiveQuotaBefore, grantBalance), balance), creditLimit)
```

- [ ] **Step 6: Update Lua script — add grantBalanceAfter and grantUsed variables (after line 571)**

```lua
local grantBalanceAfter = grantBalance
local grantUsed = nil
```

- [ ] **Step 7: Update Lua script — consume/deduct logic (line 573-618)**

Replace the consume block (lines 593-599) with the new three-pool logic:

```lua
if request.op == 'consume' then
  if state.status == 'frozen' then
    return { 'error', cjson.encode({ code = 'ACCOUNT_FROZEN', message = 'Account is frozen' }) }
  end

  if compare_integer_strings(availableBefore, signedAmount) < 0 then
    return {
      'error',
      cjson.encode({
        code = 'INSUFFICIENT_BALANCE',
        message = 'Insufficient balance',
        balance = tostring(balance),
        grantBalance = tostring(grantBalance),
        quota = tostring(quota),
        effectiveQuota = tostring(effectiveQuotaBefore),
        creditLimit = tostring(creditLimit),
        available = tostring(availableBefore),
        required = tostring(signedAmount),
      }),
    }
  end

  quotaUsed = min_integer_string(effectiveQuotaBefore, signedAmount)
  local remaining = subtract_integer_strings(signedAmount, quotaUsed)
  grantUsed = min_integer_string(grantBalance, remaining)
  balanceUsed = subtract_integer_strings(remaining, grantUsed)
  if compare_integer_strings(effectiveQuotaBefore, '0') > 0 then
    quotaAfter = max_integer_string(subtract_integer_strings(quota, quotaUsed), '0')
  end
  grantBalanceAfter = subtract_integer_strings(grantBalance, grantUsed)
  balanceAfter = subtract_integer_strings(balance, balanceUsed)
```

- [ ] **Step 8: Update Lua script — grant logic (line 615-617)**

The current `else` block at line 615-617 applies to grant, refund, and positive admin_adjust — all add to `balance`. We need grant to add to `grantBalance` instead. Replace:

```lua
elseif request.op == 'admin_adjust' then
  balanceAfter = add_integer_strings(balance, signedAmount)
  transactionAmount = signedAmount
else
  balanceAfter = add_integer_strings(balance, signedAmount)
  transactionAmount = signedAmount
end
```

With:

```lua
elseif request.op == 'admin_adjust' and request.target == 'grant_balance' then
  if compare_integer_strings(signedAmount, '0') < 0 then
    local deduction = absolute_value_string(signedAmount)
    if compare_integer_strings(grantBalance, deduction) < 0 then
      return { 'error', cjson.encode({ code = 'INSUFFICIENT_GRANT_BALANCE', message = 'Insufficient grant balance for negative adjustment' }) }
    end
  end
  grantBalanceAfter = add_integer_strings(grantBalance, signedAmount)
  transactionAmount = signedAmount
elseif request.op == 'admin_adjust' then
  balanceAfter = add_integer_strings(balance, signedAmount)
  transactionAmount = signedAmount
elseif request.op == 'grant' then
  grantBalanceAfter = add_integer_strings(grantBalance, signedAmount)
  transactionAmount = signedAmount
else
  -- recharge, refund: add to balance
  balanceAfter = add_integer_strings(balance, signedAmount)
  transactionAmount = signedAmount
end
```

- [ ] **Step 9: Update Lua script — int64 range check (line 620)**

Add grantBalanceAfter to the range check:

```lua
if not is_int64_integer_string(balanceAfter) or not is_int64_integer_string(quotaAfter) or not is_int64_integer_string(grantBalanceAfter) then
```

- [ ] **Step 10: Update Lua script — increments and HSET (line 624-679)**

Add grantBalance increment calculation after line 625:

```lua
local grantBalanceIncrement = subtract_integer_strings(grantBalanceAfter, grantBalance)
```

In the HSET for new accounts (line 636-652), add `'grantBalance', '0'` field.

In the HSET for existing accounts (line 654-667), add `'grantBalance'` is NOT set via HSET (it uses HINCRBY). So no change to HSET.

Add after the quota HINCRBY block (line 674-676):

```lua
if grantBalanceIncrement ~= '0' then
  redis.call('HINCRBY', accountKey, 'grantBalance', grantBalanceIncrement)
end
```

Read back the grantBalance after line 679:

```lua
state.grantBalance = redis.call('HGET', accountKey, 'grantBalance')
```

- [ ] **Step 11: Update Lua script — availableAfter calculation (line 627-631)**

Change from:

```lua
local availableAfter = add_integer_strings(add_integer_strings(balanceAfter, effectiveQuotaAfter), creditLimit)
```

To:

```lua
local availableAfter = add_integer_strings(add_integer_strings(add_integer_strings(effectiveQuotaAfter, grantBalanceAfter), balanceAfter), creditLimit)
```

- [ ] **Step 12: Update Lua script — event payload (line 681-707)**

Add grantBalance fields to the eventPayload:

```lua
  grantBalanceBefore = grantBalance,
  grantBalanceAfter = grantBalanceAfter,
  grantUsed = grantUsed and grantUsed or cjson.null,
```

Add these after `balanceAfter` (line 690).

- [ ] **Step 13: Update Lua script — result object (line 714-722)**

Add `grantBalanceAfter` to the result:

```lua
local result = {
  transactionId = request.transactionId,
  credits = transactionAmount,
  balanceAfter = balanceAfter,
  grantBalanceAfter = grantBalanceAfter,
  availableAfter = availableAfter,
  quotaAfter = quotaAfter,
  effectiveQuotaAfter = effectiveQuotaAfter,
  quotaExpiresAtMs = quotaExpiresAtMs and tostring(quotaExpiresAtMs) or cjson.null
}
```

- [ ] **Step 14: Update toRedisMutationResult() helper**

Add `grantBalanceAfter` parsing:

```typescript
grantBalanceAfter: parseBigInt(raw.grantBalanceAfter, 'grantBalanceAfter'),
```

- [ ] **Step 15: Update toRawIdempotentResult() helper**

If this function reconstructs raw results, add grantBalanceAfter field.

- [ ] **Step 16: Update IdempotentSeedResult type**

Add `grantBalanceAfter` to the picked fields.

- [ ] **Step 17: Update tryBuildIdempotentResultFromTransaction()**

Add `grantBalanceAfter` reconstruction from transaction metadata:

```typescript
grantBalanceAfter: toLedgerValue(exactSnapshot?.grantBalanceAfter, snapshot.grantBalanceAfter, 'grantBalanceAfter'),
```

- [ ] **Step 18: Update snapshotMetadata()**

Update `buildBalanceInfo` calls to include `grantBalance` in the state:

```typescript
const beforeInfo = buildBalanceInfo({
  balance: parseBigInt(payload.balanceBefore, "balanceBefore"),
  grantBalance: parseBigInt(payload.grantBalanceBefore, "grantBalanceBefore"),
  quota: parseBigInt(payload.quotaBefore, "quotaBefore"),
  quotaExpiresAt,
  creditLimit: parseBigInt(payload.creditLimit, "creditLimit"),
});
const afterInfo = buildBalanceInfo({
  balance: parseBigInt(payload.balanceAfter, "balanceAfter"),
  grantBalance: parseBigInt(payload.grantBalanceAfter, "grantBalanceAfter"),
  quota: quotaAfter,
  quotaExpiresAt,
  creditLimit: parseBigInt(payload.creditLimit, "creditLimit"),
});
```

Add to `_billing` object:

```typescript
grantBalanceBefore: ledgerToCredits(parseBigInt(payload.grantBalanceBefore, 'grantBalanceBefore')),
grantBalanceAfter: ledgerToCredits(parseBigInt(payload.grantBalanceAfter, 'grantBalanceAfter')),
...(payload.grantUsed ? { grantUsed: ledgerToCredits(parseBigInt(payload.grantUsed, 'grantUsed')) } : {}),
```

Add grantBalanceAfter to `_billingExact` if needed:

```typescript
grantBalanceAfter: afterInfo.grantBalance.toString(),
```

- [ ] **Step 19: Update readAccountById() (line 2627-2644)**

Add `grantBalance` to the returned object:

```typescript
grantBalance: parseBigInt(state.grantBalance ?? '0', 'grantBalance'),
```

- [ ] **Step 20: Update hydrateAccount() (line 2647-2672)**

Add `grantBalance` to the HSET:

```typescript
grantBalance: account.grantBalance.toString(),
```

- [ ] **Step 21: Update lockAccountForSync() (line 2529-2554)**

Add `grantBalance` to the INSERT values:

```typescript
grantBalance: parseBigInt(payload.grantBalanceBefore, 'grantBalanceBefore'),
```

- [ ] **Step 22: Update updateLockedAccountFromPayload() (line 2572-2586)**

Add `grantBalance` to the SET:

```typescript
grantBalance: parseBigInt(payload.grantBalanceAfter, 'grantBalanceAfter'),
```

- [ ] **Step 23: Update adjust() method (line 1809-1832)**

Add `target` parameter:

```typescript
async adjust(args: {
  ownerExternalId: string;
  amount: bigint;
  target?: 'balance' | 'grant_balance';
  operatorExternalId?: string;
  referenceType?: string;
  referenceId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}) {
  return this.runMutation({
    op: 'admin_adjust',
    allowCreate: false,
    transactionType: 'admin_adjust',
    ownerExternalId: args.ownerExternalId,
    ownerType: 'personal',
    ownerName: null,
    amount: args.amount,
    target: args.target,
    operatorExternalId: args.operatorExternalId,
    referenceType: args.referenceType,
    referenceId: args.referenceId,
    description: args.description,
    baseMetadata: args.metadata,
  });
}
```

- [ ] **Step 24: Update RedisLedgerAccount type**

Add `grantBalance` to the Pick:

```typescript
type RedisLedgerAccount = Pick<
  AccountRecord,
  | "id"
  | "ownerExternalId"
  | "ownerType"
  | "ownerName"
  | "balance"
  | "grantBalance"
  | "quota"
  | "quotaExpiresAt"
  | "creditLimit"
  | "status"
  | "metadata"
  | "createdAt"
  | "updatedAt"
>;
```

- [ ] **Step 25: Run existing tests**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/billing-hub && pnpm --filter server test`

Expected: All existing tests pass (grantBalance defaults to 0, existing operations still work).

- [ ] **Step 26: Commit**

```bash
git add server/src/services/redis-ledger.service.ts
git commit -m "feat: add grantBalance to Redis Lua script, types, event payload, and sync"
```

---

## Task 5: Billing Service — Types, grant(), deduct(), adjust(), snapshots

**Files:**

- Modify: `server/src/services/billing.service.ts`

- [ ] **Step 1: Update AccountState type (line 17-22)**

Add `grantBalance`:

```typescript
type AccountState = {
  balance: bigint;
  grantBalance: bigint;
  quota: bigint;
  quotaExpiresAt: Date | null;
  creditLimit: bigint;
};
```

- [ ] **Step 2: Update BillingMetadataSnapshot type (line 24-36)**

Add:

```typescript
  grantBalanceBefore: number;
  grantBalanceAfter: number;
  grantUsed?: number;
```

- [ ] **Step 3: Update BillingExactSnapshot type (line 38-42)**

Add:

```typescript
grantBalanceAfter: string;
```

- [ ] **Step 4: Update DeductQueryRow type (line 49-59)**

Add:

```typescript
grantBalanceBefore: bigint;
grantBalanceAfter: bigint;
grantUsed: bigint;
```

- [ ] **Step 5: Update LockedAccountRow type**

Add:

```typescript
grantBalance: bigint;
```

- [ ] **Step 6: Update BillingMutationResult type**

Add `grantBalanceAfter: bigint` to the result type.

- [ ] **Step 7: Update buildSnapshot() helper**

Add grantBalance fields to the snapshot builder. The input object needs `grantBalanceBefore` and `grantBalanceAfter`. Add to the `_billing` display object:

```typescript
grantBalanceBefore: ledgerToCredits(args.grantBalanceBefore),
grantBalanceAfter: ledgerToCredits(args.grantBalanceAfter),
...(args.grantUsed !== undefined ? { grantUsed: ledgerToCredits(args.grantUsed) } : {}),
```

Update buildBalanceInfo calls to include `grantBalance`.

Add `grantBalanceAfter` to exact snapshot.

- [ ] **Step 8: Update grant() method (around line 1201-1306)**

Change the UPDATE from `balance += amount` to `grant_balance += amount`:

```typescript
const [updated] = await tx
  .update(accounts)
  .set({
    grantBalance: sql`${accounts.grantBalance} + ${amount}`,
    updatedAt: new Date(),
  })
  .where(eq(accounts.id, account.id))
  .returning({
    balance: accounts.balance,
    grantBalance: accounts.grantBalance,
    grantBalanceBefore: sql<bigint>`${accounts.grantBalance} - ${amount}`,
    quota: accounts.quota,
    quotaExpiresAt: accounts.quotaExpiresAt,
    creditLimit: accounts.creditLimit,
  });
```

Update the snapshot call to pass `grantBalanceBefore` and `grantBalanceAfter`:

```typescript
const snapshot = this.buildSnapshot({
  balanceBefore: updated.balance,
  balanceAfter: updated.balance,
  grantBalanceBefore: updated.grantBalanceBefore,
  grantBalanceAfter: updated.grantBalance,
  quotaBefore: updated.quota,
  quotaAfter: updated.quota,
  quotaExpiresAt: updated.quotaExpiresAt,
  creditLimit: updated.creditLimit,
});
```

Update the transaction insert — `balanceBefore` and `balanceAfter` stay the same (since grant doesn't touch balance anymore):

```typescript
balanceBefore: updated.balance,
balanceAfter: updated.balance,
```

Update the result to include `grantBalanceAfter`:

```typescript
grantBalanceAfter: updated.grantBalance,
```

- [ ] **Step 9: Update deduct() SQL CTE (around line 672-741)**

Replace the CTE to add the grantBalance layer. The locked CTE adds `grantBalance`:

```sql
SELECT
  id,
  balance AS "balanceBefore",
  grant_balance AS "grantBalanceBefore",
  quota AS "quotaBefore",
  quota_expires_at AS "quotaExpiresAt",
  credit_limit AS "creditLimit",
  CASE
    WHEN quota_expires_at IS NOT NULL AND quota_expires_at > NOW()
      THEN quota
    ELSE 0
  END::bigint AS "effectiveQuota"
FROM accounts
WHERE id = ${account.id}
FOR UPDATE
```

The staged CTE:

```sql
SELECT
  *,
  LEAST("effectiveQuota", ${amount})::bigint AS "quotaUsed"
FROM locked
```

Add an intermediate CTE for grantUsed:

```sql
, grant_staged AS (
  SELECT
    *,
    LEAST("grantBalanceBefore", (${amount} - "quotaUsed"))::bigint AS "grantUsed"
  FROM staged
)
```

The eligible CTE:

```sql
, eligible AS (
  SELECT
    *,
    (${amount} - "quotaUsed" - "grantUsed")::bigint AS "balanceUsed",
    CASE
      WHEN "effectiveQuota" > 0 THEN GREATEST("quotaBefore" - "quotaUsed", 0)
      ELSE "quotaBefore"
    END::bigint AS "quotaAfter",
    ("grantBalanceBefore" - "grantUsed")::bigint AS "grantBalanceAfter",
    ("balanceBefore" - (${amount} - "quotaUsed" - "grantUsed"))::bigint AS "balanceAfter"
  FROM grant_staged
  WHERE "effectiveQuota" + "grantBalanceBefore" + "balanceBefore" + "creditLimit" >= ${amount}
)
```

The UPDATE:

```sql
UPDATE accounts AS a
SET
  quota = e."quotaAfter",
  grant_balance = e."grantBalanceAfter",
  balance = e."balanceAfter",
  updated_at = NOW()
FROM eligible e
WHERE a.id = e.id
RETURNING
  e."balanceBefore",
  e."grantBalanceBefore",
  e."quotaBefore",
  e."quotaExpiresAt",
  e."creditLimit",
  e."effectiveQuota",
  e."quotaUsed",
  e."grantUsed",
  e."balanceUsed",
  e."balanceAfter",
  e."grantBalanceAfter",
  e."quotaAfter"
```

- [ ] **Step 10: Update deduct() snapshot and result building**

Pass `grantBalanceBefore`, `grantBalanceAfter`, `grantUsed` to buildSnapshot.

Add `grantBalanceAfter` to the result object.

- [ ] **Step 11: Update adjust() method**

Add `target` parameter. For `target === 'grant_balance'`:

- Change the UPDATE to modify `grantBalance` instead of `balance`
- Add validation that negative adjustments don't exceed grantBalance
- Return grantBalanceAfter in result

For default `target === 'balance'`: existing logic unchanged, just carry grantBalance in snapshot.

- [ ] **Step 12: Update recharge() RETURNING clause and snapshot**

Add `grantBalance: accounts.grantBalance` to RETURNING. Pass to snapshot as grantBalanceBefore = grantBalanceAfter = grantBalance (unchanged).

- [ ] **Step 13: Update refund() RETURNING clause and snapshot**

Same pattern as recharge — grantBalance unchanged, but include in snapshot.

- [ ] **Step 14: Update reverseRechargeUpToZero() and reverseQuotaUpToZero()**

Add `grantBalance` to SELECT in locked CTE. Include in snapshot as unchanged.

- [ ] **Step 15: Update applySubscriptionQuota()**

Add `grantBalance` to locked SELECT. Include in snapshot as unchanged.

- [ ] **Step 16: Update updateCache() calls throughout**

All `updateCache()` calls must pass `grantBalance` in the state object.

- [ ] **Step 17: Run all tests**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/billing-hub && pnpm --filter server test`

Expected: All existing tests pass.

- [ ] **Step 18: Commit**

```bash
git add server/src/services/billing.service.ts
git commit -m "feat: add grantBalance to billing service — grant(), deduct(), adjust(), snapshots"
```

---

## Task 6: Admin Route — adjust target parameter

**Files:**

- Modify: `server/src/routes/admin.ts`

- [ ] **Step 1: Update adjustSchema**

Add `target` to the zod schema (around line 43-51):

```typescript
const adjustSchema = z.object({
  ownerExternalId: z.string().min(1),
  amount: z.number(),
  target: z.enum(["balance", "grant_balance"]).optional().default("balance"),
  operatorExternalId: z.string().optional(),
  referenceType: z.string().optional(),
  referenceId: z.string().optional(),
  description: z.string().optional(),
  metadata: metadataSchema.optional(),
});
```

- [ ] **Step 2: Pass target to billing service**

In the POST `/admin/adjust` handler (around line 408-423), pass `target`:

```typescript
const result = await getBilling().adjust({
  ...body.data,
  target: body.data.target,
});
```

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/admin.ts
git commit -m "feat: add target param to admin adjust endpoint"
```

---

## Task 7: Stats Service

**Files:**

- Modify: `server/src/services/stats.service.ts`

- [ ] **Step 1: Add totalGrantBalance to stats**

In the balance stats query, add `sum(accounts.grantBalance)` and include in the returned object.

- [ ] **Step 2: Commit**

```bash
git add server/src/services/stats.service.ts
git commit -m "feat: add totalGrantBalance to dashboard stats"
```

---

## Task 8: Test Helpers

**Files:**

- Modify: `server/test/helpers/fixtures.ts`

- [ ] **Step 1: Update createTestAccount**

Add `grantBalance` to the overrides type and insert:

```typescript
export async function createTestAccount(overrides?: {
  balance?: number;
  grantBalance?: number;
  quota?: number;
  quotaExpiresAt?: Date;
  creditLimit?: number;
  status?: "active" | "frozen";
  ownerExternalId?: string;
  ownerType?: "personal" | "organization";
  ownerName?: string;
}) {
  // ... existing code ...
  const [account] = await db
    .insert(accounts)
    .values({
      ownerExternalId: overrides?.ownerExternalId ?? `test-owner-${uuidv7()}`,
      ownerType: overrides?.ownerType ?? "personal",
      ownerName: overrides?.ownerName ?? null,
      balance: creditsToLedger(overrides?.balance ?? 1000),
      grantBalance: creditsToLedger(overrides?.grantBalance ?? 0),
      quota: creditsToLedger(overrides?.quota ?? 0),
      // ... rest unchanged ...
    })
    .returning();
  return account;
}
```

- [ ] **Step 2: Commit**

```bash
git add server/test/helpers/fixtures.ts
git commit -m "test: add grantBalance support to createTestAccount fixture"
```

---

## Task 9: Update Existing Tests — Regression Assertions

**Files:**

- Modify: `server/test/integration/grant.spec.ts`
- Modify: `server/test/integration/deduct.spec.ts`
- Modify: `server/test/integration/refund.spec.ts`
- Modify: `server/test/integration/recharge.spec.ts`
- Modify: `server/test/integration/admin-adjust.spec.ts`
- Modify: `server/test/integration/usage.spec.ts`
- Modify: `server/test/integration/billing-reversal.spec.ts`
- Modify: `server/test/integration/account-read.spec.ts`

- [ ] **Step 1: Update grant.spec.ts**

Change assertions: grant should now increase `grantBalance` (not `balance`). Verify `balance` is unchanged. Verify response includes `grantBalanceAfter`.

- [ ] **Step 2: Update deduct.spec.ts**

Add assertion that response includes `grantBalanceAfter` and `grantUsed` (should be 0 for accounts with grantBalance=0). Verify existing behavior unchanged when grantBalance=0.

- [ ] **Step 3: Update refund.spec.ts**

Add assertion that `grantBalance` is unchanged after refund.

- [ ] **Step 4: Update recharge.spec.ts**

Add assertion that `grantBalance` is unchanged after recharge.

- [ ] **Step 5: Update admin-adjust.spec.ts**

Add test cases for `target: 'grant_balance'`:

- Positive adjustment increases grantBalance
- Negative adjustment decreases grantBalance
- Negative adjustment exceeding grantBalance returns 400
- Default target=balance behavior unchanged

- [ ] **Step 6: Update usage.spec.ts**

Verify response includes `grantUsed` field.

- [ ] **Step 7: Update billing-reversal.spec.ts**

Assert grantBalance unchanged after reversals.

- [ ] **Step 8: Update account-read.spec.ts**

Verify GET /account response includes `grantBalance` field.

- [ ] **Step 9: Run all tests**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/billing-hub && pnpm --filter server test`

Expected: All tests pass.

- [ ] **Step 10: Commit**

```bash
git add server/test/integration/
git commit -m "test: update existing tests with grantBalance regression assertions"
```

---

## Task 10: New Integration Tests — grant-balance.spec.ts

**Files:**

- Create: `server/test/integration/grant-balance.spec.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect } from "vitest";
import { createTestAccount } from "../helpers/fixtures.js";
import { accounts, transactions } from "../../src/db/schema/index.js";
import { eq } from "drizzle-orm";
import {
  ledgerToCredits,
  creditsToLedger,
} from "../../src/lib/credit-units.js";

const BASE_URL = "http://localhost:4001";
const HEADERS = {
  "Content-Type": "application/json",
  "X-Service-Key": "test-hub-key",
};

async function grant(body: Record<string, unknown>) {
  return fetch(`${BASE_URL}/api/billing/grant`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
}

async function deduct(body: Record<string, unknown>) {
  return fetch(`${BASE_URL}/api/billing/deduct`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
}

async function getAccount(ownerExternalId: string) {
  return fetch(
    `${BASE_URL}/api/billing/account?ownerExternalId=${encodeURIComponent(ownerExternalId)}`,
    {
      headers: HEADERS,
    },
  );
}

async function recharge(body: Record<string, unknown>) {
  return fetch(`${BASE_URL}/api/billing/recharge`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
}

async function refund(body: Record<string, unknown>) {
  return fetch(`${BASE_URL}/api/billing/refund`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
}

async function adjust(body: Record<string, unknown>) {
  return fetch(`${BASE_URL}/api/billing/admin/adjust`, {
    method: "POST",
    headers: { ...HEADERS, "X-Admin-Key": "test-admin-key" },
    body: JSON.stringify(body),
  });
}

function getDb() {
  // Import from test setup
  const { getDb } = require("../helpers/setup.js");
  return getDb();
}

describe("Grant Balance", () => {
  // Scenario 1: grant writes grant_balance
  it("grant adds to grantBalance, not balance", async () => {
    const account = await createTestAccount({ balance: 500, grantBalance: 0 });
    const res = await grant({
      ownerExternalId: account.ownerExternalId,
      amount: 200,
      referenceType: "test",
      referenceId: `grant-1-${account.id}`,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.grantBalanceAfter).toBe(200);

    const acctRes = await getAccount(account.ownerExternalId);
    const acctBody = await acctRes.json();
    expect(acctBody.data.account.grantBalance).toBe(200);
    expect(acctBody.data.account.balance).toBe(500); // unchanged
  });

  // Scenario 2: deduct prioritizes grant_balance
  it("deduct takes from grantBalance before balance", async () => {
    const account = await createTestAccount({
      balance: 500,
      grantBalance: 300,
    });
    const res = await deduct({
      ownerExternalId: account.ownerExternalId,
      amount: 200,
      referenceType: "test",
      referenceId: `deduct-priority-${account.id}`,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.grantUsed).toBe(200);
    expect(body.data.grantBalanceAfter).toBe(100);
    expect(body.data.balanceAfter).toBe(500); // unchanged
  });

  // Scenario 3: deduct cross-pool
  it("deduct crosses from grantBalance to balance when insufficient", async () => {
    const account = await createTestAccount({
      balance: 500,
      grantBalance: 100,
    });
    const res = await deduct({
      ownerExternalId: account.ownerExternalId,
      amount: 250,
      referenceType: "test",
      referenceId: `deduct-cross-${account.id}`,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.grantUsed).toBe(100);
    expect(body.data.grantBalanceAfter).toBe(0);
    expect(body.data.balanceAfter).toBe(350); // 500 - 150
  });

  // Scenario 4: three pools
  it("deduct uses quota, then grantBalance, then balance", async () => {
    const account = await createTestAccount({
      balance: 500,
      grantBalance: 200,
      quota: 300,
      quotaExpiresAt: new Date(Date.now() + 86400000),
    });
    const res = await deduct({
      ownerExternalId: account.ownerExternalId,
      amount: 600,
      referenceType: "test",
      referenceId: `deduct-three-${account.id}`,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // 600 = 300 quota + 200 grant + 100 balance
    expect(body.data.grantUsed).toBe(200);
    expect(body.data.grantBalanceAfter).toBe(0);
    expect(body.data.balanceAfter).toBe(400); // 500 - 100
  });

  // Scenario 5: grantBalance=0 regression
  it("deduct works normally when grantBalance is 0", async () => {
    const account = await createTestAccount({ balance: 500, grantBalance: 0 });
    const res = await deduct({
      ownerExternalId: account.ownerExternalId,
      amount: 200,
      referenceType: "test",
      referenceId: `deduct-zero-grant-${account.id}`,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.grantUsed).toBe(0);
    expect(body.data.balanceAfter).toBe(300);
  });

  // Scenario 6: insufficient total
  it("deduct returns 402 when total insufficient", async () => {
    const account = await createTestAccount({ balance: 100, grantBalance: 50 });
    const res = await deduct({
      ownerExternalId: account.ownerExternalId,
      amount: 200,
      referenceType: "test",
      referenceId: `deduct-insuff-${account.id}`,
    });
    expect(res.status).toBe(402);
  });

  // Scenario 7: boundary — deduct exactly grantBalance
  it("deduct exactly equals grantBalance", async () => {
    const account = await createTestAccount({
      balance: 500,
      grantBalance: 300,
    });
    const res = await deduct({
      ownerExternalId: account.ownerExternalId,
      amount: 300,
      referenceType: "test",
      referenceId: `deduct-exact-${account.id}`,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.grantUsed).toBe(300);
    expect(body.data.grantBalanceAfter).toBe(0);
    expect(body.data.balanceAfter).toBe(500); // untouched
  });

  // Scenario 8: expired quota + grantBalance
  it("deduct skips expired quota and uses grantBalance", async () => {
    const account = await createTestAccount({
      balance: 500,
      grantBalance: 200,
      quota: 1000,
      quotaExpiresAt: new Date(Date.now() - 86400000), // expired
    });
    const res = await deduct({
      ownerExternalId: account.ownerExternalId,
      amount: 150,
      referenceType: "test",
      referenceId: `deduct-expired-${account.id}`,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.grantUsed).toBe(150);
    expect(body.data.grantBalanceAfter).toBe(50);
    expect(body.data.balanceAfter).toBe(500); // untouched
  });

  // Scenario 9: credit limit fallback
  it("deduct uses credit limit after exhausting grantBalance and balance", async () => {
    const account = await createTestAccount({
      balance: 100,
      grantBalance: 100,
      creditLimit: 200,
    });
    const res = await deduct({
      ownerExternalId: account.ownerExternalId,
      amount: 350,
      referenceType: "test",
      referenceId: `deduct-credit-limit-${account.id}`,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.grantUsed).toBe(100);
    expect(body.data.grantBalanceAfter).toBe(0);
    expect(body.data.balanceAfter).toBe(-150); // 100 - 250, using credit limit
  });

  // Scenario 10: recharge only affects balance
  it("recharge does not affect grantBalance", async () => {
    const account = await createTestAccount({
      balance: 500,
      grantBalance: 200,
    });
    const res = await recharge({
      ownerExternalId: account.ownerExternalId,
      amountUSD: 1, // 1000 credits
      referenceType: "test",
      referenceId: `recharge-${account.id}`,
    });
    expect(res.status).toBe(200);
    const acctRes = await getAccount(account.ownerExternalId);
    const acctBody = await acctRes.json();
    expect(acctBody.data.account.grantBalance).toBe(200); // unchanged
    expect(acctBody.data.account.balance).toBe(1500);
  });

  // Scenario 11: refund only affects balance
  it("refund does not affect grantBalance", async () => {
    const account = await createTestAccount({
      balance: 500,
      grantBalance: 200,
    });
    const res = await refund({
      ownerExternalId: account.ownerExternalId,
      amount: 100,
      referenceType: "test",
      referenceId: `refund-${account.id}`,
    });
    expect(res.status).toBe(200);
    const acctRes = await getAccount(account.ownerExternalId);
    const acctBody = await acctRes.json();
    expect(acctBody.data.account.grantBalance).toBe(200); // unchanged
    expect(acctBody.data.account.balance).toBe(600);
  });

  // Scenario 12: grant idempotency
  it("grant is idempotent on same referenceType+referenceId", async () => {
    const account = await createTestAccount({ grantBalance: 0 });
    const body = {
      ownerExternalId: account.ownerExternalId,
      amount: 500,
      referenceType: "signup_bonus",
      referenceId: `idempotent-${account.id}`,
    };
    const res1 = await grant(body);
    const res2 = await grant(body);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.data.idempotent).toBe(true);

    const acctRes = await getAccount(account.ownerExternalId);
    const acctBody = await acctRes.json();
    expect(acctBody.data.account.grantBalance).toBe(500); // not 1000
  });

  // Scenario 13: grant auto-creates account
  it("grant creates account if not exists", async () => {
    const ownerExternalId = `new-owner-${Date.now()}`;
    const res = await grant({
      ownerExternalId,
      amount: 4000,
      referenceType: "signup_bonus",
      referenceId: `new-${ownerExternalId}`,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.grantBalanceAfter).toBe(4000);

    const acctRes = await getAccount(ownerExternalId);
    const acctBody = await acctRes.json();
    expect(acctBody.data.account.grantBalance).toBe(4000);
    expect(acctBody.data.account.balance).toBe(0);
  });

  // Scenario 14: multiple grants accumulate
  it("multiple grants accumulate in grantBalance", async () => {
    const account = await createTestAccount({ grantBalance: 0 });
    await grant({
      ownerExternalId: account.ownerExternalId,
      amount: 1000,
      referenceType: "bonus",
      referenceId: `multi-1-${account.id}`,
    });
    await grant({
      ownerExternalId: account.ownerExternalId,
      amount: 2000,
      referenceType: "bonus",
      referenceId: `multi-2-${account.id}`,
    });
    const acctRes = await getAccount(account.ownerExternalId);
    const acctBody = await acctRes.json();
    expect(acctBody.data.account.grantBalance).toBe(3000);
  });

  // Scenario 15: API response includes grantBalance
  it("GET /account returns grantBalance field", async () => {
    const account = await createTestAccount({ grantBalance: 500 });
    const res = await getAccount(account.ownerExternalId);
    const body = await res.json();
    expect(body.data.account).toHaveProperty("grantBalance");
    expect(body.data.account.grantBalance).toBe(500);
  });

  // Scenario 16: deduct response includes grantUsed
  it("deduct response includes grantUsed and grantBalanceAfter", async () => {
    const account = await createTestAccount({
      balance: 500,
      grantBalance: 100,
    });
    const res = await deduct({
      ownerExternalId: account.ownerExternalId,
      amount: 50,
      referenceType: "test",
      referenceId: `response-fields-${account.id}`,
    });
    const body = await res.json();
    expect(body.data).toHaveProperty("grantUsed");
    expect(body.data).toHaveProperty("grantBalanceAfter");
    expect(body.data.grantUsed).toBe(50);
    expect(body.data.grantBalanceAfter).toBe(50);
  });

  // Scenario 17: transaction metadata snapshot
  it("consume transaction metadata includes grantBalance fields", async () => {
    const account = await createTestAccount({
      balance: 500,
      grantBalance: 200,
    });
    const res = await deduct({
      ownerExternalId: account.ownerExternalId,
      amount: 100,
      referenceType: "test",
      referenceId: `metadata-${account.id}`,
    });
    const body = await res.json();
    const db = getDb();
    const [tx] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, body.data.transactionId));
    const billing = (tx.metadata as any)._billing;
    expect(billing.grantBalanceBefore).toBe(200);
    expect(billing.grantBalanceAfter).toBe(100);
    expect(billing.grantUsed).toBe(100);
  });

  // Scenario 18: frozen account grant
  it("grant succeeds on frozen account", async () => {
    const account = await createTestAccount({
      grantBalance: 0,
      status: "frozen",
    });
    const res = await grant({
      ownerExternalId: account.ownerExternalId,
      amount: 500,
      referenceType: "test",
      referenceId: `frozen-grant-${account.id}`,
    });
    expect(res.status).toBe(200);
  });

  // Scenario 19: admin_adjust negative grant_balance exceeds current
  it("admin_adjust negative grant_balance returns 400 when exceeding", async () => {
    const account = await createTestAccount({ grantBalance: 100 });
    const res = await adjust({
      ownerExternalId: account.ownerExternalId,
      amount: -200,
      target: "grant_balance",
      referenceType: "test",
      referenceId: `adjust-exceed-${account.id}`,
    });
    expect(res.status).toBe(400);
  });

  // Scenario 20: admin_adjust negative grant_balance within range
  it("admin_adjust decreases grantBalance correctly", async () => {
    const account = await createTestAccount({
      balance: 500,
      grantBalance: 300,
    });
    const res = await adjust({
      ownerExternalId: account.ownerExternalId,
      amount: -100,
      target: "grant_balance",
      referenceType: "test",
      referenceId: `adjust-grant-${account.id}`,
    });
    expect(res.status).toBe(200);
    const acctRes = await getAccount(account.ownerExternalId);
    const acctBody = await acctRes.json();
    expect(acctBody.data.account.grantBalance).toBe(200);
    expect(acctBody.data.account.balance).toBe(500); // unchanged
  });
});
```

- [ ] **Step 2: Run the new tests**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/billing-hub && pnpm --filter server test -- --run test/integration/grant-balance.spec.ts`

Expected: All 20 tests pass.

- [ ] **Step 3: Run the full test suite**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/billing-hub && pnpm --filter server test`

Expected: All tests pass (existing + new).

- [ ] **Step 4: Commit**

```bash
git add server/test/integration/grant-balance.spec.ts
git commit -m "test: add grant-balance integration tests (20 scenarios)"
```

---

## Task 11: Team9 — BillingHubService grantCredits()

**Files:**

- Modify: `/Users/jiangtao/Desktop/shenjingyuan/team9/apps/server/apps/gateway/src/billing-hub/billing-hub.service.ts`

- [ ] **Step 1: Add grantBalance to response types**

Update `WorkspaceBillingAccount` interface to include:

```typescript
grantBalance: number;
```

- [ ] **Step 2: Add grantCredits method**

Add after the existing `createWorkspacePortal` method:

```typescript
async grantCredits(
  workspaceId: string,
  amount: number,
  referenceType: string,
  referenceId: string,
  description?: string,
): Promise<void> {
  await this.request('/api/billing/grant', {
    method: 'POST',
    body: JSON.stringify({
      ownerExternalId: this.ownerExternalId(workspaceId),
      amount,
      referenceType,
      referenceId,
      description,
    }),
  });
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jiangtao/Desktop/shenjingyuan/team9
git add apps/server/apps/gateway/src/billing-hub/billing-hub.service.ts
git commit -m "feat: add grantCredits method to BillingHubService"
```

---

## Task 12: Team9 — Signup Bonus on Registration

**Files:**

- Modify: `/Users/jiangtao/Desktop/shenjingyuan/team9/apps/server/apps/gateway/src/workspace/workspace.service.ts`

- [ ] **Step 1: Inject BillingHubService**

Add to the constructor:

```typescript
private readonly billingHubService: BillingHubService,
```

Add import at top:

```typescript
import { BillingHubService } from "../billing-hub/billing-hub.service.js";
```

- [ ] **Step 2: Add grant call in provisionStarterWorkspaceForRegisteredUser**

After `workspace = await this.create(...)` and the onboarding setup (after line 187), add:

```typescript
try {
  await this.billingHubService.grantCredits(
    workspace.id,
    4000,
    "signup_bonus",
    `signup:${event.userId}`,
    "New user welcome bonus",
  );
} catch (error) {
  this.logger.error(
    `Failed to grant signup bonus for user ${event.userId}: ${this.getErrorMessage(error)}`,
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/apps/gateway/src/workspace/workspace.service.ts
git commit -m "feat: grant 4000 credits to new users on registration"
```

---

## Task 13: Final Verification

- [ ] **Step 1: Run billing-hub full test suite**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/billing-hub && pnpm --filter server test`

Expected: All tests pass.

- [ ] **Step 2: Run billing-hub unit tests**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/billing-hub && pnpm --filter server test:unit`

Expected: All unit tests pass.

- [ ] **Step 3: Verify Team9 server builds**

Run: `cd /Users/jiangtao/Desktop/shenjingyuan/team9 && pnpm build:server`

Expected: Build succeeds.

- [ ] **Step 4: Commit any final fixes**

If any tests or builds fail, fix and commit.
