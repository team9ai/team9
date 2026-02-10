export {
  getConfigTabs,
  registerConfigTabs,
  type AppConfigPanelProps,
  type ConfigTabDefinition,
} from "./registry";

// Register all config panels
import {
  OpenClawInstanceTab,
  OpenClawBotsTab,
  OpenClawDevicesTab,
} from "./OpenClawConfigPanel";
import { registerConfigTabs } from "./registry";

registerConfigTabs("openclaw", [
  { value: "instance", label: "Instance", Component: OpenClawInstanceTab },
  { value: "bots", label: "Bots", Component: OpenClawBotsTab },
  { value: "devices", label: "Devices", Component: OpenClawDevicesTab },
]);
