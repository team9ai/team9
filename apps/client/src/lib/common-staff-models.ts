export type StaffModelFamily = "anthropic" | "openai" | "google" | "other";

export interface StaffModel {
  provider: string;
  id: string;
  label: string;
  family: StaffModelFamily;
  default?: boolean;
}

export function getDefaultStaffModel(models: StaffModel[]): StaffModel {
  const value = models.find((model) => model.default);
  if (!value) throw new Error("Server catalog has no default model");
  return value;
}

export function findStaffModel(
  models: StaffModel[],
  model: { provider: string; id: string } | null | undefined,
): StaffModel | null {
  if (!model) return null;
  return (
    models.find(
      (candidate) =>
        candidate.provider === model.provider && candidate.id === model.id,
    ) ?? null
  );
}

export function formatStaffModelDisplayLabel(label: string) {
  return label.replace(/\s*\(Preview\)/g, "").replace(/\s+Preview$/, "");
}
