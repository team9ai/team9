import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { UserProfileCard } from "./UserProfileCard";

type HoverableProps = {
  onMouseEnter?: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseLeave?: (e: React.MouseEvent<HTMLElement>) => void;
};

interface UserHoverCardProps {
  userId: string | undefined;
  displayName: string;
  children: ReactElement<HoverableProps>;
}

/**
 * Wrap an element to show UserProfileCard on hover. No-op if userId missing
 * (e.g. system messages) so children render unchanged.
 */
export function UserHoverCard({
  userId,
  displayName,
  children,
}: UserHoverCardProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  const handleEnter = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (showTimerRef.current) clearTimeout(showTimerRef.current);
    const el = e.currentTarget;
    showTimerRef.current = setTimeout(() => {
      setRect(el.getBoundingClientRect());
    }, 300);
  }, []);

  const handleLeave = useCallback(() => {
    if (showTimerRef.current) clearTimeout(showTimerRef.current);
    hideTimerRef.current = setTimeout(() => setRect(null), 200);
  }, []);

  const handleCardEnter = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  }, []);

  const handleCardLeave = useCallback(() => {
    hideTimerRef.current = setTimeout(() => setRect(null), 200);
  }, []);

  if (!userId || !isValidElement(children)) {
    return children;
  }

  const childEl = children as ReactElement<HoverableProps>;
  const originalEnter = childEl.props.onMouseEnter;
  const originalLeave = childEl.props.onMouseLeave;

  const wrapped = cloneElement<HoverableProps>(childEl, {
    onMouseEnter: (e) => {
      originalEnter?.(e);
      handleEnter(e);
    },
    onMouseLeave: (e) => {
      originalLeave?.(e);
      handleLeave();
    },
  });

  return (
    <>
      {wrapped}
      {rect && (
        <UserProfileCard
          userId={userId}
          displayName={displayName}
          anchorRect={rect}
          onMouseEnter={handleCardEnter}
          onMouseLeave={handleCardLeave}
        />
      )}
    </>
  );
}
