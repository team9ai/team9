#!/usr/bin/env npx tsx
/**
 * Fix script for OpenClaw installations that failed due to AWS Fargate vCPU quota
 * exhaustion (Feb 14–19, 2026).
 *
 * For each affected installed application (config missing instancesId):
 *   1. Find the existing bot
 *   2. Generate a fresh access token for the bot
 *   3. Call the control plane to create the compute instance
 *   4. Update installed_applications.config with the instancesId
 *
 * Usage:
 *   DRY_RUN=1 npx tsx scripts/fix-missing-openclaw-instances.ts   # preview only
 *   npx tsx scripts/fix-missing-openclaw-instances.ts              # execute fixes
 *
 * Required env vars (either DATABASE_URL or individual DB_* vars):
 *   DATABASE_URL           - Postgres connection string
 *   — OR —
 *   DB_HOST / DB_PORT / POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB
 *
 *   OPENCLAW_API_URL       - Control plane URL  (e.g. https://plane.claw.team9.ai)
 *   OPENCLAW_AUTH_TOKEN    - Control plane auth token
 *   API_URL                - Team9 API URL      (e.g. https://api.team9.ai)
 *   CAPABILITY_BASE_URL    - Capability service  (default: https://gateway.capability.team9.ai)
 *
 * Run from repo root:
 *   pnpm --filter @team9/gateway exec tsx ../../scripts/fix-missing-openclaw-instances.ts
 */

import crypto from "node:crypto";
import postgres from "postgres";
import bcrypt from "bcrypt";

// ── Config ──────────────────────────────────────────────────────────────

const DATABASE_URL =
  process.env.DATABASE_URL ||
  (process.env.DB_HOST
    ? `postgres://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.POSTGRES_DB}`
    : undefined);
const OPENCLAW_API_URL = process.env.OPENCLAW_API_URL;
const OPENCLAW_AUTH_TOKEN = process.env.OPENCLAW_AUTH_TOKEN;
const API_URL = process.env.API_URL;
const CAPABILITY_BASE_URL =
  process.env.CAPABILITY_BASE_URL || "https://gateway.capability.team9.ai";
const DRY_RUN = process.env.DRY_RUN === "1";

if (!DATABASE_URL || !OPENCLAW_API_URL || !OPENCLAW_AUTH_TOKEN || !API_URL) {
  console.error(
    "Missing required env vars. Need: DATABASE_URL (or DB_HOST+POSTGRES_*), OPENCLAW_API_URL, OPENCLAW_AUTH_TOKEN, API_URL",
  );
  process.exit(1);
}

const sql = postgres(DATABASE_URL);

// ── Helpers ─────────────────────────────────────────────────────────────

async function openclawRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${OPENCLAW_API_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENCLAW_AUTH_TOKEN}`,
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }

  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as unknown as T;
  }
  return (await res.json()) as T;
}

function generateAccessToken(): {
  rawToken: string;
  storedHash: Promise<string>;
} {
  const rawHex = crypto.randomBytes(48).toString("hex");
  const rawToken = `t9bot_${rawHex}`;
  const fingerprint = rawHex.slice(0, 8);
  const storedHash = bcrypt.hash(rawHex, 10).then((h) => `${fingerprint}:${h}`);
  return { rawToken, storedHash };
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log(DRY_RUN ? "=== DRY RUN ===" : "=== EXECUTING FIXES ===");
  console.log();

  // 1. Find affected installed applications
  const affected = await sql`
    SELECT id, tenant_id, config
    FROM im_installed_applications
    WHERE application_id = 'openclaw'
      AND (config = '{}'::jsonb OR config->>'instancesId' IS NULL)
  `;

  console.log(`Found ${affected.length} affected installations\n`);

  let fixed = 0;
  let skipped = 0;
  let failed = 0;

  for (const app of affected) {
    const appId = app.id as string;
    const tenantId = app.tenant_id as string;

    // 2. Find the primary bot
    const bots = await sql`
      SELECT id, user_id
      FROM im_bots
      WHERE installed_application_id = ${appId}
      ORDER BY created_at ASC
      LIMIT 1
    `;

    if (bots.length === 0) {
      console.log(`[SKIP] app=${appId} tenant=${tenantId} — no bot found`);
      skipped++;
      continue;
    }

    const botId = bots[0].id as string;
    console.log(`[FIX]  app=${appId} tenant=${tenantId} bot=${botId}`);

    if (DRY_RUN) {
      fixed++;
      continue;
    }

    try {
      // 3. Generate a fresh access token
      const { rawToken, storedHash } = generateAccessToken();
      const hash = await storedHash;

      await sql`
        UPDATE im_bots
        SET access_token = ${hash}, updated_at = NOW()
        WHERE id = ${botId}
      `;

      // 4. Create the OpenClaw instance
      const instancesId = botId;
      const result = await openclawRequest<{
        instance: { access_url: string };
        access_url: string;
      }>("POST", "/api/instances", {
        id: instancesId,
        subdomain: instancesId,
        env: {
          TEAM9_TOKEN: rawToken,
          TEAM9_BASE_URL: API_URL,
          CAPABILITY_BASE_URL,
        },
      });

      console.log(`       → instance created: ${result?.access_url ?? "ok"}`);

      // 5. Update installed application config
      await sql`
        UPDATE im_installed_applications
        SET config = config || ${sql.json({ instancesId })}::jsonb,
            updated_at = NOW()
        WHERE id = ${appId}
      `;

      fixed++;
    } catch (err) {
      console.error(`       → FAILED: ${err}`);
      failed++;
    }
  }

  console.log();
  console.log("─".repeat(50));
  console.log(
    `Total: ${affected.length}  Fixed: ${fixed}  Skipped: ${skipped}  Failed: ${failed}`,
  );

  await sql.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
