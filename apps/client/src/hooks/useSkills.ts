import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import type {
  CreateSkillDto,
  UpdateSkillDto,
  CreateVersionDto,
  SkillType,
} from "@/types/skill";

// ── Query Hooks ─────────────────────────────────────────────────────

export function useSkills(type?: SkillType) {
  return useQuery({
    queryKey: ["skills", { type }],
    queryFn: () => api.skills.list(type ? { type } : undefined),
  });
}

export function useSkill(id: string | undefined) {
  return useQuery({
    queryKey: ["skills", id],
    queryFn: () => api.skills.getById(id!),
    enabled: !!id,
  });
}

export function useSkillVersions(id: string | undefined) {
  return useQuery({
    queryKey: ["skills", id, "versions"],
    queryFn: () => api.skills.listVersions(id!),
    enabled: !!id,
  });
}

export function useSkillVersion(
  id: string | undefined,
  version: number | undefined,
) {
  return useQuery({
    queryKey: ["skills", id, "versions", version],
    queryFn: () => api.skills.getVersion(id!, version!),
    enabled: !!id && version != null,
  });
}

// ── Mutation Hooks ──────────────────────────────────────────────────

export function useCreateSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateSkillDto) => api.skills.create(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useUpdateSkill(skillId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateSkillDto) => api.skills.update(skillId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills", skillId] });
      queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useDeleteSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.skills.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useCreateSkillVersion(skillId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateVersionDto) =>
      api.skills.createVersion(skillId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills", skillId] });
      queryClient.invalidateQueries({
        queryKey: ["skills", skillId, "versions"],
      });
    },
  });
}

export function useReviewSkillVersion(skillId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      version,
      action,
    }: {
      version: number;
      action: "approve" | "reject";
    }) => api.skills.reviewVersion(skillId, version, { action }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills", skillId] });
      queryClient.invalidateQueries({
        queryKey: ["skills", skillId, "versions"],
      });
    },
  });
}
