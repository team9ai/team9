import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';

describe('DocumentsController', () => {
  let controller: DocumentsController;
  let mockService: Record<string, jest.Mock<any>>;

  beforeEach(async () => {
    mockService = {
      list: jest.fn<any>(),
      create: jest.fn<any>(),
      getById: jest.fn<any>(),
      update: jest.fn<any>(),
      updatePrivileges: jest.fn<any>(),
      getVersions: jest.fn<any>(),
      getVersion: jest.fn<any>(),
      submitSuggestion: jest.fn<any>(),
      getSuggestions: jest.fn<any>(),
      getSuggestionWithDiff: jest.fn<any>(),
      reviewSuggestion: jest.fn<any>(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentsController],
      providers: [{ provide: DocumentsService, useValue: mockService }],
    }).compile();

    controller = module.get<DocumentsController>(DocumentsController);
  });

  // ────────────────────────────────────────────────────────────────
  // list endpoint
  // ────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('should delegate to service.list with tenantId', async () => {
      const docs = [{ id: 'doc-1', title: 'Test' }];
      mockService.list.mockResolvedValue(docs);

      const result = await controller.list('tenant-1');

      expect(mockService.list).toHaveBeenCalledWith('tenant-1');
      expect(result).toEqual(docs);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // getCallerIdentity — bot vs user detection
  // ────────────────────────────────────────────────────────────────

  describe('getCallerIdentity (via create endpoint)', () => {
    it('should identify human user from regular JWT Bearer token', async () => {
      mockService.create.mockResolvedValue({ id: 'doc-1' });

      const req = { headers: { authorization: 'Bearer eyJhbGciOiJIUzI1...' } };
      await controller.create(
        { documentType: 'task_instruction', content: 'hello' } as any,
        'user-alice',
        'tenant-1',
        req,
      );

      expect(mockService.create).toHaveBeenCalledWith(
        expect.anything(),
        { type: 'user', id: 'user-alice' },
        'tenant-1',
      );
    });

    it('should identify bot from t9bot_ prefixed Bearer token', async () => {
      mockService.create.mockResolvedValue({ id: 'doc-1' });

      const req = {
        headers: { authorization: 'Bearer t9bot_abc123def456' },
      };
      await controller.create(
        { documentType: 'task_instruction', content: 'hello' } as any,
        'bot-claw',
        'tenant-1',
        req,
      );

      expect(mockService.create).toHaveBeenCalledWith(
        expect.anything(),
        { type: 'bot', id: 'bot-claw' },
        'tenant-1',
      );
    });

    it('should default to user when no authorization header', async () => {
      mockService.create.mockResolvedValue({ id: 'doc-1' });

      const req = { headers: {} };
      await controller.create(
        { documentType: 'task_instruction', content: 'hello' } as any,
        'user-alice',
        'tenant-1',
        req,
      );

      expect(mockService.create).toHaveBeenCalledWith(
        expect.anything(),
        { type: 'user', id: 'user-alice' },
        'tenant-1',
      );
    });

    it('should default to user when headers is undefined', async () => {
      mockService.create.mockResolvedValue({ id: 'doc-1' });

      const req = {};
      await controller.create(
        { documentType: 'task_instruction', content: 'hello' } as any,
        'user-alice',
        'tenant-1',
        req,
      );

      expect(mockService.create).toHaveBeenCalledWith(
        expect.anything(),
        { type: 'user', id: 'user-alice' },
        'tenant-1',
      );
    });
  });

  describe('getCallerIdentity (via update endpoint)', () => {
    it('should pass bot identity through to service.update', async () => {
      mockService.update.mockResolvedValue({ id: 'ver-2' });

      const req = {
        headers: { authorization: 'Bearer t9bot_xyz' },
      };
      await controller.update(
        'doc-1',
        { content: 'updated' } as any,
        'bot-claw',
        req,
      );

      expect(mockService.update).toHaveBeenCalledWith(
        'doc-1',
        expect.anything(),
        { type: 'bot', id: 'bot-claw' },
      );
    });

    it('should pass user identity through to service.update', async () => {
      mockService.update.mockResolvedValue({ id: 'ver-2' });

      const req = {
        headers: { authorization: 'Bearer eyJhbG...' },
      };
      await controller.update(
        'doc-1',
        { content: 'updated' } as any,
        'user-alice',
        req,
      );

      expect(mockService.update).toHaveBeenCalledWith(
        'doc-1',
        expect.anything(),
        { type: 'user', id: 'user-alice' },
      );
    });
  });

  describe('getCallerIdentity (via reviewSuggestion endpoint)', () => {
    it('should pass identity through to service.reviewSuggestion', async () => {
      mockService.reviewSuggestion.mockResolvedValue({ id: 'sug-1' });

      const req = {
        headers: { authorization: 'Bearer eyJhbG...' },
      };
      await controller.reviewSuggestion(
        'sug-1',
        { action: 'approve' } as any,
        'user-alice',
        req,
      );

      expect(mockService.reviewSuggestion).toHaveBeenCalledWith(
        'sug-1',
        'approve',
        { type: 'user', id: 'user-alice' },
      );
    });
  });
});
