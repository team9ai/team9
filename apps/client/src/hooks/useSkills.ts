import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { CreateSkillDto, UpdateSkillDto, SkillType } from "@/types/skill";

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
