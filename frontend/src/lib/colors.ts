const NAMED_COLORS: Record<string, string> = {
  black: '#18181b',
  blue: '#2563eb',
  brown: '#92400e',
  burgundy: '#881337',
  cream: '#f5f5dc',
  gold: '#d97706',
  gray: '#71717a',
  grey: '#71717a',
  green: '#16a34a',
  orange: '#f97316',
  pink: '#ec4899',
  purple: '#9333ea',
  red: '#dc2626',
  silver: '#a1a1aa',
  tan: '#d6b48a',
  teal: '#0d9488',
  white: '#f8fafc',
  yellow: '#eab308',
}

const COLOR_KEYWORDS: Array<[RegExp, string]> = [
  [/\bspectraflame\s+blue\b|\bmetallic\s+blue\b|\bdark\s+blue\b/, '#1d4ed8'],
  [/\blight\s+blue\b|\baqua\b/, '#38bdf8'],
  [/\bspectraflame\s+red\b|\bmetallic\s+red\b|\bdark\s+red\b/, '#b91c1c'],
  [/\blime\b|\blight\s+green\b/, '#84cc16'],
  [/\bmetallic\s+green\b|\bdark\s+green\b/, '#15803d'],
  [/\bmetallic\s+purple\b|\bdark\s+purple\b/, '#7e22ce'],
  [/\bmetallic\s+gold\b/, '#ca8a04'],
  [/\bchrome\b|\bsilver\b|\bmetalflake\b/, '#a1a1aa'],
  [/\bclear\b|\btransparent\b/, '#e5e7eb'],
]

export function colorToCss(value?: string): string {
  if (!value) return '#f97316'
  const raw = value.trim().toLowerCase()
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) return raw
  if (/^(rgb|hsl)a?\(/i.test(raw)) return raw

  for (const [pattern, color] of COLOR_KEYWORDS) {
    if (pattern.test(raw)) return color
  }

  for (const [name, color] of Object.entries(NAMED_COLORS)) {
    if (new RegExp(`\\b${name}\\b`).test(raw)) return color
  }

  return '#f97316'
}
