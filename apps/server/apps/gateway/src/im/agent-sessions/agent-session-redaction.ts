import type { HiveSessionComponentsResponse } from '@team9/claw-hive';
import type { SafeSessionComponentsResponse } from './agent-session.types.js';

const SENSITIVE_KEY_PATTERN =
  /(^|[_-])(token|secret|password|apikey|api_key|authorization|credential)([_-]|$)/i;

const ALLOWED_EVENT_TYPES = new Set([
  'agent_start',
  'agent_end',
  'run_start',
  'run_end',
  'worker_release',
  'component_data_snapshot',
  'model_change',
  'thinking_level_change',
  'a2ui_surface_update',
  'a2ui_surface_delete',
]);

export function redactSensitiveValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key)
        ? '[redacted]'
        : redactSensitiveValue(item),
    ]),
  );
}

export function projectSafeComponents(
  response: HiveSessionComponentsResponse,
): SafeSessionComponentsResponse {
  return {
    sessionId: response.sessionId,
    components: response.components.map((component) => ({
      id: component.id,
      typeKey: component.typeKey,
      ...(component.priority !== undefined && { priority: component.priority }),
      runtimeInjectedOnly: component.runtimeInjectedOnly,
      ...(component.schema !== undefined && { schema: component.schema }),
      latestData: component.latestData
        ? {
            ...component.latestData,
            data: redactSensitiveValue(component.latestData.data) as Record<
              string,
              unknown
            >,
          }
        : null,
    })),
  };
}

export function filterAgentSessionEvent(
  event: Record<string, unknown>,
): Record<string, unknown> | null {
  const type = typeof event.type === 'string' ? event.type : null;
  if (!type || !ALLOWED_EVENT_TYPES.has(type)) return null;

  if (type !== 'component_data_snapshot') return event;

  const components = Array.isArray(event.components)
    ? event.components.map((component) => {
        const row = component as Record<string, unknown>;
        return {
          ...row,
          data: redactSensitiveValue(row.data) as Record<string, unknown>,
        };
      })
    : [];

  return { ...event, components };
}
