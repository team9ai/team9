import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockLog = jest.fn();
const mockUseLogger = jest.fn();
const mockConnectMicroservice = jest.fn();
const mockInit = jest.fn(async () => undefined);
const mockStartAllMicroservices = jest.fn(async () => undefined);
const mockCreate = jest.fn(async () => ({
  useLogger: mockUseLogger,
  connectMicroservice: mockConnectMicroservice,
  init: mockInit,
  startAllMicroservices: mockStartAllMicroservices,
}));
const MockLogger = jest.fn(() => ({ log: mockLog }));
const MockOtelLogger = jest.fn(() => ({ kind: 'otel-logger' }));

jest.unstable_mockModule('./instrument.js', () => ({}));
jest.unstable_mockModule('./otel.js', () => ({}));
jest.unstable_mockModule('@nestjs/core', () => ({
  NestFactory: {
    create: mockCreate,
  },
}));
jest.unstable_mockModule('@nestjs/common', () => ({
  Logger: MockLogger,
}));
jest.unstable_mockModule('@nestjs/microservices', () => ({
  Transport: {
    GRPC: 'GRPC',
  },
}));
jest.unstable_mockModule('@team9/shared', () => ({
  MESSAGE_SERVICE_PROTO_PATH: '/tmp/message.proto',
}));
jest.unstable_mockModule('./app.module.js', () => ({
  AppModule: class AppModule {},
}));
jest.unstable_mockModule('@team9/observability', () => ({
  OtelLogger: MockOtelLogger,
}));

async function importMainModule() {
  jest.resetModules();
  await import('./main.js');
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('main bootstrap', () => {
  const originalOtelEnabled = process.env.OTEL_ENABLED;
  const originalImWorkerPort = process.env.IM_WORKER_PORT;

  beforeEach(() => {
    jest.clearAllMocks();

    if (originalOtelEnabled === undefined) delete process.env.OTEL_ENABLED;
    else process.env.OTEL_ENABLED = originalOtelEnabled;

    if (originalImWorkerPort === undefined) delete process.env.IM_WORKER_PORT;
    else process.env.IM_WORKER_PORT = originalImWorkerPort;
  });

  it('boots the grpc worker with the default port when OTEL logger is disabled', async () => {
    delete process.env.OTEL_ENABLED;
    delete process.env.IM_WORKER_PORT;

    await importMainModule();

    expect(MockLogger).toHaveBeenCalledWith('ImWorkerService');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockConnectMicroservice).toHaveBeenCalledWith({
      transport: 'GRPC',
      options: {
        package: 'message',
        protoPath: '/tmp/message.proto',
        url: '[::]:3001',
        loader: {
          keepCase: true,
          longs: String,
          enums: String,
          defaults: true,
          oneofs: true,
        },
      },
    });
    expect(mockUseLogger).not.toHaveBeenCalled();
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockStartAllMicroservices).toHaveBeenCalledTimes(1);
    expect(mockLog).toHaveBeenCalledWith(
      'IM Worker Service gRPC is running on port 3001',
    );
  });

  it('switches to the OTEL logger and respects a custom grpc port', async () => {
    process.env.OTEL_ENABLED = 'true';
    process.env.IM_WORKER_PORT = '4312';

    await importMainModule();

    expect(MockOtelLogger).toHaveBeenCalledTimes(1);
    expect(mockUseLogger).toHaveBeenCalledWith({ kind: 'otel-logger' });
    expect(mockConnectMicroservice).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          url: '[::]:4312',
        }),
      }),
    );
    expect(mockLog).toHaveBeenCalledWith(
      'IM Worker Service gRPC is running on port 4312',
    );
  });
});
