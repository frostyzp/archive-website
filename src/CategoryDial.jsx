import { useRef, useState, useCallback, useEffect } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'motion/react';
import { Text } from './text';

const CATEGORIES = [
  'Refusal',
  'Harm',
  'Therapist',
  'Love',
  'Family',
  'Ghostwriter',
];

const DIAL_RADIUS = 260;
const VISIBLE_HEIGHT = 140;
const ARC_SPAN = 160; // degrees of visible arc

export function CategoryDial({ onCategoryChange }) {
  const dialRef = useRef(null);
  const isDragging = useRef(false);
  const dragStartAngle = useRef(0);
  const rotationAtDragStart = useRef(0);

  const rotation = useMotionValue(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [locked, setLocked] = useState(true);

  const degreesPerCategory = ARC_SPAN / (CATEGORIES.length - 1);

  const snapToCategory = useCallback(
    (index) => {
      const targetRotation = -index * degreesPerCategory;
      animate(rotation, targetRotation, {
        type: 'spring',
        stiffness: 300,
        damping: 30,
      });
      setActiveIndex(index);
      setLocked(true);
      onCategoryChange?.(CATEGORIES[index]);
    },
    [degreesPerCategory, onCategoryChange, rotation]
  );

  const getAngleFromEvent = useCallback((e, rect) => {
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height;
    const dx = e.clientX - centerX;
    const dy = e.clientY - centerY;
    return Math.atan2(dx, -dy) * (180 / Math.PI);
  }, []);

  const handlePointerDown = useCallback(
    (e) => {
      if (!dialRef.current) return;
      e.preventDefault();
      isDragging.current = true;
      setLocked(false);

      const rect = dialRef.current.getBoundingClientRect();
      dragStartAngle.current = getAngleFromEvent(e, rect);
      rotationAtDragStart.current = rotation.get();

      dialRef.current.setPointerCapture(e.pointerId);
    },
    [getAngleFromEvent, rotation]
  );

  const handlePointerMove = useCallback(
    (e) => {
      if (!isDragging.current || !dialRef.current) return;

      const rect = dialRef.current.getBoundingClientRect();
      const currentAngle = getAngleFromEvent(e, rect);
      const delta = currentAngle - dragStartAngle.current;
      const newRotation = rotationAtDragStart.current + delta;

      const maxRotation = 0;
      const minRotation = -(CATEGORIES.length - 1) * degreesPerCategory;
      const clamped = Math.max(minRotation, Math.min(maxRotation, newRotation));

      rotation.set(clamped);
    },
    [getAngleFromEvent, degreesPerCategory, rotation]
  );

  const handlePointerUp = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;

    const current = rotation.get();
    const nearestIndex = Math.round(-current / degreesPerCategory);
    const clampedIndex = Math.max(0, Math.min(CATEGORIES.length - 1, nearestIndex));
    snapToCategory(clampedIndex);
  }, [rotation, degreesPerCategory, snapToCategory]);

  useEffect(() => {
    onCategoryChange?.(CATEGORIES[0]);
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: DIAL_RADIUS * 2 + 40,
        height: VISIBLE_HEIGHT,
        overflow: 'hidden',
        zIndex: 200,
        cursor: isDragging.current ? 'grabbing' : 'grab',
      }}
    >
      <motion.div
        ref={dialRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          position: 'absolute',
          bottom: -(DIAL_RADIUS * 2 - VISIBLE_HEIGHT),
          left: '50%',
          marginLeft: -DIAL_RADIUS,
          width: DIAL_RADIUS * 2,
          height: DIAL_RADIUS * 2,
          borderRadius: '50%',
          rotate: useTransform(rotation, (r) => `${r}deg`),
          touchAction: 'none',
          userSelect: 'none',
        }}
      >
        {/* Dial background */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: 'radial-gradient(ellipse at center bottom, rgba(40,36,30,0.95) 0%, rgba(20,18,15,0.98) 70%)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        />

        {/* Category labels arranged in arc */}
        {CATEGORIES.map((category, i) => {
          const angle = -ARC_SPAN / 2 + i * degreesPerCategory;
          const rad = (angle * Math.PI) / 180;
          const labelRadius = DIAL_RADIUS - 40;
          const x = DIAL_RADIUS + Math.sin(rad) * labelRadius;
          const y = DIAL_RADIUS - Math.cos(rad) * labelRadius;

          return (
            <div
              key={category}
              onClick={(e) => {
                e.stopPropagation();
                snapToCategory(i);
              }}
              style={{
                position: 'absolute',
                left: x,
                top: y,
                transform: `translate(-50%, -50%) rotate(${angle}deg)`,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <Text
                variant="body"
                style={{
                  fontSize: i === activeIndex ? 22 : 16,
                  fontWeight: i === activeIndex ? 600 : 400,
                  opacity: i === activeIndex ? 1 : 0.4,
                  transition: 'all 0.3s ease',
                }}
              >
                {category}
              </Text>
            </div>
          );
        })}

        {/* Center indicator */}
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 2,
            height: 20,
            background: 'rgba(255,255,255,0.3)',
            borderRadius: 1,
          }}
        />
      </motion.div>

      {/* Fixed top indicator */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 2,
          height: 16,
          background: locked ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.3)',
          borderRadius: 1,
          transition: 'background 0.3s',
          zIndex: 10,
        }}
      />
    </div>
  );
}
