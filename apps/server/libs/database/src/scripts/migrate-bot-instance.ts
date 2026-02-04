import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import * as schema from '../schemas/index.js';

/**
 * Generate access token and create OpenClaw instance for an existing bot.
 * Use this to fix bots that were created without the OpenClaw integration.
 */

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
    console.log('OPENCLAW_API_URL not configured, skipping instance creation');
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

  console.log('Creating OpenClaw instance...');
  console.log('Request body:', JSON.stringify(body, null, 2));

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
    console.error(`OpenClaw API error: ${res.status} — ${text}`);
    return false;
  }

  const result = await res.json();
  console.log(
    `OpenClaw instance created: ${result.access_url || result.instance?.access_url}`,
  );
  return true;
}

async function createInstanceForExistingBot(username: string) {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  console.log(`Creating OpenClaw instance for user: ${username}`);

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  try {
    // 1. Find the user by username
    const [user] = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
      })
      .from(schema.users)
      .where(eq(schema.users.username, username))
      .limit(1);

    if (!user) {
      console.error(`User "${username}" not found`);
      return;
    }

    console.log(`Found user: ${user.displayName} (${user.id})`);

    // 2. Find the user's bot
    const [bot] = await db
      .select({
        id: schema.bots.id,
        userId: schema.bots.userId,
        accessToken: schema.bots.accessToken,
      })
      .from(schema.bots)
      .where(eq(schema.bots.ownerId, user.id))
      .limit(1);

    if (!bot) {
      console.error(`No bot found for user "${username}"`);
      return;
    }

    console.log(`Found bot: ${bot.id} (userId: ${bot.userId})`);

    // 3. Generate new access token
    console.log('Generating access token...');
    const accessToken = await generateAccessToken(db, bot.id);
    console.log('Access token generated');

    // 4. Create OpenClaw instance
    const success = await createOpenClawInstance(
      bot.userId,
      bot.id,
      accessToken,
    );

    if (success) {
      console.log(
        `\nSuccessfully created OpenClaw instance for "${username}"!`,
      );
    } else {
      console.log(`\nFailed to create OpenClaw instance for "${username}"`);
    }
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Get username from command line arguments
const username = process.argv[2];

if (!username) {
  console.error('Usage: npx tsx migrate-bot-instance.ts <username>');
  console.error('Example: npx tsx migrate-bot-instance.ts winrey');
  process.exit(1);
}

createInstanceForExistingBot(username)
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
