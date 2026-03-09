import postgres from '../node_modules/.pnpm/postgres@3.4.7/node_modules/postgres/src/index.js';
import { randomUUID } from 'crypto';

const TENANT_ID = '019c46f8-bfde-763c-9d3d-fa7ff5465987';

const sql = postgres({
  host: 'hopper.proxy.rlwy.net',
  port: 36277,
  username: 'postgres',
  password: 'ewACAKFjjiuRhVrxrzRTAVCBBzznKwPp',
  database: 'railway',
  ssl: { rejectUnauthorized: false },
  connect_timeout: 10,
  idle_timeout: 5,
});

try {
  // Find a user in this tenant via channel_members or any table linking user to tenant
  // The resources table references im_users. Let's find users who created tasks in this tenant.
  let users = await sql`
    SELECT DISTINCT t.creator_id as id, u.display_name
    FROM agent_task__tasks t
    JOIN im_users u ON u.id = t.creator_id
    WHERE t.tenant_id = ${TENANT_ID}
    LIMIT 5
  `;

  if (users.length === 0) {
    // Fallback: try channel_members
    users = await sql`
      SELECT DISTINCT cm.user_id as id, u.display_name
      FROM im_channel_members cm
      JOIN im_channels c ON c.id = cm.channel_id
      JOIN im_users u ON u.id = cm.user_id
      WHERE c.tenant_id = ${TENANT_ID}
      LIMIT 5
    `;
  }

  if (users.length === 0) {
    console.error('No users found in this tenant!');
    process.exit(1);
  }

  console.log('Found users:', users.map(u => `${u.display_name} (${u.id})`).join(', '));
  const creatorId = users[0].id;
  const secondUserId = users.length > 1 ? users[1].id : users[0].id;

  const now = new Date();
  const fiveMinAgo = new Date(now - 5 * 60 * 1000);
  const oneHourAgo = new Date(now - 60 * 60 * 1000);
  const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000);

  // Seed resources
  const resources = [
    {
      id: randomUUID(),
      tenant_id: TENANT_ID,
      type: 'agent_computer',
      name: 'Dev Server (us-east-1)',
      description: '开发环境服务器，运行于 AWS us-east-1，Ubuntu 22.04 LTS，8核16G。',
      config: JSON.stringify({
        connectionType: 'cloud',
        host: 'ec2-54-162-xxx-xxx.compute-1.amazonaws.com',
        port: 22,
        os: 'Ubuntu 22.04 LTS',
        arch: 'x86_64',
      }),
      status: 'online',
      authorizations: JSON.stringify([
        {
          granteeType: 'user',
          granteeId: creatorId,
          permissions: { level: 'full' },
          grantedBy: creatorId,
          grantedAt: twoDaysAgo.toISOString(),
        },
      ]),
      last_heartbeat_at: fiveMinAgo,
      creator_id: creatorId,
      created_at: twoDaysAgo,
      updated_at: now,
    },
    {
      id: randomUUID(),
      tenant_id: TENANT_ID,
      type: 'agent_computer',
      name: "Winrey's MacBook Pro",
      description: '本地开发机，通过 Ahand 连接。M2 Max, 32GB RAM。',
      config: JSON.stringify({
        connectionType: 'ahand',
        os: 'macOS 15.2',
        arch: 'arm64',
      }),
      status: 'online',
      authorizations: JSON.stringify([
        {
          granteeType: 'user',
          granteeId: creatorId,
          permissions: { level: 'full' },
          grantedBy: creatorId,
          grantedAt: twoDaysAgo.toISOString(),
        },
        {
          granteeType: 'user',
          granteeId: secondUserId,
          permissions: { level: 'readonly' },
          grantedBy: creatorId,
          grantedAt: oneHourAgo.toISOString(),
        },
      ]),
      last_heartbeat_at: now,
      creator_id: creatorId,
      created_at: twoDaysAgo,
      updated_at: now,
    },
    {
      id: randomUUID(),
      tenant_id: TENANT_ID,
      type: 'agent_computer',
      name: 'GPU Worker (A100)',
      description: 'GPU 训练节点，NVIDIA A100 80GB × 2，用于模型微调和推理加速。',
      config: JSON.stringify({
        connectionType: 'ssh',
        host: '10.0.3.42',
        port: 22,
        os: 'Ubuntu 22.04 LTS',
        arch: 'x86_64',
      }),
      status: 'offline',
      authorizations: JSON.stringify([]),
      last_heartbeat_at: twoDaysAgo,
      creator_id: creatorId,
      created_at: twoDaysAgo,
      updated_at: twoDaysAgo,
    },
    {
      id: randomUUID(),
      tenant_id: TENANT_ID,
      type: 'agent_computer',
      name: 'Staging Server',
      description: '预发布环境，自动部署 dev 分支。4核8G，运行于阿里云 ECS。',
      config: JSON.stringify({
        connectionType: 'ssh',
        host: '47.96.xxx.xxx',
        port: 2222,
        os: 'Debian 12',
        arch: 'x86_64',
      }),
      status: 'error',
      authorizations: JSON.stringify([
        {
          granteeType: 'user',
          granteeId: secondUserId,
          permissions: { level: 'full' },
          grantedBy: creatorId,
          grantedAt: twoDaysAgo.toISOString(),
        },
      ]),
      last_heartbeat_at: oneHourAgo,
      creator_id: creatorId,
      created_at: twoDaysAgo,
      updated_at: oneHourAgo,
    },
    {
      id: randomUUID(),
      tenant_id: TENANT_ID,
      type: 'api',
      name: 'OpenAI GPT-4o',
      description: '主力 AI 模型 API，用于任务规划、代码生成和自然语言处理。',
      config: JSON.stringify({
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-proj-xxxxxxxxxxxxxxxxxxxxx',
        model: 'gpt-4o',
      }),
      status: 'online',
      authorizations: JSON.stringify([
        {
          granteeType: 'user',
          granteeId: creatorId,
          permissions: { level: 'full' },
          grantedBy: creatorId,
          grantedAt: twoDaysAgo.toISOString(),
        },
        {
          granteeType: 'user',
          granteeId: secondUserId,
          permissions: { level: 'full' },
          grantedBy: creatorId,
          grantedAt: twoDaysAgo.toISOString(),
        },
      ]),
      last_heartbeat_at: null,
      creator_id: creatorId,
      created_at: twoDaysAgo,
      updated_at: now,
    },
    {
      id: randomUUID(),
      tenant_id: TENANT_ID,
      type: 'api',
      name: 'Claude Sonnet 4',
      description: 'Anthropic Claude API，用于复杂推理和长文本分析。',
      config: JSON.stringify({
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'sk-ant-xxxxxxxxxxxxxxxxxxxxx',
        model: 'claude-sonnet-4-20250514',
      }),
      status: 'online',
      authorizations: JSON.stringify([
        {
          granteeType: 'user',
          granteeId: creatorId,
          permissions: { level: 'full' },
          grantedBy: creatorId,
          grantedAt: twoDaysAgo.toISOString(),
        },
      ]),
      last_heartbeat_at: null,
      creator_id: creatorId,
      created_at: twoDaysAgo,
      updated_at: now,
    },
    {
      id: randomUUID(),
      tenant_id: TENANT_ID,
      type: 'api',
      name: 'GitHub API',
      description: 'GitHub REST & GraphQL API，用于自动化代码审查、Issue 管理和 CI/CD 操作。',
      config: JSON.stringify({
        provider: 'github',
        baseUrl: 'https://api.github.com',
        apiKey: 'ghp_xxxxxxxxxxxxxxxxxxxxx',
      }),
      status: 'online',
      authorizations: JSON.stringify([
        {
          granteeType: 'user',
          granteeId: creatorId,
          permissions: { level: 'full' },
          grantedBy: creatorId,
          grantedAt: twoDaysAgo.toISOString(),
        },
      ]),
      last_heartbeat_at: null,
      creator_id: creatorId,
      created_at: twoDaysAgo,
      updated_at: now,
    },
    {
      id: randomUUID(),
      tenant_id: TENANT_ID,
      type: 'api',
      name: 'Google Gemini Pro',
      description: 'Google AI API，用于多模态理解和搜索增强生成。',
      config: JSON.stringify({
        provider: 'google',
        baseUrl: 'https://generativelanguage.googleapis.com/v1',
        apiKey: 'AIzaSyXXXXXXXXXXXXXXXXX',
        model: 'gemini-2.0-flash',
      }),
      status: 'configuring',
      authorizations: JSON.stringify([]),
      last_heartbeat_at: null,
      creator_id: secondUserId,
      created_at: oneHourAgo,
      updated_at: oneHourAgo,
    },
  ];

  // Insert resources
  for (const r of resources) {
    await sql`
      INSERT INTO resources (id, tenant_id, type, name, description, config, status, authorizations, last_heartbeat_at, creator_id, created_at, updated_at)
      VALUES (${r.id}, ${r.tenant_id}, ${r.type}, ${r.name}, ${r.description}, ${r.config}::jsonb, ${r.status}, ${r.authorizations}::jsonb, ${r.last_heartbeat_at}, ${r.creator_id}, ${r.created_at}, ${r.updated_at})
    `;
    console.log(`✓ Inserted resource: ${r.name} (${r.type}, ${r.status})`);
  }

  // Insert some usage logs
  const usageLogs = [
    // Dev Server usage
    {
      id: randomUUID(),
      resource_id: resources[0].id,
      actor_type: 'agent',
      actor_id: creatorId,
      action: 'ssh_session',
      metadata: JSON.stringify({ duration_seconds: 3420, commands_executed: 47 }),
      created_at: oneHourAgo,
    },
    {
      id: randomUUID(),
      resource_id: resources[0].id,
      actor_type: 'agent',
      actor_id: creatorId,
      action: 'file_transfer',
      metadata: JSON.stringify({ direction: 'upload', file: 'model-v3.bin', size_mb: 256 }),
      created_at: fiveMinAgo,
    },
    // MacBook usage
    {
      id: randomUUID(),
      resource_id: resources[1].id,
      actor_type: 'agent',
      actor_id: creatorId,
      action: 'terminal_session',
      metadata: JSON.stringify({ duration_seconds: 7200, shell: 'zsh' }),
      created_at: oneHourAgo,
    },
    // OpenAI API usage
    {
      id: randomUUID(),
      resource_id: resources[4].id,
      actor_type: 'agent',
      actor_id: creatorId,
      action: 'api_call',
      metadata: JSON.stringify({ model: 'gpt-4o', tokens_in: 1520, tokens_out: 890, latency_ms: 2340 }),
      created_at: new Date(now - 30 * 60 * 1000),
    },
    {
      id: randomUUID(),
      resource_id: resources[4].id,
      actor_type: 'agent',
      actor_id: secondUserId,
      action: 'api_call',
      metadata: JSON.stringify({ model: 'gpt-4o', tokens_in: 3200, tokens_out: 1500, latency_ms: 4120 }),
      created_at: new Date(now - 15 * 60 * 1000),
    },
    {
      id: randomUUID(),
      resource_id: resources[4].id,
      actor_type: 'user',
      actor_id: creatorId,
      action: 'api_call',
      metadata: JSON.stringify({ model: 'gpt-4o', tokens_in: 800, tokens_out: 420, latency_ms: 1200 }),
      created_at: fiveMinAgo,
    },
    // Claude API usage
    {
      id: randomUUID(),
      resource_id: resources[5].id,
      actor_type: 'agent',
      actor_id: creatorId,
      action: 'api_call',
      metadata: JSON.stringify({ model: 'claude-sonnet-4-20250514', tokens_in: 5000, tokens_out: 2800, latency_ms: 5600 }),
      created_at: new Date(now - 45 * 60 * 1000),
    },
    {
      id: randomUUID(),
      resource_id: resources[5].id,
      actor_type: 'agent',
      actor_id: creatorId,
      action: 'api_call',
      metadata: JSON.stringify({ model: 'claude-sonnet-4-20250514', tokens_in: 12000, tokens_out: 4500, latency_ms: 8900 }),
      created_at: fiveMinAgo,
    },
    // GitHub API usage
    {
      id: randomUUID(),
      resource_id: resources[6].id,
      actor_type: 'agent',
      actor_id: creatorId,
      action: 'api_call',
      metadata: JSON.stringify({ endpoint: 'POST /repos/{owner}/{repo}/pulls', status: 201 }),
      created_at: new Date(now - 20 * 60 * 1000),
    },
    {
      id: randomUUID(),
      resource_id: resources[6].id,
      actor_type: 'agent',
      actor_id: creatorId,
      action: 'api_call',
      metadata: JSON.stringify({ endpoint: 'GET /repos/{owner}/{repo}/issues', status: 200, count: 15 }),
      created_at: fiveMinAgo,
    },
  ];

  for (const log of usageLogs) {
    await sql`
      INSERT INTO resource_usage_logs (id, resource_id, actor_type, actor_id, action, metadata, created_at)
      VALUES (${log.id}, ${log.resource_id}, ${log.actor_type}, ${log.actor_id}, ${log.action}, ${log.metadata}::jsonb, ${log.created_at})
    `;
  }
  console.log(`✓ Inserted ${usageLogs.length} usage logs`);

  // Final count
  const count = await sql`SELECT count(*) as c FROM resources WHERE tenant_id = ${TENANT_ID}`;
  console.log(`\nDone! Total resources in workspace: ${count[0].c}`);
} finally {
  await sql.end({ timeout: 3 });
  process.exit(0);
}
