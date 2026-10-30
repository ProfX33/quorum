import { describe, expect, test } from "bun:test";
import { KeyDeriver, LockingScript, MerklePath, P2PKH, PrivateKey, ProtoWallet, Spend, Transaction } from "@bsv/sdk";
import {
  ANYONE_KEY,
  BRC29_PROTOCOL,
  PLEDGE_FEE,
  derivationNonce,
  groupOutputs,
  groupTransaction,
  parsePledge,
  parseRefund,
  paymentLockingScript,
  pledgeLockingScript,
  refundTransaction,
  signPledge,
  tagLockingScript,
} from "./payments.ts";
import { denominations, pickDenominations } from "./settlement.ts";

const seller = PrivateKey.fromRandom();
const sellerKey = seller.toPublicKey().toString();
const prefix = derivationNonce();
const suffix = derivationNonce();
const PRICE = 1000;
const outputs = await groupOutputs(sellerKey, prefix, suffix, "offer-1", PRICE);

/** A buyer's pledge of `satoshis` to their own pledge key, funded by a made-up mined parent. */
async function pledge(satoshis: number, keyID = "bid 0") {
  const wallet = new ProtoWallet(PrivateKey.fromRandom());
  const funding = PrivateKey.fromRandom();
  const parent = new Transaction();
  parent.addOutput({ lockingScript: new P2PKH().lock(funding.toPublicKey().toHash()), satoshis: 10_000 });
  parent.merklePath = new MerklePath(1, [[{ offset: 0, hash: parent.id("hex"), txid: true }]]);
  const tx = new Transaction();
  tx.addInput({ sourceTransaction: parent, sourceOutputIndex: 0, unlockingScriptTemplate: new P2PKH().unlock(funding) });
  tx.addOutput({ lockingScript: LockingScript.fromHex(await pledgeLockingScript(wallet, keyID)), satoshis });
  tx.addOutput({ lockingScript: new P2PKH().lock(funding.toPublicKey().toHash()), satoshis: 9_000 - satoshis });
  await tx.sign();
  return { wallet, keyID, tx, beef: tx.toAtomicBEEF() };
}

/** A pledge of a whole maximum, in one output per denomination. */
async function denominatedPledge(max: number) {
  const wallet = new ProtoWallet(PrivateKey.fromRandom());
  const keyID = "bid 0";
  const funding = PrivateKey.fromRandom();
  const parent = new Transaction();
  parent.addOutput({ lockingScript: new P2PKH().lock(funding.toPublicKey().toHash()), satoshis: 10_000 });
  parent.merklePath = new MerklePath(1, [[{ offset: 0, hash: parent.id("hex"), txid: true }]]);
  const tx = new Transaction();
  tx.addInput({ sourceTransaction: parent, sourceOutputIndex: 0, unlockingScriptTemplate: new P2PKH().unlock(funding) });
  const lockingScript = LockingScript.fromHex(await pledgeLockingScript(wallet, keyID));
  for (const v of denominations(max)) tx.addOutput({ lockingScript, satoshis: v + PLEDGE_FEE });
  await tx.sign();
  return { wallet, keyID, tx, beef: tx.toAtomicBEEF() };
}

describe("paymentLockingScript", () => {
  test("is the key the seller's wallet derives when internalizing from the anyone sender", async () => {
    const script = await paymentLockingScript(sellerKey, prefix, suffix);
    // wallet-toolbox internalizeAction ("wallet payment") derives exactly this private key.
    const key = new KeyDeriver(seller).derivePrivateKey(BRC29_PROTOCOL, `${prefix} ${suffix}`, ANYONE_KEY);
    expect(new P2PKH().lock(key.toPublicKey().toHash()).toHex()).toBe(script);
  });

  test("differs per payment", async () => {
    expect(await paymentLockingScript(sellerKey, prefix, suffix)).not.toBe(
      await paymentLockingScript(sellerKey, prefix, derivationNonce()),
    );
  });
});

describe("parsePledge", () => {
  const signed = async (p: Awaited<ReturnType<typeof pledge>>, vouts: number[], outs = outputs) =>
    Promise.all(vouts.map(async (vout) => ({ vout, unlockingScript: await signPledge(p.wallet, p.keyID, outs, p.tx, vout) })));

  test("accepts a pledge split into denominations, each output signed for the group outputs", async () => {
    const p = await denominatedPledge(500);
    const vouts = denominations(500).map((_, i) => i);
    const result = await parsePledge(p.beef, await signed(p, vouts), outputs);
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.outputs.reduce((sum, o) => sum + o.satoshis - PLEDGE_FEE, 0)).toBe(500);
  });

  test("rejects a lump sum, which could not pay a smaller share without burning the rest", async () => {
    const p = await pledge(500 + PLEDGE_FEE);
    expect(await parsePledge(p.beef, await signed(p, [0]), outputs)).toHaveProperty("error");
  });

  test("rejects one output listed twice", async () => {
    const p = await pledge(1 + PLEDGE_FEE);
    expect(await parsePledge(p.beef, await signed(p, [0, 0]), outputs)).toHaveProperty("error");
  });

  test("rejects a signature for other outputs, a wrong key, or a plain SIGHASH_ALL", async () => {
    const p = await pledge(1 + PLEDGE_FEE);
    const other = await groupOutputs(sellerKey, prefix, derivationNonce(), "offer-1", PRICE);
    expect(await parsePledge(p.beef, await signed(p, [0], other), outputs)).toHaveProperty("error");
    const wrongKey = await signPledge(p.wallet, "bid 1", outputs, p.tx, 0);
    expect(await parsePledge(p.beef, [{ vout: 0, unlockingScript: wrongKey }], outputs)).toHaveProperty("error");

    const all = groupTransaction(outputs, [{ sourceTransaction: p.tx, vout: 0 }]);
    const key = new KeyDeriver((p.wallet as any).keyDeriver.rootKey).derivePrivateKey(
      [2, "datamarket pledge"], p.keyID, "self");
    all.inputs[0]!.unlockingScriptTemplate = new P2PKH().unlock(key);
    await all.sign();
    expect(await parsePledge(p.beef, [{ vout: 0, unlockingScript: all.inputs[0]!.unlockingScript!.toHex() }], outputs)).toHaveProperty("error");
  });

  test("rejects garbage and the change output", async () => {
    const p = await pledge(1 + PLEDGE_FEE);
    const [good] = await signed(p, [0]);
    expect(await parsePledge([1, 2, 3], [good], outputs)).toHaveProperty("error");
    expect(await parsePledge(p.beef, [{ ...good!, vout: 1 }], outputs)).toHaveProperty("error");
    expect(await parsePledge(p.beef, [{ vout: 0, unlockingScript: "zz" }], outputs)).toHaveProperty("error");
    expect(await parsePledge(p.beef, [], outputs)).toHaveProperty("error");
    expect(await parsePledge(p.beef, "nope", outputs)).toHaveProperty("error");
    expect(await parsePledge(p.beef, [null], outputs)).toHaveProperty("error");
  });
});

describe("group transaction", () => {
  const spendsAll = (tx: Transaction) =>
    tx.inputs.every((input, i) => {
      const source = input.sourceTransaction!.outputs[input.sourceOutputIndex]!;
      return new Spend({
        sourceTXID: input.sourceTransaction!.id("hex"),
        sourceOutputIndex: input.sourceOutputIndex,
        sourceSatoshis: source.satoshis!,
        lockingScript: source.lockingScript,
        transactionVersion: tx.version,
        otherInputs: tx.inputs.filter((_, j) => j !== i),
        inputIndex: i,
        unlockingScript: input.unlockingScript!,
        outputs: tx.outputs,
        inputSequence: input.sequence!,
        lockTime: tx.lockTime,
      }).validate();
    });

  test("pledges signed separately combine into one valid payment of the full price", async () => {
    const pledges = await Promise.all([500, 500].map((s, i) => pledge(s + PLEDGE_FEE, `bid ${i}`)));
    const inputs = await Promise.all(pledges.map(async (p) => ({
      sourceTransaction: p.tx, vout: 0, unlockingScript: await signPledge(p.wallet, p.keyID, outputs, p.tx, 0),
    })));
    const tx = groupTransaction(outputs, inputs);
    expect(spendsAll(tx)).toBe(true);
    expect(tx.outputs[0]!.satoshis).toBe(PRICE);
    expect(tx.getFee()).toBe(2 * PLEDGE_FEE);
  });

  test("a share is paid exactly from a bigger maximum: only the fee contributions reach the miners", async () => {
    const bids = await Promise.all([700, 400].map(denominatedPledge));
    const share = [600, 400];
    const inputs = await Promise.all(bids.flatMap((p, b) => {
      const values = p.tx.outputs.map((o) => o.satoshis! - PLEDGE_FEE);
      return pickDenominations(values, share[b]!)!.map(async (vout) => ({
        sourceTransaction: p.tx, vout, unlockingScript: await signPledge(p.wallet, p.keyID, outputs, p.tx, vout),
      }));
    }));
    const tx = groupTransaction(outputs, inputs);
    expect(spendsAll(tx)).toBe(true);
    expect(tx.outputs[0]!.satoshis).toBe(PRICE);
    expect(tx.getFee()).toBe(inputs.length * PLEDGE_FEE);
  });

  test("one pledge alone cannot pay: the outputs exceed its value", async () => {
    const p = await pledge(500 + PLEDGE_FEE);
    const tx = groupTransaction(outputs, [{ sourceTransaction: p.tx, vout: 0, unlockingScript: await signPledge(p.wallet, p.keyID, outputs, p.tx, 0) }]);
    expect(tx.getFee()).toBeLessThan(0);
  });
});

describe("refund", () => {
  test("the buyer's wallet can take a pledge back, and only allowed pledges", async () => {
    const p = await pledge(500 + PLEDGE_FEE);
    const to = await paymentLockingScript(sellerKey, prefix, suffix);
    const refund = await refundTransaction(p.wallet, [{ tx: p.tx, vout: 0, keyID: p.keyID }], to, PLEDGE_FEE);
    expect(refund.outputs[0]!.satoshis).toBe(500);
    const result = await parseRefund(refund.toAtomicBEEF(), new Set([`${p.tx.id("hex")}:0`]));
    expect("error" in result).toBe(false);
    expect(await parseRefund(refund.toAtomicBEEF(), new Set([`${p.tx.id("hex")}:1`]))).toHaveProperty("error");
  });
});

test("tag output is an OP_RETURN", () => {
  expect(tagLockingScript("offer").startsWith("006a")).toBe(true);
});
