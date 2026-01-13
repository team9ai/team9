/**
 * Response Parser
 *
 * Parses LLM responses into BaseEvents.
 */

import type { LLMCompletionResponse } from '../llm/llm.types.js';
import type { BaseEvent } from '../types/event.types.js';
import { EventType } from '../types/event.types.js';

/**
 * Parse LLM response to determine the appropriate event types
 * Returns an array of events since LLM can return both text and tool calls simultaneously
 */
export function parseResponseToEvents(
  response: LLMCompletionResponse,
): BaseEvent[] {
  const events: BaseEvent[] = [];
  const timestamp = Date.now();

  // First, add text response event if there's content
  if (response.content && response.content.trim()) {
    events.push({
      type: EventType.LLM_TEXT_RESPONSE,
      content: response.content,
      timestamp,
    });
  }

  // Then, add tool call events for each tool call
  if (response.toolCalls && response.toolCalls.length > 0) {
    for (const toolCall of response.toolCalls) {
      console.log(
        '[ResponseParser] Tool call detected:',
        toolCall.name,
        toolCall.arguments,
      );
      events.push({
        type: EventType.LLM_TOOL_CALL,
        toolName: toolCall.name,
        callId: toolCall.id,
        arguments: toolCall.arguments,
        timestamp,
      });
    }
  }

  // If no events were created (empty response), create an empty text response
  if (events.length === 0) {
    events.push({
      type: EventType.LLM_TEXT_RESPONSE,
      content: '',
      timestamp,
    });
  }

  return events;
}
