import { useEffect, useEffectEvent, useRef } from "react";

type KeyedEffect = (key: string) => void | Promise<void>;

export function useEffectOncePerKey(
  key: string | null | undefined,
  enabled: boolean,
  effect: KeyedEffect,
): void {
  const lastProcessedKeyRef = useRef<string | null>(null);
  const runEffect = useEffectEvent(effect);

  useEffect(() => {
    if (!enabled || !key) {
      lastProcessedKeyRef.current = null;
      return;
    }

    if (lastProcessedKeyRef.current === key) {
      return;
    }

    lastProcessedKeyRef.current = key;
    void runEffect(key);
  }, [enabled, key, runEffect]);
}
