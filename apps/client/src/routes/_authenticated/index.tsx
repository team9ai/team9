import { createFileRoute, redirect } from "@tanstack/react-router";
import { HOME_ENTRY_PATH } from "@/stores";

export const Route = createFileRoute("/_authenticated/")({
  beforeLoad: () => {
    throw redirect({ to: HOME_ENTRY_PATH });
  },
});
