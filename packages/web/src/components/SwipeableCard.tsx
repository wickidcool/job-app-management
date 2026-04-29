import { useState, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';

export interface SwipeAction {
  icon: string;
  label: string;
  color: string;
  action: () => void;
}

export interface SwipeableCardProps {
  children: ReactNode;
  leftActions?: SwipeAction[];
  rightActions?: SwipeAction[];
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  disabled?: boolean;
}

export function SwipeableCard({
  children,
  leftActions = [],
  rightActions = [],
  onSwipeLeft,
  onSwipeRight,
  disabled = false,
}: SwipeableCardProps) {
  const [translateX, setTranslateX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [isRevealed, setIsRevealed] = useState<'left' | 'right' | null>(null);
  const startX = useRef(0);
  const currentX = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const SWIPE_THRESHOLD = 50;
  const MAX_SWIPE = 120;

  const resetPosition = () => {
    setTranslateX(0);
    setIsRevealed(null);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        resetPosition();
      }
    };

    if (isRevealed) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [isRevealed]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (disabled) return;
    startX.current = e.touches[0].clientX;
    setIsSwiping(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (disabled || !isSwiping) return;

    currentX.current = e.touches[0].clientX;
    const diff = currentX.current - startX.current;

    const clampedDiff = Math.max(-MAX_SWIPE, Math.min(MAX_SWIPE, diff));
    setTranslateX(clampedDiff);
  };

  const handleTouchEnd = () => {
    if (disabled || !isSwiping) return;

    const diff = translateX;
    setIsSwiping(false);

    if (Math.abs(diff) < SWIPE_THRESHOLD) {
      resetPosition();
      return;
    }

    if (diff > 0 && rightActions.length > 0) {
      setTranslateX(MAX_SWIPE);
      setIsRevealed('right');
      onSwipeRight?.();
    } else if (diff < 0 && leftActions.length > 0) {
      setTranslateX(-MAX_SWIPE);
      setIsRevealed('left');
      onSwipeLeft?.();
    } else {
      resetPosition();
    }
  };

  const handleActionClick = (action: SwipeAction) => {
    action.action();
    resetPosition();
  };

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden"
      style={{ touchAction: 'pan-y' }}
    >
      {/* Left actions (revealed when swiping left) */}
      {leftActions.length > 0 && (
        <div className="absolute right-0 top-0 bottom-0 flex items-stretch">
          {leftActions.map((action, index) => (
            <button
              key={index}
              onClick={() => handleActionClick(action)}
              className={`
                flex min-w-[60px] flex-col items-center justify-center gap-1 px-3
                text-white transition-all
                ${action.color}
                active:brightness-90
              `}
              style={{
                minHeight: '44px',
                minWidth: '44px',
              }}
              aria-label={action.label}
            >
              <span className="text-xl">{action.icon}</span>
              <span className="text-xs font-medium">{action.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Right actions (revealed when swiping right) */}
      {rightActions.length > 0 && (
        <div className="absolute left-0 top-0 bottom-0 flex items-stretch">
          {rightActions.map((action, index) => (
            <button
              key={index}
              onClick={() => handleActionClick(action)}
              className={`
                flex min-w-[60px] flex-col items-center justify-center gap-1 px-3
                text-white transition-all
                ${action.color}
                active:brightness-90
              `}
              style={{
                minHeight: '44px',
                minWidth: '44px',
              }}
              aria-label={action.label}
            >
              <span className="text-xl">{action.icon}</span>
              <span className="text-xs font-medium">{action.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Card content */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: `translateX(${translateX}px)`,
          transition: isSwiping ? 'none' : 'transform 0.3s ease-out',
        }}
        className="relative bg-white"
      >
        {children}
      </div>
    </div>
  );
}
