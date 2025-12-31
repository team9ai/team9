import { createFileRoute } from "@tanstack/react-router";
import { HomeMainContent } from "@/components/layout/contents/HomeMainContent";

export const Route = createFileRoute("/_authenticated/")({
  component: HomePage,
});

function HomePage() {
  return <HomeMainContent />;
}
