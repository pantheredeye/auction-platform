export interface PaginationParams {
  cursor?: string;
  limit: number;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export function encodeCursor(value: string): string {
  return btoa(value);
}

export function decodeCursor(cursor: string): string {
  return atob(cursor);
}
