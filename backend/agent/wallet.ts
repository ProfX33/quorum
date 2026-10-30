import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { KeyDeriver, LockingScript, P2PKH, PrivateKey, ProtoWallet, SatoshisPerKilobyte, Transaction, Utils } from "@bsv/sdk";
import { ANYONE_KEY, BRC29_PROTOCOL, NETWORK } from "../src/payments.ts";

// A wallet for agents, which have no BSV Desktop to talk to. It does what createAction and
// internalizeAction do in a BRC-100 wallet: it keeps the outputs it can spend, each with the
// AtomicBEEF that proves it, and funds new transactions from them. Non-custodial like the
// browser flow: the key stays in this file on the agent's machine and is never sent anywhere.
// One wallet file belongs to one process at a time.

// Satoshis kept aside for the mining fee of a funding transaction.
const FEE_MARGIN = 200;
const FEE_RATE = 100; // satoshis per kilobyte

export type Utxo = {
  txid: string;
  vout: number;
  satoshis: number;
  beef: string; // AtomicBEEF hex of the transaction creating the output
  keyID?: string; // BRC-29 derivation of a received payment; absent for the wallet's own key
};

type State = {
  privateKey: string;
  utxos: Utxo[];
  // Outpoints this wallet spent, which the chain service may not know about yet.
  spent: string[];
  // Signed pledges and refunds until the server has answered, so a crash never signs twice.
  pending: Record<string, any>;
};

const outpoint = (u: { txid: string; vout: number }) => `${u.txid}:${u.vout}`;
const wocUrl = () => (process.env.WOC_URL ?? `https://api.whatsonchain.com/v1/bsv/${NETWORK}`).replace(/\/+$/, "");

export const walletDir = () => process.env.AGENT_WALLET_DIR ?? join(import.meta.dir, "..", ".agent-wallets");

export class AgentWallet {
  readonly proto: ProtoWallet;
  readonly key: PrivateKey;
  private readonly deriver: KeyDeriver;

  private constructor(private readonly path: string, private state: State) {
    this.key = PrivateKey.fromHex(state.privateKey);
    this.deriver = new KeyDeriver(this.key);
    this.proto = new ProtoWallet(this.key);
  }

  /** Opens the wallet `name`; the first time, from AGENT_PRIVATE_KEY or a new random key. */
  static open(name: string) {
    if (!/^[\w-]+$/.test(name)) throw new Error("Wallet names may only use letters, digits, - and _");
    const path = join(walletDir(), `${name}.json`);
    if (existsSync(path)) return new AgentWallet(path, JSON.parse(readFileSync(path, "utf8")));
    const key = process.env.AGENT_PRIVATE_KEY ? PrivateKey.fromHex(process.env.AGENT_PRIVATE_KEY) : PrivateKey.fromRandom();
    const wallet = new AgentWallet(path, { privateKey: key.toHex(), utxos: [], spent: [], pending: {} });
    wallet.save();
    return wallet;
  }

  private save() {
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    renameSync(temp, this.path);
    chmodSync(this.path, 0o600);
  }

  get identityKey() {
    return this.key.toPublicKey().toString();
  }

  /** Where to send the agent's funds. */
  get address() {
    return this.key.toPublicKey().toAddress(NETWORK === "test" ? "testnet" : "mainnet");
  }

  get balance() {
    return this.state.utxos.reduce((sum, u) => sum + u.satoshis, 0);
  }

  pending(id: string) {
    return this.state.pending[id];
  }

  setPending(id: string, value: unknown) {
    if (value === undefined) delete this.state.pending[id];
    else this.state.pending[id] = value;
    this.save();
  }

  /** For undoing a transaction the network never got: see restore. */
  snapshot() {
    return structuredClone(this.state);
  }

  restore(state: State) {
    this.state = state;
    this.save();
  }

  /** The private key of a BRC-29 payment to this wallet from the public "anyone" sender. */
  private paymentKey(keyID: string) {
    return this.deriver.derivePrivateKey(BRC29_PROTOCOL, keyID, ANYONE_KEY);
  }

  /** Takes an output of `tx` into the balance: the agent's internalizeAction. */
  receive(tx: Transaction, vout: number, keyID?: string) {
    const utxo = { txid: tx.id("hex"), vout };
    if (this.state.utxos.some((u) => outpoint(u) === outpoint(utxo)) || this.state.spent.includes(outpoint(utxo))) return;
    const output = tx.outputs[vout];
    const key = keyID ? this.paymentKey(keyID) : this.key;
    if (output?.lockingScript.toHex() !== new P2PKH().lock(key.toPublicKey().toHash()).toHex()) {
      throw new Error(`Output ${vout} of ${utxo.txid} does not pay this wallet`);
    }
    this.state.utxos.push({ ...utxo, satoshis: output.satoshis!, beef: Utils.toHex(tx.toAtomicBEEF()), ...(keyID ? { keyID } : {}) });
    this.save();
  }

  /** Picks up what was sent to the wallet's address, with the proofs from WhatsOnChain. */
  async sync() {
    const res = await fetch(`${wocUrl()}/address/${this.address}/unspent/all`, { signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) return;
    if (!res.ok) throw new Error(`WhatsOnChain answered ${res.status}`);
    const { result }: any = await res.json();
    for (const u of result ?? []) {
      const found = { txid: u.tx_hash as string, vout: u.tx_pos as number };
      if (u.isSpentInMempoolTx || this.state.spent.includes(outpoint(found))) continue;
      if (this.state.utxos.some((known) => outpoint(known) === outpoint(found))) continue;
      const beef = await fetch(`${wocUrl()}/tx/${found.txid}/beef`, { signal: AbortSignal.timeout(10_000) });
      if (!beef.ok) throw new Error(`No proof for ${found.txid} yet (WhatsOnChain answered ${beef.status})`);
      this.receive(Transaction.fromHexBEEF((await beef.text()).trim(), found.txid), found.vout);
    }
  }

  /**
   * Builds and signs a transaction with `outputs` first, and the change back to the wallet
   * after them. The inputs count as spent from here on; restore a snapshot if
   * the transaction turns out never to reach the network.
   */
  async createAction(outputs: { lockingScript: string; satoshis: number }[]) {
    await this.sync().catch((e) => console.error(`Could not check for new funds: ${e.message}`));
    const need = outputs.reduce((sum, o) => sum + o.satoshis, 0) + FEE_MARGIN;
    const picked: Utxo[] = [];
    for (const u of [...this.state.utxos].sort((a, b) => b.satoshis - a.satoshis)) {
      if (picked.reduce((sum, p) => sum + p.satoshis, 0) >= need) break;
      picked.push(u);
    }
    if (picked.reduce((sum, p) => sum + p.satoshis, 0) < need) {
      throw new Error(`Not enough funds: need ${need} sats, have ${this.balance}. Fund ${this.address}`);
    }

    const tx = new Transaction();
    for (const u of picked) {
      tx.addInput({
        sourceTransaction: Transaction.fromAtomicBEEF(Utils.toArray(u.beef, "hex")),
        sourceOutputIndex: u.vout,
        unlockingScriptTemplate: new P2PKH().unlock(u.keyID ? this.paymentKey(u.keyID) : this.key),
      });
    }
    for (const o of outputs) tx.addOutput({ lockingScript: LockingScript.fromHex(o.lockingScript), satoshis: o.satoshis });
    tx.addOutput({ lockingScript: new P2PKH().lock(this.key.toPublicKey().toHash()), change: true });
    await tx.fee(new SatoshisPerKilobyte(FEE_RATE));
    await tx.sign();

    this.state.spent.push(...picked.map(outpoint));
    this.state.utxos = this.state.utxos.filter((u) => !picked.includes(u));
    this.save();
    this.receive(tx, outputs.length);
    return tx;
  }
}
