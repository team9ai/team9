import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import wsService from "@/services/websocket";
import { useWikiStore, wikiActions } from "@/stores/useWikiStore";
import { wikiKeys } from "./useWikis";

/**
 * Payload shapes emitted by the folder9 webhook controller (see
 * `apps/server/apps/gateway/src/wikis/folder9-webhook.controller.ts`) and by
 * the team9 wiki CRUD endpoints. Kept as permissive partial shapes because
 * the server's `pick(...)` helper falls back to `undefined` when a field is
 * missing — handlers guard before dereferencing.
 */
interface WikiIdEvent {
  wikiId?: string;
}

interface WikiPageUpdatedEvent extends WikiIdEvent {
  ref?: string;
  sha?: string;
}

interface WikiProposalCreatedEvent extends WikiIdEvent {
  proposalId?: string;
  authorId?: string;
}

interface WikiProposalResolvedEvent extends WikiIdEvent {
  proposalId?: string;
}

/**
 * Clear every `submittedProposals[key]` entry whose value matches the given
 * proposal id. A single proposal only ever lives under one `(wikiId, path)`
 * key in practice, but the loop is defensive: if the user ever submits the
 * same proposal id for multiple paths (e.g. after a collision), both
 * entries are cleared so no stale banner sticks around.
 *
 * Keys are always built via {@link submittedProposalKey} as
 * `${wikiId}:${path}`. Paths can include slashes but never colons
 * (folder9 rejects colon-bearing paths with a 400), so splitting on the
 * first colon is unambiguous.
 *
 * We intentionally do **not** try to clear any locally-stored draft for the
 * affected path — `useWikiDraft` already discards a draft whose base
 * revision is older than the server's when the page is next opened, and
 * drafts live in a React hook that can't be reached from a WS handler.
 */
function clearSubmittedProposalsByProposalId(proposalId: string): void {
  const map = useWikiStore.getState().submittedProposals;
  for (const [key, value] of Object.entries(map)) {
    if (value !== proposalId) continue;
    const colonIdx = key.indexOf(":");
    if (colonIdx < 0) continue; // malformed key — skip
    const wikiId = key.slice(0, colonIdx);
    const path = key.slice(colonIdx + 1);
    wikiActions.setSubmittedProposal(wikiId, path, null);
  }
}

/**
 * Subscribe to every `wiki_*` WebSocket event and translate it into the
 * matching React Query invalidation / Zustand store cleanup.
 *
 * Mount this hook **once** under the Wiki UI (currently from
 * `WikiMainContent`) — it attaches to the global `wsService` singleton so
 * duplicate mounts would install duplicate listeners. Unmount cleans up
 * every handler, including any that were queued via `pendingListeners`
 * while the socket was still connecting.
 *
 * Invalidation strategy:
 *   * `wiki_created` / `wiki_updated` / `wiki_archived` → `wikiKeys.all`
 *     (prefix) to refresh the Wiki list in the sub-sidebar.
 *   * `wiki_page_updated` → the `wikiKeys.trees(wikiId)` and
 *     `wikiKeys.pages(wikiId)` **prefixes** so every tree/page variant is
 *     marked stale. We can't target `wikiKeys.page(wikiId, path)` because
 *     the ref-updated payload carries a git ref (e.g. `refs/heads/main`),
 *     not a page path, and we don't have a ref→path mapping on the client.
 *   * `wiki_proposal_created` → `wikiKeys.proposals(wikiId)` prefix.
 *   * `wiki_proposal_approved` / `wiki_proposal_rejected` → proposals
 *     prefix **and** pages prefix (an approved proposal merges and updates
 *     pages), plus wiki-store cleanup of any `submittedProposals` entries
 *     keyed on the resolved proposal id.
 */
export function useWikiWebSocketSync(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    // List of (event, handler) pairs registered in a single pass so the
    // cleanup function can symmetrically `off` every one. Typed as
    // `unknown` in the handler because Socket.io delivers arbitrary shapes
    // and we narrow at the call site.
    const handlers: Array<[string, (data: unknown) => void]> = [
      [
        "wiki_created",
        () => {
          queryClient.invalidateQueries({ queryKey: wikiKeys.all });
        },
      ],
      [
        "wiki_updated",
        () => {
          queryClient.invalidateQueries({ queryKey: wikiKeys.all });
        },
      ],
      [
        "wiki_archived",
        () => {
          queryClient.invalidateQueries({ queryKey: wikiKeys.all });
        },
      ],
      [
        "wiki_page_updated",
        (data) => {
          const { wikiId } = (data ?? {}) as WikiPageUpdatedEvent;
          if (!wikiId) return;
          queryClient.invalidateQueries({ queryKey: wikiKeys.trees(wikiId) });
          queryClient.invalidateQueries({ queryKey: wikiKeys.pages(wikiId) });
        },
      ],
      [
        "wiki_proposal_created",
        (data) => {
          const { wikiId } = (data ?? {}) as WikiProposalCreatedEvent;
          if (!wikiId) return;
          queryClient.invalidateQueries({
            queryKey: wikiKeys.proposals(wikiId),
          });
        },
      ],
      [
        "wiki_proposal_approved",
        (data) => {
          const { wikiId, proposalId } = (data ??
            {}) as WikiProposalResolvedEvent;
          if (!wikiId) return;
          queryClient.invalidateQueries({
            queryKey: wikiKeys.proposals(wikiId),
          });
          // Approval merges the proposal into the canonical branch, so any
          // page query for this wiki may now be stale.
          queryClient.invalidateQueries({ queryKey: wikiKeys.pages(wikiId) });
          if (proposalId) {
            clearSubmittedProposalsByProposalId(proposalId);
          }
        },
      ],
      [
        "wiki_proposal_rejected",
        (data) => {
          const { wikiId, proposalId } = (data ??
            {}) as WikiProposalResolvedEvent;
          if (!wikiId) return;
          queryClient.invalidateQueries({
            queryKey: wikiKeys.proposals(wikiId),
          });
          // Rejection doesn't alter the canonical branch, so we don't
          // invalidate page queries here — the banner flip is enough.
          if (proposalId) {
            clearSubmittedProposalsByProposalId(proposalId);
          }
        },
      ],
    ];

    for (const [event, handler] of handlers) {
      wsService.on(event, handler);
    }

    return () => {
      for (const [event, handler] of handlers) {
        wsService.off(event, handler);
      }
    };
  }, [queryClient]);
}
