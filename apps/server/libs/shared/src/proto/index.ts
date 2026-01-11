import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Get the directory of this module (ESM compatible)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Absolute path to message-service.proto
 * Used by IM-Worker (server) and Gateway (client) for gRPC communication
 */
export const MESSAGE_SERVICE_PROTO_PATH = join(
  __dirname,
  'message-service.proto',
);

/**
 * Absolute path to ai-service.proto
 */
export const AI_SERVICE_PROTO_PATH = join(__dirname, 'ai-service.proto');
