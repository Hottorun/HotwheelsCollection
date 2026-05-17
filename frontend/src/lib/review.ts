export const REVIEW_NOTE = 'Review: verify this is the exact version owned.'

export function isMarkedForReview(notes?: string): boolean {
  return (notes ?? '').toLowerCase().includes('review:')
}

export function addReviewNote(notes?: string): string {
  if (isMarkedForReview(notes)) return notes ?? REVIEW_NOTE
  return [REVIEW_NOTE, notes].filter(Boolean).join(' ')
}

export function removeReviewNote(notes?: string): string {
  return (notes ?? '')
    .replace(REVIEW_NOTE, '')
    .replace(/\s*review:\s*verify this is the exact version owned\.\s*/i, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
