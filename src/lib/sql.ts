/**
 * Escape special characters in a LIKE pattern to prevent wildcard injection.
 * Use with parameterized queries: `%${escapeLike(input)}%`
 */
export function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, "\\$&");
}
