import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { generateText, tool as defineTool, jsonSchema } from 'ai';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  asc,
  inArray,
  type PostgresJsDatabase,
} from '@team9/database';
import { PlatformLlmService } from '../../bot/platform-llm.service.js';
import * as schema from '@team9/database/schemas';
import type { PropertyValueType } from '@team9/shared';
import {
  PropertyDefinitionsService,
  type PropertyDefinitionRow,
} from './property-definitions.service.js';
import { MessagePropertiesService } from './message-properties.service.js';
import { AuditService } from '../audit/audit.service.js';

/** Maximum number of retry rounds when AI returns invalid values */
const MAX_RETRIES = 3;

/** Model to use for auto-fill */
const AUTO_FILL_MODEL = 'claude-sonnet-4-20250514';

/** Property value types that AI can reasonably generate */
const AI_FILLABLE_TYPES = new Set<PropertyValueType>([
  'text',
  'number',
  'boolean',
  'single_select',
  'multi_select',
  'tags',
  'url',
  'person',
]);

interface AutoFillResult {
  [key: string]:
    | { value: unknown; unchanged?: never }
    | { unchanged: true; value?: never };
}

interface SelectConfig {
  options?: Array<{ value: string; label?: string; color?: string }>;
}

@Injectable()
export class AiAutoFillService {
  private readonly logger = new Logger(AiAutoFillService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly platformLlmService: PlatformLlmService,
    private readonly propertyDefinitionsService: PropertyDefinitionsService,
    private readonly messagePropertiesService: MessagePropertiesService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Trigger AI auto-fill for a message's properties.
   *
   * 1. Load message with channel info, reactions, thread replies
   * 2. Load channel property definitions (filter to aiAutoFill=true)
   * 3. Load current properties
   * 4. Build XML prompt
   * 5. Build function_call tool schema
   * 6. Call AI (up to 3 rounds on validation failure)
   * 7. Parse and validate response
   * 8. Apply valid results via MessagePropertiesService.batchSet
   * 9. Record in audit log
   */
  async autoFill(
    messageId: string,
    userId: string,
    tenantId: string,
    opts?: { fields?: string[]; preserveExisting?: boolean },
  ): Promise<{ filled: Record<string, unknown>; skipped: string[] }> {
    // 1. Load and validate message (also returns channel data)
    const { message } =
      await this.messagePropertiesService.getValidatedMessage(messageId);

    // Load full channel info (getValidatedMessage only returns type + propertySettings)
    const [channel] = await this.db
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.id, message.channelId))
      .limit(1);

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    // 2. Load property definitions, filter to aiAutoFill=true and AI-fillable types
    const allDefinitions =
      await this.propertyDefinitionsService.findAllByChannel(message.channelId);

    let targetDefinitions = allDefinitions.filter(
      (d) => d.aiAutoFill && AI_FILLABLE_TYPES.has(d.valueType),
    );

    // Filter by requested fields if specified
    if (opts?.fields && opts.fields.length > 0) {
      const fieldSet = new Set(opts.fields);
      targetDefinitions = targetDefinitions.filter((d) => fieldSet.has(d.key));
    }

    if (targetDefinitions.length === 0) {
      return { filled: {}, skipped: [] };
    }

    // 3. Load current properties
    const currentProperties =
      await this.messagePropertiesService.getProperties(messageId);

    // If preserveExisting, filter out definitions that already have values
    if (opts?.preserveExisting) {
      targetDefinitions = targetDefinitions.filter(
        (d) =>
          currentProperties[d.key] === undefined ||
          currentProperties[d.key] === null,
      );
    }

    if (targetDefinitions.length === 0) {
      return { filled: {}, skipped: [] };
    }

    // Load reactions
    const reactions = await this.db
      .select()
      .from(schema.messageReactions)
      .where(eq(schema.messageReactions.messageId, messageId));

    // Aggregate reactions by emoji
    const reactionMap = new Map<string, number>();
    for (const r of reactions) {
      reactionMap.set(r.emoji, (reactionMap.get(r.emoji) ?? 0) + 1);
    }

    // Load thread replies (up to 20 most recent)
    const threadReplies = await this.db
      .select({
        content: schema.messages.content,
        senderId: schema.messages.senderId,
      })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.parentId, messageId),
          eq(schema.messages.isDeleted, false),
        ),
      )
      .orderBy(asc(schema.messages.createdAt))
      .limit(20);

    // Load sender names for thread replies
    const senderIds = [
      ...new Set(threadReplies.map((r) => r.senderId).filter(Boolean)),
    ] as string[];
    const senderMap = new Map<string, string>();
    if (senderIds.length > 0) {
      const senders = await this.db
        .select({
          id: schema.users.id,
          displayName: schema.users.displayName,
          username: schema.users.username,
        })
        .from(schema.users)
        .where(inArray(schema.users.id, senderIds));

      for (const s of senders) {
        senderMap.set(s.id, s.displayName ?? s.username);
      }
    }

    // 4. Build XML prompt
    const xmlPrompt = this.buildXmlPrompt({
      channel,
      message,
      reactions: reactionMap,
      threadReplies: threadReplies.map((r) => ({
        sender: r.senderId
          ? (senderMap.get(r.senderId) ?? 'Unknown')
          : 'Unknown',
        content: r.content ?? '',
      })),
      currentProperties,
      targetDefinitions,
      allDefinitions,
      requestedFields: opts?.fields,
    });

    // 5. Build tool schema
    const toolInputSchema = this.buildToolInputSchema(targetDefinitions);

    // 6. Call AI with retries
    let lastError: string | null = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = await this.callAI(
          tenantId,
          xmlPrompt,
          toolInputSchema,
          targetDefinitions,
          lastError,
        );

        // 7. Validate response
        const { valid, invalid } = this.validateResult(
          result,
          targetDefinitions,
        );

        if (invalid.length > 0 && attempt < MAX_RETRIES - 1) {
          lastError = `Validation errors: ${invalid.map((e) => `${e.key}: ${e.reason}`).join('; ')}`;
          this.logger.warn(
            `AI auto-fill attempt ${attempt + 1} had validation errors, retrying: ${lastError}`,
          );
          continue;
        }

        // 8. Apply valid results
        const toSet = valid.map(({ key, value }) => ({ key, value }));
        const skipped = invalid.map((e) => e.key);

        if (toSet.length > 0) {
          await this.messagePropertiesService.batchSet(
            messageId,
            toSet,
            userId,
            { skipAudit: true },
          );
        }

        // 9. Record in audit log
        const filledMap: Record<string, unknown> = {};
        for (const { key, value } of toSet) {
          filledMap[key] = value;
        }

        await this.auditService.log({
          channelId: message.channelId,
          entityType: 'message',
          entityId: messageId,
          action: 'property_set',
          changes: Object.fromEntries(
            toSet.map(({ key, value }) => [
              key,
              { old: currentProperties[key] ?? null, new: value },
            ]),
          ),
          performedBy: undefined,
          metadata: {
            source: 'ai_auto_fill',
            model: AUTO_FILL_MODEL,
            round: attempt + 1,
            skippedFields: skipped,
            requestedFields: opts?.fields ?? null,
            preserveExisting: opts?.preserveExisting ?? false,
          },
        });

        return { filled: filledMap, skipped };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(`AI auto-fill attempt ${attempt + 1} failed: ${msg}`);
        lastError = msg;

        if (attempt === MAX_RETRIES - 1) {
          throw new BadRequestException(
            `AI auto-fill failed after ${MAX_RETRIES} attempts: ${msg}`,
          );
        }
      }
    }

    // Should not reach here, but just in case
    throw new BadRequestException('AI auto-fill failed');
  }

  // ==================== Private Helpers ====================

  // LLM provider is created per-call via PlatformLlmService (tenant-scoped token)

  private buildXmlPrompt(params: {
    channel: schema.Channel;
    message: schema.Message;
    reactions: Map<string, number>;
    threadReplies: Array<{ sender: string; content: string }>;
    currentProperties: Record<string, unknown>;
    targetDefinitions: PropertyDefinitionRow[];
    allDefinitions: PropertyDefinitionRow[];
    requestedFields?: string[];
  }): string {
    const {
      channel,
      message,
      reactions,
      threadReplies,
      currentProperties,
      targetDefinitions,
      allDefinitions,
      requestedFields,
    } = params;

    const parts: string[] = ['<context>'];

    // Channel info
    parts.push('  <channel>');
    parts.push(`    <name>${this.escapeXml(channel.name ?? '')}</name>`);
    parts.push(
      `    <description>${this.escapeXml(channel.description ?? '')}</description>`,
    );
    parts.push('  </channel>');

    // Message
    parts.push('  <message>');
    parts.push(
      `    <content>${this.escapeXml(message.content ?? '')}</content>`,
    );

    if (reactions.size > 0) {
      parts.push('    <reactions>');
      for (const [emoji, count] of reactions) {
        parts.push(
          `      <reaction emoji="${this.escapeXml(emoji)}" count="${count}" />`,
        );
      }
      parts.push('    </reactions>');
    }

    if (threadReplies.length > 0) {
      parts.push('    <thread_replies>');
      for (const reply of threadReplies) {
        parts.push(
          `      <reply sender="${this.escapeXml(reply.sender)}">${this.escapeXml(reply.content)}</reply>`,
        );
      }
      parts.push('    </thread_replies>');
    }

    parts.push('  </message>');

    // Current properties
    const currentEntries = Object.entries(currentProperties);
    if (currentEntries.length > 0) {
      const defByKey = new Map(allDefinitions.map((d) => [d.key, d]));
      parts.push('  <current_properties>');
      for (const [key, value] of currentEntries) {
        const strValue =
          value === null || value === undefined
            ? ''
            : typeof value === 'object'
              ? JSON.stringify(value)
              : JSON.stringify(value);
        const def = defByKey.get(key);
        const typeAttr = def ? ` type="${def.valueType}"` : '';
        parts.push(
          `    <property key="${this.escapeXml(key)}"${typeAttr}>${this.escapeXml(strValue)}</property>`,
        );
      }
      parts.push('  </current_properties>');
    }

    // Channel schema (target definitions only)
    parts.push('  <channel_schema>');
    for (const def of targetDefinitions) {
      const attrs: string[] = [
        `key="${this.escapeXml(def.key)}"`,
        `type="${def.valueType}"`,
        `required="${def.isRequired}"`,
        `ai_fill="true"`,
      ];

      if (
        def.valueType === 'single_select' ||
        def.valueType === 'multi_select'
      ) {
        attrs.push(`allow_new_options="${def.allowNewOptions}"`);
      }

      if (def.aiAutoFillPrompt) {
        attrs.push(`hint="${this.escapeXml(def.aiAutoFillPrompt)}"`);
      }

      const config = def.config as SelectConfig | null;
      const options = config?.options;

      if (options && options.length > 0) {
        parts.push(`    <property ${attrs.join(' ')}>`);
        for (const opt of options) {
          parts.push(`      <option>${this.escapeXml(opt.value)}</option>`);
        }
        parts.push('    </property>');
      } else {
        parts.push(`    <property ${attrs.join(' ')} />`);
      }
    }
    parts.push('  </channel_schema>');

    // Requested fields
    if (requestedFields && requestedFields.length > 0) {
      parts.push('  <generate_fields>');
      for (const field of requestedFields) {
        parts.push(`    <field>${this.escapeXml(field)}</field>`);
      }
      parts.push('  </generate_fields>');
    }

    parts.push('</context>');

    parts.push('');
    parts.push('<instructions>');
    parts.push(
      '  Based on the message content, channel context, thread replies, and current properties,',
    );
    parts.push('  generate appropriate values for the specified fields.');
    parts.push(
      '  - Mark fields that do not need changes as unchanged by setting unchanged=true',
    );
    parts.push(
      '  - For allow_new_options="false" fields, only use existing options; return null if no match',
    );
    parts.push('  - Only modify fields with ai_fill="true"');
    parts.push(
      '  - For multi_select and tags fields, return an array of strings',
    );
    parts.push('  - For number fields, return a numeric value');
    parts.push('  - For boolean fields, return true or false');
    parts.push('</instructions>');

    return parts.join('\n');
  }

  private buildToolInputSchema(
    definitions: PropertyDefinitionRow[],
  ): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const def of definitions) {
      required.push(def.key);

      // Each field is an object with either { value: ... } or { unchanged: true }
      const fieldSchema: Record<string, unknown> = {
        type: 'object',
        description: def.description ?? `Property: ${def.key}`,
        properties: {
          unchanged: {
            type: 'boolean',
            description: 'Set to true if the field should not be changed',
          },
          value: this.buildValueSchema(def),
        },
      };

      properties[def.key] = fieldSchema;
    }

    return {
      type: 'object',
      properties,
      required,
    };
  }

  private buildValueSchema(
    def: PropertyDefinitionRow,
  ): Record<string, unknown> {
    const config = def.config as SelectConfig | null;

    switch (def.valueType) {
      case 'text':
      case 'url':
        return { type: 'string' };

      case 'number':
        return { type: 'number' };

      case 'boolean':
        return { type: 'boolean' };

      case 'single_select': {
        const options = config?.options;
        if (options && options.length > 0 && !def.allowNewOptions) {
          return {
            type: 'string',
            enum: options.map((o) => o.value),
          };
        }
        return { type: 'string' };
      }

      case 'multi_select':
      case 'tags': {
        const options = config?.options;
        if (options && options.length > 0 && !def.allowNewOptions) {
          return {
            type: 'array',
            items: {
              type: 'string',
              enum: options.map((o) => o.value),
            },
          };
        }
        return {
          type: 'array',
          items: { type: 'string' },
        };
      }

      case 'person':
        return {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of user identifiers mentioned or relevant',
        };

      default:
        return { type: 'string' };
    }
  }

  private async callAI(
    tenantId: string,
    xmlPrompt: string,
    inputSchema: Record<string, unknown>,
    _definitions: PropertyDefinitionRow[],
    previousError: string | null,
  ): Promise<AutoFillResult> {
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: xmlPrompt },
    ];

    if (previousError) {
      messages.push({
        role: 'assistant',
        content: `I attempted to fill the properties but encountered validation errors: ${previousError}. Let me try again with corrected values.`,
      });
      messages.push({
        role: 'user',
        content:
          'Please try again with corrected values. Make sure to follow the schema constraints exactly.',
      });
    }

    const llm = await this.platformLlmService.createProvider(tenantId);

    const result = await generateText({
      model: llm(`anthropic/${AUTO_FILL_MODEL}`),
      system:
        'You are a property extraction assistant. Analyze the message content and context to generate appropriate property values. Always use the set_message_properties tool to return your results.',
      messages,
      tools: {
        set_message_properties: defineTool({
          description:
            'Set property values for the message based on its content and context',
          inputSchema: jsonSchema(inputSchema),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'set_message_properties' },
      temperature: 0.3,
      maxOutputTokens: 2048,
    });

    const toolCall = result.toolCalls[0];

    if (!toolCall) {
      throw new Error('AI did not return a tool call');
    }

    return toolCall.input as AutoFillResult;
  }

  private validateResult(
    result: AutoFillResult,
    definitions: PropertyDefinitionRow[],
  ): {
    valid: Array<{ key: string; value: unknown }>;
    invalid: Array<{ key: string; reason: string }>;
  } {
    const valid: Array<{ key: string; value: unknown }> = [];
    const invalid: Array<{ key: string; reason: string }> = [];

    for (const def of definitions) {
      const entry = result[def.key];

      // If not present or marked unchanged, skip
      if (!entry || ('unchanged' in entry && entry.unchanged)) {
        continue;
      }

      if (!('value' in entry) || entry.value === undefined) {
        continue;
      }

      const { value } = entry;

      // Allow null values (AI decided field doesn't apply)
      if (value === null) {
        continue;
      }

      const error = this.validateFieldValue(def, value);
      if (error) {
        invalid.push({ key: def.key, reason: error });
      } else {
        valid.push({ key: def.key, value });
      }
    }

    return { valid, invalid };
  }

  private validateFieldValue(
    def: PropertyDefinitionRow,
    value: unknown,
  ): string | null {
    const config = def.config as SelectConfig | null;

    switch (def.valueType) {
      case 'text':
      case 'url':
        if (typeof value !== 'string') {
          return `Expected string for ${def.valueType}, got ${typeof value}`;
        }
        return null;

      case 'number':
        if (typeof value !== 'number') {
          return `Expected number, got ${typeof value}`;
        }
        return null;

      case 'boolean':
        if (typeof value !== 'boolean') {
          return `Expected boolean, got ${typeof value}`;
        }
        return null;

      case 'single_select': {
        if (typeof value !== 'string') {
          return `Expected string for single_select, got ${typeof value}`;
        }
        const options = config?.options;
        if (options && !def.allowNewOptions) {
          const validValues = new Set(options.map((o) => o.value));
          if (!validValues.has(value)) {
            return `Value "${value}" is not in allowed options: ${[...validValues].join(', ')}`;
          }
        }
        return null;
      }

      case 'multi_select':
      case 'tags': {
        if (!Array.isArray(value)) {
          return `Expected array for ${def.valueType}, got ${typeof value}`;
        }
        if (!value.every((v) => typeof v === 'string')) {
          return `All items in ${def.valueType} array must be strings`;
        }
        const options = config?.options;
        if (options && !def.allowNewOptions) {
          const validValues = new Set(options.map((o) => o.value));
          const invalidItems = value.filter((v) => !validValues.has(v));
          if (invalidItems.length > 0) {
            return `Values not in allowed options: ${invalidItems.join(', ')}`;
          }
        }
        return null;
      }

      case 'person': {
        if (!Array.isArray(value)) {
          return `Expected array for person, got ${typeof value}`;
        }
        if (!value.every((v) => typeof v === 'string')) {
          return 'All items in person array must be strings';
        }
        return null;
      }

      default:
        return null;
    }
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
