import { useRef, useCallback, useEffect } from 'react';

const CARD_WIDTH = 420;
const CARD_GAP = 32;

export function ConfessionCarousel({ confessions, activeIndex, onActiveChange }) {
  const scrollRef = useRef(null);
  const isUserScrolling = useRef(false);
  const scrollTimeout = useRef(null);

  const getScrollTarget = useCallback(
    (index) => {
      if (!scrollRef.current) return 0;
      const containerWidth = scrollRef.current.clientWidth;
      const offset = index * (CARD_WIDTH + CARD_GAP);
      return offset - containerWidth / 2 + CARD_WIDTH / 2;
    },
    []
  );

  const scrollToIndex = useCallback(
    (index, behavior = 'smooth') => {
      if (!scrollRef.current) return;
      const target = getScrollTarget(index);
      scrollRef.current.scrollTo({ left: target, behavior });
    },
    [getScrollTarget]
  );

  // Scroll to active when activeIndex changes externally (e.g. clicking number)
  useEffect(() => {
    if (!isUserScrolling.current) {
      scrollToIndex(activeIndex);
    }
  }, [activeIndex, scrollToIndex]);

  // Initial position on mount / data change
  useEffect(() => {
    scrollToIndex(activeIndex, 'instant');
  }, [confessions.length]);

  const handleScroll = useCallback(() => {
    isUserScrolling.current = true;
    if (scrollTimeout.current) clearTimeout(scrollTimeout.current);

    scrollTimeout.current = setTimeout(() => {
      isUserScrolling.current = false;
      if (!scrollRef.current) return;

      const containerWidth = scrollRef.current.clientWidth;
      const scrollLeft = scrollRef.current.scrollLeft;
      const centerPoint = scrollLeft + containerWidth / 2;

      const nearestIndex = Math.round(
        centerPoint / (CARD_WIDTH + CARD_GAP)
      );
      const clamped = Math.max(0, Math.min(confessions.length - 1, nearestIndex));

      if (clamped !== activeIndex) {
        onActiveChange(clamped);
      }
      scrollToIndex(clamped);
    }, 100);
  }, [activeIndex, confessions.length, onActiveChange, scrollToIndex]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const totalWidth =
    confessions.length * CARD_WIDTH + (confessions.length - 1) * CARD_GAP;

  return (
    <div
      ref={scrollRef}
      style={{
        width: '100%',
        height: '100%',
        overflowX: 'scroll',
        overflowY: 'hidden',
        scrollbarWidth: 'none',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          height: '100%',
          gap: CARD_GAP,
          paddingLeft: 'calc(50vw - 210px)',
          paddingRight: 'calc(50vw - 210px)',
        }}
      >
        {confessions.map((confession, i) => {
          const isActive = i === activeIndex;
          return (
            <div
              key={confession.id}
              onClick={() => {
                onActiveChange(i);
                scrollToIndex(i);
              }}
              style={{
                flex: '0 0 auto',
                width: CARD_WIDTH,
                cursor: isActive ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <img
                src={confession.image}
                alt={`Confession ${confession.id}`}
                draggable={false}
                loading="lazy"
                style={{
                  width: '100%',
                  height: 'auto',
                  maxHeight: '55vh',
                  objectFit: 'contain',
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
