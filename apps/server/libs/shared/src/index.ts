export * from './interfaces/microservice-messages.interface';
export * from './interfaces/ai.interface';
export { env } from './env';

// gRPC proto file path (relative from project root)
export const AI_SERVICE_PROTO_PATH = 'libs/shared/src/proto/ai-service.proto';
