export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}

/**
 * Calculate a percentage of an amount using basis points.
 * basisPoints: 300 = 3.0%
 * calculatePercentage(10000, 300) → 300
 */
export function calculatePercentage(
  amountCents: number,
  basisPoints: number,
): number {
  return Math.round((amountCents * basisPoints) / 10000);
}
