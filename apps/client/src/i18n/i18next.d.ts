import "i18next";
import { resources } from "./index";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: (typeof resources)["zh"];
  }
}
