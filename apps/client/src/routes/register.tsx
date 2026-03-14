import { createFileRoute, redirect } from "@tanstack/react-router";

// Registration is now handled by the unified /login page.
// This route redirects for backward compatibility with old bookmarks and links.

type RegisterSearch = {
  redirect?: string;
  invite?: string;
};

export const Route = createFileRoute("/register")({
  validateSearch: (search: Record<string, unknown>): RegisterSearch => {
    return {
      redirect: (search.redirect as string) || undefined,
      invite: (search.invite as string) || undefined,
    };
  },
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/login", search });
  },
  component: () => null,
});
