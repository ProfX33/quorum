import { describe, expect, test } from "bun:test";
import { findPaymentGroup, shareOut } from "./settlement.ts";

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
