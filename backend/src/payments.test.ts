import { describe, expect, test } from "bun:test";
import { KeyDeriver, LockingScript, MerklePath, P2PKH, PrivateKey, Transaction } from "@bsv/sdk";
import { ANYONE_KEY, BRC29_PROTOCOL, derivationNonce, parsePayment, paymentLockingScript, tagLockingScript } from "./payments.ts";

const seller = PrivateKey.fromRandom();
const sellerKey = seller.toPublicKey().toString();
const buyer = PrivateKey.fromRandom();
const prefix = derivationNonce();
const suffix = derivationNonce();

/** A payment from `buyer`, funded by a made-up mined parent transaction carried in the BEEF. */
async function payment(lockingScript: string, satoshis: number, signWith = buyer) {
  const parent = new Transaction();
  parent.addOutput({ lockingScript: new P2PKH().lock(buyer.toPublicKey().toHash()), satoshis: 10_000 });
  parent.merklePath = new MerklePath(1, [[{ offset: 0, hash: parent.id("hex"), txid: true }]]);
  const tx = new Transaction();
  tx.addInput({ sourceTransaction: parent, sourceOutputIndex: 0, unlockingScriptTemplate: new P2PKH().unlock(signWith) });
  tx.addOutput({ lockingScript: new P2PKH().lock(buyer.toPublicKey().toHash()), satoshis: 9_000 - satoshis });
  tx.addOutput({ lockingScript: LockingScript.fromHex(lockingScript), satoshis });
  await tx.sign();
  return tx.toAtomicBEEF();
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

describe("parsePayment", () => {
  test("accepts a signed transaction paying the seller", async () => {
    const script = await paymentLockingScript(sellerKey, prefix, suffix);
    const result = await parsePayment(await payment(script, 500), script, 500);
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.vout).toBe(1);
    expect(result.txid).toMatch(/^[0-9a-f]{64}$/);
  });

  test("rejects too little or a different recipient", async () => {
    const script = await paymentLockingScript(sellerKey, prefix, suffix);
    expect(await parsePayment(await payment(script, 499), script, 500)).toHaveProperty("error");
    const other = await paymentLockingScript(sellerKey, prefix, derivationNonce());
    expect(await parsePayment(await payment(other, 500), script, 500)).toHaveProperty("error");
  });

  test("rejects invalid signatures and garbage", async () => {
    const script = await paymentLockingScript(sellerKey, prefix, suffix);
    expect(await parsePayment(await payment(script, 500, PrivateKey.fromRandom()), script, 500)).toHaveProperty("error");
    expect(await parsePayment([1, 2, 3], script, 500)).toHaveProperty("error");
  });
});

test("tag output is an OP_RETURN", () => {
  expect(tagLockingScript("offer", "bid").startsWith("006a")).toBe(true);
});
