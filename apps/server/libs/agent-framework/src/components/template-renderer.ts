/**
 * Template Renderer
 * Supports simple variable interpolation for component content
 *
 * Syntax:
 * - ${variable} - Simple variable
 * - ${nested.path} - Nested path access
 * - ${helper(arg)} - Helper function call
 * - ${helper(arg1, arg2)} - Helper with multiple arguments
 */

/**
 * Template helper function type
 */
export type TemplateHelper = (...args: unknown[]) => string;

/**
 * Template context with variables and helpers
 */
export interface TemplateContext {
  /** Variables for interpolation */
  variables: Record<string, unknown>;
  /** Helper functions */
  helpers?: Record<string, TemplateHelper>;
}

/**
 * Built-in helper functions
 */
const builtinHelpers: Record<string, TemplateHelper> = {
  /**
   * Format a date value
   * Usage: ${formatDate(timestamp)} or ${formatDate(timestamp, 'locale')}
   */
  formatDate: (value: unknown, locale?: unknown): string => {
    if (value === undefined || value === null) return '';
    const date =
      typeof value === 'number' ? new Date(value) : new Date(String(value));
    if (isNaN(date.getTime())) return String(value);
    const localeStr = typeof locale === 'string' ? locale : 'en-US';
    return date.toLocaleString(localeStr);
  },

  /**
   * Format a list as bullet points or comma-separated
   * Usage: ${formatList(items)} or ${formatList(items, 'bullet')}
   */
  formatList: (items: unknown, format?: unknown): string => {
    if (!Array.isArray(items)) return String(items ?? '');
    const formatType = typeof format === 'string' ? format : 'comma';

    switch (formatType) {
      case 'bullet':
        return items.map((item) => `• ${item}`).join('\n');
      case 'numbered':
        return items.map((item, i) => `${i + 1}. ${item}`).join('\n');
      case 'newline':
        return items.join('\n');
      case 'comma':
      default:
        return items.join(', ');
    }
  },

  /**
   * Convert value to JSON string
   * Usage: ${json(value)} or ${json(value, indent)}
   */
  json: (value: unknown, indent?: unknown): string => {
    const indentNum = typeof indent === 'number' ? indent : 2;
    try {
      return JSON.stringify(value, null, indentNum);
    } catch {
      return String(value);
    }
  },

  /**
   * Truncate text to max length
   * Usage: ${truncate(text, maxLength)}
   */
  truncate: (text: unknown, maxLength?: unknown): string => {
    const str = String(text ?? '');
    const max = typeof maxLength === 'number' ? maxLength : 100;
    if (str.length <= max) return str;
    return str.slice(0, max - 3) + '...';
  },

  /**
   * Convert to uppercase
   * Usage: ${upper(text)}
   */
  upper: (text: unknown): string => {
    return String(text ?? '').toUpperCase();
  },

  /**
   * Convert to lowercase
   * Usage: ${lower(text)}
   */
  lower: (text: unknown): string => {
    return String(text ?? '').toLowerCase();
  },

  /**
   * Default value if null/undefined
   * Usage: ${default(value, 'fallback')}
   */
  default: (value: unknown, fallback: unknown): string => {
    if (value === undefined || value === null || value === '') {
      return String(fallback ?? '');
    }
    return String(value);
  },

  /**
   * Count items in array or characters in string
   * Usage: ${count(items)}
   */
  count: (value: unknown): string => {
    if (Array.isArray(value)) return String(value.length);
    if (typeof value === 'string') return String(value.length);
    if (typeof value === 'object' && value !== null) {
      return String(Object.keys(value).length);
    }
    return '0';
  },

  /**
   * Conditional rendering
   * Usage: ${if(condition, trueValue, falseValue)}
   */
  if: (
    condition: unknown,
    trueValue: unknown,
    falseValue?: unknown,
  ): string => {
    return condition ? String(trueValue ?? '') : String(falseValue ?? '');
  },
};

/**
 * Get value from nested path
 * @param obj - Object to access
 * @param path - Dot-separated path (e.g., 'user.name')
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Parse a helper call expression
 * @param expression - Expression like "helper(arg1, arg2)"
 * @returns Parsed helper name and arguments, or null if not a helper call
 */
function parseHelperCall(
  expression: string,
): { name: string; args: string[] } | null {
  const match = expression.match(/^(\w+)\((.*)\)$/);
  if (!match) return null;

  const name = match[1];
  const argsStr = match[2].trim();

  if (!argsStr) {
    return { name, args: [] };
  }

  // Simple argument parsing (handles strings with quotes and basic values)
  const args: string[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';
  let depth = 0;

  for (let i = 0; i < argsStr.length; i++) {
    const char = argsStr[i];

    if (!inString) {
      if (char === '"' || char === "'") {
        inString = true;
        stringChar = char;
        current += char;
      } else if (char === '(') {
        depth++;
        current += char;
      } else if (char === ')') {
        depth--;
        current += char;
      } else if (char === ',' && depth === 0) {
        args.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    } else {
      current += char;
      if (char === stringChar && argsStr[i - 1] !== '\\') {
        inString = false;
      }
    }
  }

  if (current.trim()) {
    args.push(current.trim());
  }

  return { name, args };
}

/**
 * Evaluate an argument value
 * @param arg - Argument string
 * @param context - Template context
 */
function evaluateArg(arg: string, context: TemplateContext): unknown {
  // String literal
  if (
    (arg.startsWith('"') && arg.endsWith('"')) ||
    (arg.startsWith("'") && arg.endsWith("'"))
  ) {
    return arg.slice(1, -1);
  }

  // Number literal
  const num = Number(arg);
  if (!isNaN(num)) {
    return num;
  }

  // Boolean literal
  if (arg === 'true') return true;
  if (arg === 'false') return false;
  if (arg === 'null') return null;
  if (arg === 'undefined') return undefined;

  // Variable reference
  return getNestedValue(context.variables, arg);
}

/**
 * Render a single expression
 * @param expression - Expression inside ${}
 * @param context - Template context
 */
function renderExpression(
  expression: string,
  context: TemplateContext,
): string {
  const trimmed = expression.trim();

  // Check if it's a helper call
  const helperCall = parseHelperCall(trimmed);
  if (helperCall) {
    // Try custom helpers first, then builtins
    const helper =
      context.helpers?.[helperCall.name] ?? builtinHelpers[helperCall.name];

    if (helper) {
      const args = helperCall.args.map((arg) => evaluateArg(arg, context));
      return helper(...args);
    }
    // Unknown helper - treat as variable
  }

  // Simple variable or nested path
  const value = getNestedValue(context.variables, trimmed);

  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

/**
 * Render a template string with variable interpolation
 * @param template - Template string with ${...} placeholders
 * @param context - Template context with variables and optional helpers
 * @returns Rendered string
 */
export function renderTemplate(
  template: string,
  context: TemplateContext,
): string {
  // Match ${...} patterns, handling nested braces
  const result: string[] = [];
  let lastIndex = 0;
  let i = 0;

  while (i < template.length) {
    // Find ${ start
    if (template[i] === '$' && template[i + 1] === '{') {
      // Add text before this expression
      if (i > lastIndex) {
        result.push(template.slice(lastIndex, i));
      }

      // Find matching }
      let depth = 1;
      let j = i + 2;
      while (j < template.length && depth > 0) {
        if (template[j] === '{') depth++;
        else if (template[j] === '}') depth--;
        j++;
      }

      if (depth === 0) {
        const expression = template.slice(i + 2, j - 1);
        result.push(renderExpression(expression, context));
        lastIndex = j;
        i = j;
      } else {
        // Unmatched brace - treat as literal
        result.push('${');
        lastIndex = i + 2;
        i += 2;
      }
    } else {
      i++;
    }
  }

  // Add remaining text
  if (lastIndex < template.length) {
    result.push(template.slice(lastIndex));
  }

  return result.join('');
}

/**
 * Create a template renderer with pre-configured helpers
 */
export function createTemplateRenderer(
  customHelpers?: Record<string, TemplateHelper>,
) {
  const helpers = { ...builtinHelpers, ...customHelpers };

  return {
    /**
     * Render a template with the given variables
     */
    render(template: string, variables: Record<string, unknown>): string {
      return renderTemplate(template, { variables, helpers });
    },

    /**
     * Register a custom helper
     */
    registerHelper(name: string, helper: TemplateHelper): void {
      helpers[name] = helper;
    },

    /**
     * Get all available helpers
     */
    getHelpers(): Record<string, TemplateHelper> {
      return { ...helpers };
    },
  };
}

/**
 * Check if a string contains template expressions
 */
export function hasTemplateExpressions(text: string): boolean {
  return /\$\{[^}]+\}/.test(text);
}
