export * from './interfaces/microservice-messages.interface.js';
export * from './interfaces/ai.interface.js';
export { env } from './env.js';

// gRPC proto file path (relative from project root)
export const AI_SERVICE_PROTO_PATH = 'libs/shared/src/proto/ai-service.proto';
