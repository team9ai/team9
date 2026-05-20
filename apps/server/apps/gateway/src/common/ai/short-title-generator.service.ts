import { Injectable, Logger, Optional } from '@nestjs/common';
import { CapabilityHubClient } from '../../capability-hub/capability-hub.client.js';

export interface ShortTitleIdentity {
  userId: string;
  tenantId: string;
}

const SHORT_TITLE_PROMPT = `You are a concise title generator for a chat app's sidebar.

Given the user's first message in a conversation, produce a short title that summarises the topic.

Rules (ALL mandatory):
- Match the language of the input exactly (if the user wrote in Chinese, reply in Chinese; Japanese → Japanese; etc.).
- Max 12 characters for CJK scripts, OR max 6 words for Latin scripts. Keep it very short.
- No quotes, no trailing punctuation, no numbering, no prefix like "Title:".
- Output the title only. No explanations.`;

@Injectable()
export class ShortTitleGeneratorService {
  private readonly logger = new Logger(ShortTitleGeneratorService.name);

  constructor(@Optional() private readonly hub?: CapabilityHubClient) {}

  async generate(
    seed: string,
    identity: ShortTitleIdentity,
  ): Promise<string | null> {
    if (!this.hub) return null;

    let response: Response;
    try {
      response = await this.hub.request(
        'POST',
        '/api/proxy/openrouter/chat/completions',
        {
          headers: {
            ...this.hub.serviceHeaders(identity),
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'openai/gpt-4o-mini',
            max_tokens: 40,
            temperature: 0.3,
            messages: [
              { role: 'system', content: SHORT_TITLE_PROMPT },
              { role: 'user', content: seed },
            ],
          }),
        },
      );
    } catch (err) {
      this.logger.warn(`capability-hub fetch failed: ${err}`);
      return null;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.warn(
        `capability-hub llm-proxy returned ${response.status}: ${body.slice(0, 200)}`,
      );
      return null;
    }

    let data: {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    try {
      data = (await response.json()) as typeof data;
    } catch (err) {
      this.logger.warn(`capability-hub response not JSON: ${err}`);
      return null;
    }

    const raw = (data.choices?.[0]?.message?.content ?? '').trim();
    if (!raw) return null;

    const cleaned = raw
      .replace(/^[`'"“”‘’「『《]+|[`'"“”‘’」』》]+$/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[。！？!?.]+$/u, '')
      .trim();

    if (!cleaned) return null;
    return cleaned.length > 40 ? cleaned.slice(0, 40) : cleaned;
  }
}
