import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { v7 as uuidv7 } from 'uuid';
import { eq, and, isNull } from 'drizzle-orm';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import * as schema from './schemas/index.js';

// ── OpenClaw API helpers ──────────────────────────────────────────────────

async function generateAccessToken(
  db: ReturnType<typeof drizzle>,
  botId: string,
  botUserId: string,
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
    console.log(
      '⏭️  OPENCLAW_API_URL not configured, skipping instance creation',
    );
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

  console.log('📡 Creating OpenClaw instance...');

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
    console.error(`❌ OpenClaw API error: ${res.status} — ${text}`);
    return false;
  }

  const result = await res.json();
  console.log(
    `✅ OpenClaw instance created: ${result.access_url || result.instance?.access_url}`,
  );
  return true;
}

/**
 * Create a smart chat bot for an existing user.
 * Reuses the logic from BotService.handleUserRegistered
 */
async function createBotForUser(username: string) {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  console.log(`Creating bot for user: ${username}`);

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  try {
    // 1. Find the user by username
    const [user] = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        email: schema.users.email,
        displayName: schema.users.displayName,
        userType: schema.users.userType,
      })
      .from(schema.users)
      .where(eq(schema.users.username, username))
      .limit(1);

    if (!user) {
      console.error(`❌ User "${username}" not found`);
      return;
    }

    if (user.userType !== 'human') {
      console.error(
        `❌ User "${username}" is not a human user (type: ${user.userType})`,
      );
      return;
    }

    console.log(`✅ Found user: ${user.displayName} (${user.id})`);

    // 2. Check if user already has a bot
    const [existingBot] = await db
      .select({ id: schema.bots.id, userId: schema.bots.userId })
      .from(schema.bots)
      .where(eq(schema.bots.ownerId, user.id))
      .limit(1);

    if (existingBot) {
      console.log(
        `⚠️  User "${username}" already has a bot (botId: ${existingBot.id})`,
      );

      // Check if DM channel already exists
      const [existingChannel] = await db
        .select({ id: schema.channels.id })
        .from(schema.channels)
        .innerJoin(
          schema.channelMembers,
          eq(schema.channels.id, schema.channelMembers.channelId),
        )
        .where(
          and(
            eq(schema.channels.type, 'direct'),
            eq(schema.channelMembers.userId, existingBot.userId),
          ),
        )
        .limit(1);

      if (existingChannel) {
        console.log(
          `⚠️  DM channel already exists (channelId: ${existingChannel.id})`,
        );
        return;
      }
    }

    // 3. Get user's tenant (workspace)
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
    console.log(`📦 User tenant: ${tenantId || 'none'}`);

    let botUserId: string;
    let botId: string;

    if (existingBot) {
      // Use existing bot
      botUserId = existingBot.userId;
      botId = existingBot.id;
      console.log(`♻️  Using existing bot user: ${botUserId}`);
    } else {
      // 4. Create bot account (shadow user in im_users)
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
        .returning({
          id: schema.users.id,
          username: schema.users.username,
        });

      console.log(
        `✅ Created bot user: ${newBotUser.username} (${newBotUser.id})`,
      );

      // 5. Create bot extension record (im_bots)
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

      console.log(`✅ Created bot record: ${newBot.id}`);
      botUserId = newBotUser.id;
      botId = newBot.id;

      // 6. Generate access token for the bot
      console.log('🔑 Generating access token...');
      const accessToken = await generateAccessToken(db, botId, botUserId);
      console.log(`✅ Access token generated`);

      // 7. Create OpenClaw instance
      await createOpenClawInstance(botUserId, botId, accessToken);
    }

    // 8. Create direct channel
    const channelId = uuidv7();
    await db.insert(schema.channels).values({
      id: channelId,
      tenantId: tenantId || null,
      type: 'direct',
      createdBy: user.id,
    });

    console.log(`✅ Created direct channel: ${channelId}`);

    // 9. Add both users as channel members
    await db.insert(schema.channelMembers).values([
      {
        id: uuidv7(),
        channelId,
        userId: user.id,
        role: 'member',
      },
      {
        id: uuidv7(),
        channelId,
        userId: botUserId,
        role: 'member',
      },
    ]);

    console.log(`✅ Added members to channel`);
    console.log(`\n🎉 Successfully created bot for user "${username}"!`);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Get username from command line arguments
const username = process.argv[2];

if (!username) {
  console.error('Usage: npx tsx migrate-bot.ts <username>');
  console.error('Example: npx tsx migrate-bot.ts mwr1998');
  process.exit(1);
}

createBotForUser(username)
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
