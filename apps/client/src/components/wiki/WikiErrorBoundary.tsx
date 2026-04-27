import { Component, type ErrorInfo, type ReactNode } from "react";
import i18n from "@/i18n";

interface WikiErrorBoundaryProps {
  children: ReactNode;
}

interface WikiErrorBoundaryState {
  hasError: boolean;
}

/**
 * Simple class-based React ErrorBoundary for the wiki surface.
 *
 * Catches render / lifecycle errors thrown anywhere in the wiki component
 * tree below it and renders a generic "Something went wrong" fallback with
 * a reload button. We use a bespoke component (rather than `Sentry.ErrorBoundary`)
 * because the wiki section is itself already inside the app-level Sentry
 * boundary — we want a *scoped* fallback that only dims the wiki pane, not
 * the entire app.
 *
 * Error reporting is intentionally minimal: we log to the console so
 * developers see the stack in dev, but we do not re-report to Sentry to
 * avoid double-reporting (Sentry's global handler still catches anything
 * we re-throw via the reload action).
 */
export class WikiErrorBoundary extends Component<
  WikiErrorBoundaryProps,
  WikiErrorBoundaryState
> {
  constructor(props: WikiErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): WikiErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("[WikiErrorBoundary] caught error:", error, info);
  }

  private handleReload = () => {
    // Simple recovery — clear the error flag and re-render. If the underlying
    // problem is transient (stale query cache, race) this usually re-mounts
    // the subtree cleanly. For persistent errors the user can reload the app.
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          data-testid="wiki-error-boundary-fallback"
          className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center"
        >
          <p className="text-sm text-muted-foreground">
            {i18n.t("wiki:errors.boundaryMessage")}
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            data-testid="wiki-error-boundary-retry"
            className="rounded border border-border px-3 py-1 text-xs hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {i18n.t("wiki:errors.boundaryRetry")}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
