import { createFileRoute } from "@tanstack/react-router";
import { AccountSettingsContent } from "@/components/layout/contents/AccountSettingsContent";

export const Route = createFileRoute("/_authenticated/profile" as never)({
  component: ProfilePage,
});

function ProfilePage() {
  return <AccountSettingsContent />;
}
