import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { v7 as uuidv7 } from 'uuid';
import { eq, and, isNull } from 'drizzle-orm';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import * as schema from '../schemas/index.js';

// ── Helpers ──────────────────────────────────────────────────────────────

async function generateAccessToken(
  db: ReturnType<typeof drizzle>,
  botId: string,
): Promise<string> {
  const rawHex = crypto.randomBytes(48).toString('hex');
  const rawToken = `t9bot_${rawHex}`;
  const fingerprint = rawHex.slice(0, 8);
  const hash = await bcrypt.hash(rawHex, 10);

  await db
    .update(schema.bots)
    .set({
      accessToken: `${fingerprint}:${hash}`,
      updatedAt: new Date(),
    })
    .where(eq(schema.bots.id, botId));

  return rawToken;
}

async function createOpenClawInstance(
  botUserId: string,
  botId: string,
  accessToken: string,
): Promise<boolean> {
  const apiUrl = process.env.OPENCLAW_API_URL;
  const authToken = process.env.OPENCLAW_AUTH_TOKEN;
  const baseUrl = process.env.API_URL;

  if (!apiUrl) {
    console.log('    OPENCLAW_API_URL not configured, skipping');
    return false;
  }

  const body = {
    id: botUserId,
    subdomain: botId,
    env: {
      TEAM9_TOKEN: accessToken,
      TEAM9_BASE_URL: baseUrl,
    },
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const res = await fetch(`${apiUrl}/api/instances`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.log(`    OpenClaw error: ${res.status} — ${text.slice(0, 100)}`);
    return false;
  }

  const result = await res.json();
  console.log(
    `    OpenClaw: ${result.access_url || result.instance?.access_url}`,
  );
  return true;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function migrateAllBots() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  console.log('=== Migrating bots for all human users ===\n');

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  try {
    // 1. Get all human users
    const humanUsers = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
      })
      .from(schema.users)
      .where(eq(schema.users.userType, 'human'));

    console.log(`Found ${humanUsers.length} human users\n`);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const user of humanUsers) {
      console.log(`[${user.username}] Processing...`);

      // 2. Check if user has a bot
      const [existingBot] = await db
        .select({
          id: schema.bots.id,
          userId: schema.bots.userId,
          accessToken: schema.bots.accessToken,
        })
        .from(schema.bots)
        .where(eq(schema.bots.ownerId, user.id))
        .limit(1);

      // 3. Get user's tenant
      const [membership] = await db
        .select({ tenantId: schema.tenantMembers.tenantId })
        .from(schema.tenantMembers)
        .where(
          and(
            eq(schema.tenantMembers.userId, user.id),
            isNull(schema.tenantMembers.leftAt),
          ),
        )
        .limit(1);

      const tenantId = membership?.tenantId;

      let botId: string;
      let botUserId: string;

      if (existingBot) {
        botId = existingBot.id;
        botUserId = existingBot.userId;

        // Ensure bot is a workspace member (for adding to group channels)
        if (tenantId) {
          const [existingTenantMember] = await db
            .select({ id: schema.tenantMembers.id })
            .from(schema.tenantMembers)
            .where(
              and(
                eq(schema.tenantMembers.tenantId, tenantId),
                eq(schema.tenantMembers.userId, botUserId),
                isNull(schema.tenantMembers.leftAt),
              ),
            )
            .limit(1);

          if (!existingTenantMember) {
            await db.insert(schema.tenantMembers).values({
              id: uuidv7(),
              tenantId,
              userId: botUserId,
              role: 'member',
              invitedBy: user.id,
            });
            console.log(`    Added bot to workspace`);
          }
        }

        // Check if bot already has OpenClaw instance (has access token)
        if (existingBot.accessToken) {
          console.log(`    Already has bot with token, skipping`);
          skipped++;
          continue;
        }

        console.log(`    Has bot but no token, generating...`);
        const accessToken = await generateAccessToken(db, botId);
        await createOpenClawInstance(botUserId, botId, accessToken);
        updated++;
      } else {
        // 4. Create bot account
        const botUsername = `${user.username}_bot`;
        const botEmail = `${botUsername}@team9.local`;

        const [newBotUser] = await db
          .insert(schema.users)
          .values({
            id: uuidv7(),
            email: botEmail,
            username: botUsername,
            displayName: `${user.displayName}'s Bot`,
            status: 'online',
            isActive: true,
            emailVerified: true,
            userType: 'bot',
          })
          .returning({ id: schema.users.id });

        // 5. Create bot record
        const [newBot] = await db
          .insert(schema.bots)
          .values({
            id: uuidv7(),
            userId: newBotUser.id,
            type: 'custom',
            ownerId: user.id,
            description: `Auto-created bot for ${user.username}`,
            capabilities: { canSendMessages: true, canReadMessages: true },
            isActive: true,
          })
          .returning();

        botId = newBot.id;
        botUserId = newBotUser.id;

        console.log(`    Created bot: ${botUsername}`);

        // 6. Generate access token
        const accessToken = await generateAccessToken(db, botId);

        // 7. Create OpenClaw instance
        await createOpenClawInstance(botUserId, botId, accessToken);

        // 8. Add bot to workspace (for adding to group channels)
        if (tenantId) {
          await db.insert(schema.tenantMembers).values({
            id: uuidv7(),
            tenantId,
            userId: botUserId,
            role: 'member',
            invitedBy: user.id,
          });
          console.log(`    Added bot to workspace`);
        }

        // 9. Create direct channel
        const channelId = uuidv7();
        await db.insert(schema.channels).values({
          id: channelId,
          tenantId: tenantId || null,
          type: 'direct',
          createdBy: user.id,
        });

        // 10. Add channel members
        await db.insert(schema.channelMembers).values([
          { id: uuidv7(), channelId, userId: user.id, role: 'member' },
          { id: uuidv7(), channelId, userId: botUserId, role: 'member' },
        ]);

        console.log(`    Created DM channel`);
        created++;
      }
    }

    console.log('\n=== Summary ===');
    console.log(`Created: ${created}`);
    console.log(`Updated: ${updated}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Total: ${humanUsers.length}`);
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

migrateAllBots()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
