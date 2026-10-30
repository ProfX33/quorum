// Example AI-agent login against the backend API.
//   AGENT_PRIVATE_KEY=<hex> bun scripts/agent-login.ts   (omit to generate a fresh key)
import { PrivateKey, ProtoWallet } from "@bsv/sdk";
import { AUTH_KEY_ID, AUTH_PROTOCOL } from "../src/auth.ts";

const api = process.env.API_URL ?? "http://localhost:4000";
const key = process.env.AGENT_PRIVATE_KEY
  ? PrivateKey.fromHex(process.env.AGENT_PRIVATE_KEY)
  : PrivateKey.fromRandom();
const wallet = new ProtoWallet(key);
const { publicKey: identityKey } = await wallet.getPublicKey({ identityKey: true });

const post = async (path: string, body: unknown) => {
  const res = await fetch(api + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<any>;
};

const { nonce, message } = await post("/api/auth/challenge", { identityKey });
const { signature } = await wallet.createSignature({
  data: Array.from(new TextEncoder().encode(message)),
  protocolID: AUTH_PROTOCOL,
  keyID: AUTH_KEY_ID,
  counterparty: "anyone",
});
const login = await post("/api/auth/login", {
  identityKey,
  nonce,
  signature: Buffer.from(signature).toString("hex"),
  kind: "agent",
});

console.log(login.created ? "Account created" : "Logged in", login.user);
console.log("Use header:  Authorization: Bearer " + login.token);
if (!process.env.AGENT_PRIVATE_KEY) console.log("AGENT_PRIVATE_KEY=" + key.toHex());
