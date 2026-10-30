import { describe, expect, test } from "bun:test";
import { denominations, findPaymentGroup, isComplete, pickDenominations, shareOut } from "./settlement.ts";

const bids = (...maxima: number[]) => maxima.map((maxPrice, i) => ({ id: `b${i}`, maxPrice }));

describe("shareOut", () => {
  test("distributes the remainder over the first shares", () => {
    expect(shareOut(10, 3)).toEqual([4, 3, 3]);
    expect(shareOut(9, 3)).toEqual([3, 3, 3]);
  });
});

describe("findPaymentGroup", () => {
  test("everybody pays an equal share when all can afford it", () => {
    expect(findPaymentGroup(90, bids(30, 50, 40))).toEqual([
      { id: "b1", amount: 30 },
      { id: "b2", amount: 30 },
      { id: "b0", amount: 30 },
    ]);
  });

  test("cuts out bidders below the share and retries recursively", () => {
    // 100/4 = 25 cuts b0 (10); 100/3 ≈ 34 cuts b1 (30); 100/2 = 50 is fine.
    expect(findPaymentGroup(100, bids(10, 30, 60, 50))).toEqual([
      { id: "b2", amount: 50 },
      { id: "b3", amount: 50 },
    ]);
  });

  test("a single bidder able to pay the full price buys alone", () => {
    expect(findPaymentGroup(100, bids(5, 100))).toEqual([{ id: "b1", amount: 100 }]);
  });

  test("returns null when no group can pay", () => {
    expect(findPaymentGroup(100, bids(20, 30, 40))).toBeNull();
    expect(findPaymentGroup(100, [])).toBeNull();
  });

  test("rounding remainder goes to the highest maxima", () => {
    expect(findPaymentGroup(10, bids(3, 4, 3))).toEqual([
      { id: "b1", amount: 4 },
      { id: "b0", amount: 3 },
      { id: "b2", amount: 3 },
    ]);
  });
});

describe("denominations", () => {
  test("add up to the total and are complete", () => {
    for (const total of [1, 2, 3, 7, 8, 400, 1023, 1024, 123_456_789, Number.MAX_SAFE_INTEGER]) {
      const values = denominations(total);
      expect(values.reduce((a, b) => a + b, 0)).toBe(total);
      expect(isComplete(values)).toBe(true);
      expect(values.length).toBeLessThanOrEqual(54);
    }
  });

  test("any share up to the total can be picked exactly", () => {
    for (const total of [1, 2, 5, 6, 7, 8, 9, 100, 127, 128, 400]) {
      const values = denominations(total);
      for (let share = 1; share <= total; share++) {
        const picked = pickDenominations(values, share)!;
        expect(picked.reduce((sum, i) => sum + values[i]!, 0)).toBe(share);
        expect(new Set(picked).size).toBe(picked.length);
      }
    }
  });

  test("a bid and its top-up together still make every share", () => {
    const values = [...denominations(100), ...denominations(37)];
    expect(isComplete(values)).toBe(true);
    for (let share = 1; share <= 137; share++) {
      expect(pickDenominations(values, share)!.reduce((sum, i) => sum + values[i]!, 0)).toBe(share);
    }
  });

  test("a share beyond the pledges or gaps in them cannot be picked", () => {
    expect(pickDenominations(denominations(10), 11)).toBeNull();
    expect(pickDenominations([500], 300)).toBeNull();
    expect(isComplete([500])).toBe(false);
    expect(isComplete([1, 2, 8])).toBe(false);
    expect(isComplete([0, 1])).toBe(false);
  });
});
