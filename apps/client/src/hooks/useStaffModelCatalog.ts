import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { api } from "@/services/api";
import {
  getDefaultStaffModel,
  type StaffModel,
} from "@/lib/common-staff-models";
import type { StaffModelCatalogResponse } from "@/services/api/applications";

export const STAFF_MODEL_CATALOG_QUERY_KEY = ["staff-model-catalog"] as const;

export function staffModelCatalogVersionQueryKey(
  catalog: Pick<StaffModelCatalogResponse, "catalogVersion" | "etag">,
) {
  return [
    ...STAFF_MODEL_CATALOG_QUERY_KEY,
    catalog.catalogVersion,
    catalog.etag ?? null,
  ] as const;
}

export function invalidateStaffModelCatalog(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    queryKey: STAFF_MODEL_CATALOG_QUERY_KEY,
  });
}

export function useStaffModelCatalog() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: STAFF_MODEL_CATALOG_QUERY_KEY,
    queryFn: async () => {
      const catalog = await api.applications.getStaffModelCatalog();
      queryClient.setQueryData(
        staffModelCatalogVersionQueryKey(catalog),
        catalog,
      );
      return catalog;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  const models: StaffModel[] =
    query.data?.models.filter((model) => model.enabled) ?? [];
  let defaultModel: StaffModel | null = null;
  if (models.length > 0) {
    try {
      defaultModel = getDefaultStaffModel(models);
    } catch {
      defaultModel = null;
    }
  }
  const runtimeReady = query.data?.runtimeReady === true;

  return {
    ...query,
    catalog: query.data ?? null,
    models,
    defaultModel,
    runtimeReady,
    canMutate: query.isSuccess && runtimeReady && defaultModel !== null,
    invalidate: () => invalidateStaffModelCatalog(queryClient),
  };
}
