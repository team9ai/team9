import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { WS_EVENTS } from '../../im/websocket/events/events.constants.js';
import { ConnectionService } from './connection.service.js';

describe('ConnectionService', () => {
  let redisService: Record<string, never>;
  let messagesService: {
    getMessageWithDetails: jest.Mock;
  };
  let service: ConnectionService;
  let roomEmitter: {
    emit: jest.Mock;
  };
  let server: {
    to: jest.Mock;
    sockets: {
      sockets: Map<string, { emit: jest.Mock }>;
    };
  };

  beforeEach(() => {
    redisService = {};
    messagesService = {
      getMessageWithDetails: jest.fn(),
    };
    service = new ConnectionService(
      redisService as never,
      messagesService as never,
    );
    roomEmitter = {
      emit: jest.fn(),
    };
    server = {
      to: jest.fn(() => roomEmitter),
      sockets: {
        sockets: new Map(),
      },
    };
  });

  it('tracks local connections and reverses them by user', () => {
    service.registerConnection('socket-1', 'user-1');
    service.registerConnection('socket-2', 'user-1');

    expect(service.getUserBySocket('socket-1')).toBe('user-1');
    expect(service.getLocalUserSockets('user-1')).toEqual([
      'socket-1',
      'socket-2',
    ]);
    expect(service.hasLocalConnection('user-1')).toBe(true);
    expect(service.getConnectionCount()).toBe(2);

    expect(service.unregisterConnection('socket-1')).toBe('user-1');
    expect(service.getLocalUserSockets('user-1')).toEqual(['socket-2']);
    expect(service.unregisterConnection('socket-2')).toBe('user-1');
    expect(service.hasLocalConnection('user-1')).toBe(false);
    expect(service.unregisterConnection('missing')).toBeUndefined();
  });

  it('sends to a single socket or all sockets of a user when the server is set', () => {
    const socket = { emit: jest.fn() };
    server.sockets.sockets.set('socket-1', socket);
    service.setServer(server as never);
    service.registerConnection('socket-1', 'user-1');
    service.registerConnection('socket-2', 'user-1');

    expect(service.sendToSocket('socket-1', 'event', { ok: true })).toBe(true);
    expect(service.sendToSocket('missing', 'event', { ok: true })).toBe(false);
    expect(service.sendToUser('user-1', 'event', { ok: true })).toBe(1);

    expect(socket.emit).toHaveBeenCalledWith('event', { ok: true });
  });

  it('returns false or does nothing when server is not available', () => {
    expect(service.sendToSocket('socket-1', 'event', {})).toBe(false);
    expect(() => service.broadcastToRoom('room-1', 'event', {})).not.toThrow();
  });

  it('delivers downstream messages with fetched message details and falls back on fetch errors', async () => {
    service.setServer(server as never);
    messagesService.getMessageWithDetails
      .mockResolvedValueOnce({ id: 'msg-1', content: 'full' })
      .mockRejectedValueOnce(new Error('lookup failed'));

    await service.handleDownstreamMessage({
      msgId: 'msg-1',
      seqId: 7n,
      senderId: 'user-1',
      targetType: 'channel',
      targetId: 'channel-1',
      targetUserIds: ['user-1', 'user-2'],
      type: 'text',
      payload: { content: 'fallback' },
      timestamp: 123,
    });

    await service.handleDownstreamMessage({
      msgId: 'msg-2',
      seqId: '8',
      senderId: 'user-1',
      targetType: 'channel',
      targetId: 'channel-1',
      targetUserIds: ['user-3'],
      type: 'text',
      payload: { content: 'fallback' },
      timestamp: 456,
    });

    expect(server.to).toHaveBeenNthCalledWith(1, 'user:user-1');
    expect(roomEmitter.emit).toHaveBeenNthCalledWith(1, WS_EVENTS.MESSAGE.NEW, {
      id: 'msg-1',
      content: 'full',
    });
    expect(roomEmitter.emit).toHaveBeenNthCalledWith(3, WS_EVENTS.MESSAGE.NEW, {
      msgId: 'msg-2',
      seqId: '8',
      senderId: 'user-1',
      targetType: 'channel',
      targetId: 'channel-1',
      type: 'text',
      payload: { content: 'fallback' },
      timestamp: 456,
    });
  });

  it('skips downstream delivery when the server has not been set', async () => {
    await expect(
      service.handleDownstreamMessage({
        msgId: 'msg-1',
        senderId: 'user-1',
        targetType: 'channel',
        targetId: 'channel-1',
        targetUserIds: ['user-1'],
        type: 'text',
        payload: {},
        timestamp: 123,
      }),
    ).resolves.toBeUndefined();

    expect(messagesService.getMessageWithDetails).not.toHaveBeenCalled();
  });
});
