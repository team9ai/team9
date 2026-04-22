import { invoke } from "@tauri-apps/api/core";

import type {
  DaemonStatus,
  IdentityDto,
  StartConfig,
  StartResult,
} from "@/types/tauri-ahand";

export const ahandTauri = {
  getIdentity: (team9UserId: string) =>
    invoke<IdentityDto>("ahand_get_identity", { team9UserId }),
  start: (cfg: StartConfig) => invoke<StartResult>("ahand_start", { cfg }),
  stop: () => invoke<void>("ahand_stop"),
  status: () => invoke<DaemonStatus>("ahand_status"),
};
