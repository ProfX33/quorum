export type Bid = { id: string; maxPrice: number };
export type Payment = { id: string; amount: number };

/** Splits `price` (integer satoshis) into `n` near-equal shares, largest first. */
export function shareOut(price: number, n: number): number[] {
  const base = Math.floor(price / n);
  const remainder = price - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Finds the group of buyers that pays for an offer. The price is split evenly over
 * everybody who bid; whoever's maximum is below their share is cut out and the split
 * is retried with the rest, until everyone left can pay (or nobody is left).
 * Returns the payments, or null when the offer cannot be sold.
 */
export function findPaymentGroup(price: number, bids: Bid[]): Payment[] | null {
  // Highest maxima first, so the rounding remainder lands on those most willing to pay.
  let group = [...bids].sort((a, b) => b.maxPrice - a.maxPrice);
  while (group.length > 0) {
    const shares = shareOut(price, group.length);
    const willing = group.filter((bid, i) => bid.maxPrice >= shares[i]!);
    if (willing.length === group.length) {
      return group.map((bid, i) => ({ id: bid.id, amount: shares[i]! }));
    }
    group = willing;
  }
  return null;
}
