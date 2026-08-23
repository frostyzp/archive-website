import { useEffect, useRef, useState } from 'react';

/**
 * Grid/wall tile image. `src` is assigned only once the tile is near the
 * viewport so a 255-note sheet does not pull every file on first paint.
 * Native `loading="lazy"` is not enough — Chrome's prefetch band on a dense
 * grid still grabs most of the archive.
 */
export default function LazyNoteImg({
  src,
  alt,
  rootMargin = '800px 0px',
  ...rest
}) {
  const ref = useRef(null);
  const [active, setActive] = useState(!src);

  useEffect(() => {
    if (!src) {
      setActive(false);
      return undefined;
    }
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setActive(true);
      return undefined;
    }
    let done = false;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || done) return;
        done = true;
        setActive(true);
        io.disconnect();
      },
      { rootMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [src]);

  return <img ref={ref} src={active && src ? src : undefined} alt={alt} {...rest} />;
}
