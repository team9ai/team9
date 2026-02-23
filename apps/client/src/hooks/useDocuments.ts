import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import type {
  CreateDocumentDto,
  UpdateDocumentDto,
  SubmitSuggestionDto,
  UpdatePrivilegesDto,
  DocumentSuggestionStatus,
} from "@/types/document";

// ── Query Hooks ─────────────────────────────────────────────────────

export function useDocuments() {
  return useQuery({
    queryKey: ["documents"],
    queryFn: () => api.documents.list(),
  });
}

export function useDocument(id: string | undefined) {
  return useQuery({
    queryKey: ["documents", id],
    queryFn: () => api.documents.getById(id!),
    enabled: !!id,
  });
}

export function useDocumentVersions(id: string | undefined) {
  return useQuery({
    queryKey: ["documents", id, "versions"],
    queryFn: () => api.documents.getVersions(id!),
    enabled: !!id,
  });
}

export function useDocumentVersion(
  id: string | undefined,
  versionIndex: number | undefined,
) {
  return useQuery({
    queryKey: ["documents", id, "versions", versionIndex],
    queryFn: () => api.documents.getVersion(id!, versionIndex!),
    enabled: !!id && versionIndex != null,
  });
}

export function useDocumentSuggestions(
  id: string | undefined,
  status?: DocumentSuggestionStatus,
) {
  return useQuery({
    queryKey: ["documents", id, "suggestions", { status }],
    queryFn: () => api.documents.getSuggestions(id!, status),
    enabled: !!id,
  });
}

export function useSuggestionDetail(
  docId: string | undefined,
  sugId: string | undefined,
) {
  return useQuery({
    queryKey: ["documents", docId, "suggestions", sugId],
    queryFn: () => api.documents.getSuggestionDetail(docId!, sugId!),
    enabled: !!docId && !!sugId,
  });
}

// ── Mutation Hooks ──────────────────────────────────────────────────

export function useCreateDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreateDocumentDto) => api.documents.create(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });
}

export function useUpdateDocument(docId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: UpdateDocumentDto) => api.documents.update(docId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents", docId] });
      queryClient.invalidateQueries({
        queryKey: ["documents", docId, "versions"],
      });
    },
  });
}

export function useUpdatePrivileges(docId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: UpdatePrivilegesDto) =>
      api.documents.updatePrivileges(docId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents", docId] });
    },
  });
}

export function useSubmitSuggestion(docId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: SubmitSuggestionDto) =>
      api.documents.submitSuggestion(docId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["documents", docId, "suggestions"],
      });
    },
  });
}

export function useReviewSuggestion(docId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      sugId,
      action,
    }: {
      sugId: string;
      action: "approve" | "reject";
    }) => api.documents.reviewSuggestion(docId, sugId, action),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["documents", docId, "suggestions"],
      });
      queryClient.invalidateQueries({ queryKey: ["documents", docId] });
      queryClient.invalidateQueries({
        queryKey: ["documents", docId, "versions"],
      });
    },
  });
}
