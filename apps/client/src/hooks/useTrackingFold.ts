import { useCallback, useState } from "react";

/**
 * NOTE: This hook is not currently used in production. MessageList.tsx uses a
 * simpler approach (useState<Set<string>> + message-list-fold.ts pure helpers).
 *
 * This hook provides a richer abstraction (Map<roundId, FoldState> with
 * stepCount tracking and autoFoldPrevious) intended for future use cases such
 * as TrackingModal round navigation or a standalone fold controller. It is kept
 * as a tested, ready-to-use building block rather than being removed.
 */

/**
 * State of a single round's fold/expand UI.
 */
export interface FoldState {
  /** Whether the round is currently collapsed in the UI. */
  isFolded: boolean;
  /** Cached step count for the round (used when rendering collapsed summaries). */
  stepCount: number;
}

/**
 * Result of the {@link useTrackingFold} hook.
 */
export interface UseTrackingFoldResult {
  /**
   * Explicitly set the fold state for a given round.
   *
   * @param roundId - Identifier of the round to update.
   * @param isFolded - Whether the round should be folded.
   * @param stepCount - Optional step count associated with the round. Defaults to 0.
   */
  setFolded: (roundId: string, isFolded: boolean, stepCount?: number) => void;
  /**
   * Collapse every tracked round except the one identified by {@param latestRoundId}.
   *
   * The latest round is left untouched (its existing state is preserved) and
   * rounds that have never been tracked are not added to the map.
   */
  autoFoldPrevious: (latestRoundId: string) => void;
  /**
   * Whether the given round is currently folded. Untracked rounds default to
   * `false` (i.e. expanded).
   */
  isFolded: (roundId: string) => boolean;
  /**
   * Step count cached for the given round. Untracked rounds default to `0`.
   */
  getStepCount: (roundId: string) => number;
}

/**
 * React hook that tracks the fold/expand state of each round in the Team9
 * agent's execution stream. It exposes imperative helpers for toggling
 * individual rounds as well as auto-folding all previous rounds whenever a new
 * round becomes the latest one.
 */
export function useTrackingFold(): UseTrackingFoldResult {
  const [foldMap, setFoldMap] = useState<Map<string, FoldState>>(
    () => new Map(),
  );

  const setFolded = useCallback(
    (roundId: string, isFolded: boolean, stepCount = 0) => {
      setFoldMap((prev) => {
        const next = new Map(prev);
        next.set(roundId, { isFolded, stepCount });
        return next;
      });
    },
    [],
  );

  const autoFoldPrevious = useCallback((latestRoundId: string) => {
    setFoldMap((prev) => {
      const next = new Map(prev);
      next.forEach((state, roundId) => {
        if (roundId !== latestRoundId) {
          next.set(roundId, { ...state, isFolded: true });
        }
      });
      return next;
    });
  }, []);

  const isFolded = useCallback(
    (roundId: string) => foldMap.get(roundId)?.isFolded ?? false,
    [foldMap],
  );

  const getStepCount = useCallback(
    (roundId: string) => foldMap.get(roundId)?.stepCount ?? 0,
    [foldMap],
  );

  return { setFolded, autoFoldPrevious, isFolded, getStepCount };
}
