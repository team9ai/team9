/**
 * Mock for @paralleldrive/cuid2
 * Provides a simple unique ID generator for testing
 */

let counter = 0;

export function createId(): string {
  counter++;
  return `mock_${Date.now()}_${counter}_${Math.random().toString(36).slice(2, 11)}`;
}

export function init(): typeof createId {
  return createId;
}

export function isCuid(id: string): boolean {
  return typeof id === 'string' && id.length > 0;
}

export function getConstants() {
  return {
    bigLength: 32,
    defaultLength: 24,
  };
}
