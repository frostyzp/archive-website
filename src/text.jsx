const VARIANTS = {
  display: {
    fontSize: 48,
    fontWeight: 700,
    lineHeight: 1.1,
    letterSpacing: '-0.02em',
  },
  heading: {
    fontSize: 32,
    fontWeight: 600,
    lineHeight: 1.2,
    letterSpacing: '-0.015em',
  },
  subheading: {
    fontSize: 20,
    fontWeight: 600,
    lineHeight: 1.3,
    letterSpacing: '-0.01em',
  },
  body: {
    fontSize: 16,
    fontWeight: 400,
    lineHeight: 1.5,
    letterSpacing: '0',
  },
  bodySmall: {
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 1.5,
    letterSpacing: '0',
  },
  caption: {
    fontSize: 12,
    fontWeight: 500,
    lineHeight: 1.4,
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
  },
  label: {
    fontSize: 13,
    fontWeight: 500,
    lineHeight: 1.4,
    letterSpacing: '0.01em',
  },
};

// Variants that default to the mono family.
// Small UI / chrome text uses mono for consistency.
const MONO_VARIANTS = new Set(['caption', 'label']);

const ELEMENT_MAP = {
  display: 'h1',
  heading: 'h2',
  subheading: 'h3',
  body: 'p',
  bodySmall: 'p',
  caption: 'span',
  label: 'span',
};

const FONT_PRIMARY = 'var(--font-primary, system-ui, -apple-system, sans-serif)';
const FONT_MONO = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)';

export function Text({
  variant = 'body',
  as,
  color,
  mono,
  style,
  children,
  ...props
}) {
  const Tag = as || ELEMENT_MAP[variant] || 'span';
  const variantStyle = VARIANTS[variant] || VARIANTS.body;
  const useMono = mono ?? MONO_VARIANTS.has(variant);

  return (
    <Tag
      style={{
        fontFamily: useMono ? FONT_MONO : FONT_PRIMARY,
        color: color || 'inherit',
        ...variantStyle,
        ...style,
      }}
      {...props}
    >
      {children}
    </Tag>
  );
}

export { VARIANTS, FONT_PRIMARY, FONT_MONO };
