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

/**
 * What a bid of `maxPrice` would get if bidding closed now, next to the funded maxima of
 * `others`. `share` is the largest share in the group, so rounding never makes it an underestimate.
 */
export function projectBid(price: number, others: number[], maxPrice: number) {
  const group = findPaymentGroup(price, [
    ...others.map((m, i) => ({ id: String(i), maxPrice: m })),
    { id: "me", maxPrice },
  ]);
  return {
    groupSize: group?.length ?? 0,
    inGroup: group?.some((p) => p.id === "me") ?? false,
    share: group?.[0]!.amount ?? null,
  };
}

/** The smallest maximum that gets a new bidder into the group; `price` always does. */
export function smallestJoiningBid(price: number, others: number[]) {
  let low = 1;
  let high = price;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (projectBid(price, others, mid).inGroup) high = mid;
    else low = mid + 1;
  }
  return low;
}

/**
 * Splits a bid's maximum into outputs that can pay any share up to it exactly: 1, 2, 4, ...
 * and the rest. A pledge is signed once, before the share is known, and whatever its inputs
 * carry beyond the group outputs goes to the miners, so the share has to be picked exactly.
 */
export function denominations(total: number): number[] {
  const values: number[] = [];
  let left = total;
  for (let v = 1; v <= left; v *= 2) {
    values.push(v);
    left -= v;
  }
  if (left > 0) values.push(left);
  return values;
}

/** Whether every amount up to the sum can be made from `values`, which denominations() gives. */
export function isComplete(values: number[]) {
  let reach = 0;
  for (const v of [...values].sort((a, b) => a - b)) {
    if (v < 1 || v > reach + 1) return false;
    reach += v;
  }
  return true;
}

/** Indexes of `values` that add up to exactly `target`, or null. Exact on complete values. */
export function pickDenominations(values: number[], target: number): number[] | null {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]);
  const picked: number[] = [];
  let left = target;
  for (const [v, i] of order) {
    if (v > left) continue;
    picked.push(i);
    left -= v;
  }
  return left === 0 ? picked : null;
}
