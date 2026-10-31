import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "test", version: "0.1.0" });
const call = async (name: string, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  return { isError: result.isError, data: JSON.parse((result.content as { text: string }[])[0]!.text) };
};

beforeAll(() =>
  client.connect(new StdioClientTransport({
    command: "bun",
    args: [join(import.meta.dir, "mcp.ts"), "--wallet", "test"],
    env: {
      ...process.env,
      AGENT_WALLET_DIR: mkdtempSync(join(tmpdir(), "mcp-test-")),
      API_URL: "http://localhost:1", // No backend
      WOC_URL: "http://localhost:1",
    } as Record<string, string>,
  })),
);
afterAll(() => client.close());

test("offers the whole agent workflow", async () => {
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining([
    "search_offers", "quote_offer", "place_bid", "do_due_work", "confirm_delivery", "report_seller", "sell_data",
  ]));
  expect(tools.find((t) => t.name === "place_bid")!.annotations?.destructiveHint).toBe(true);
  expect(tools.find((t) => t.name === "search_offers")!.annotations?.readOnlyHint).toBe(true);
});

test("shows the wallet without a backend", async () => {
  const { data } = await call("wallet_status");
  expect(data.wallet).toBe("test");
  expect(data.identityKey).toMatch(/^0[23][0-9a-f]{64}$/);
  expect(data.balance).toBe(0);
});

test("answers a failure as a tool error, and keeps serving", async () => {
  const { isError, data } = await call("search_offers");
  expect(isError).toBe(true);
  expect(data.error).toBeString();
  expect((await call("wallet_status")).isError).toBeFalsy();
});

test("refuses malformed amounts before they reach the wallet", async () => {
  const { isError } = await client.callTool({
    name: "place_bid",
    arguments: { offerId: "00000000-0000-4000-8000-000000000000", maxPrice: -5 },
  }).catch(() => ({ isError: true }));
  expect(isError).toBe(true);
});
