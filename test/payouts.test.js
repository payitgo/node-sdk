const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const http = require("node:http");
const { Payitgo, PayitgoError } = require("../dist");

const KEY = "8334dfeae25b9b200b75995e6e55cf8c3602120c1920bfef7a4ff8900b620881";

// Records each request and answers with the next queued [status, body].
async function fakeGateway(t, options = {}) {
  const requests = [];
  const replies = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : undefined });
      const [status, reply] = replies.shift() ?? [500, { error: "no reply queued" }];
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const payitgo = new Payitgo(KEY, { baseUrl: `http://127.0.0.1:${server.address().port}`, maxRetries: 0, ...options });
  return { payitgo, requests, reply: (status, body) => replies.push([status, body]) };
}

// A payout request waiting in the open list, as the gateway returns it.
const ITEM = {
  id: "4e6a8c0b2d4f6a1c3e5b7d9a",
  merchant_id: "3f8a1c27b94e05d6a2c71e90",
  livemode: false,
  batch_id: "7c2e9a4f1b3d5e8a0c6f2b4d",
  reference: "wd-1042",
  row: 3,
  recipient: { name: "Ana Silva", email: "ana@example.com" },
  asset: "USDT_TRC20",
  ticker: "USDT",
  icon_url: "https://api.payitgo.co/coins/USDT_TRC20.svg",
  chain: "tron",
  address: "TR7mNkucnhLZoJQLLJ6DR88jpLQufWxUJi",
  amount: "120",
  send_amount: "113.651787",
  fee: "6.348213",
  debit: "120",
  usd_rate: "1",
  amount_usd: "120",
  status: "ready",
  errors: [],
  warnings: [],
  created_at: "2026-10-20T09:15:01.88Z",
  updated_at: "2026-10-20T09:15:02.4Z",
};

const COUNTS = { total: 1, invalid: 0, ready: 1, cooling: 0, queued: 0, sending: 0, sent: 0, failed: 0, canceled: 0, claimable: 0, expired: 0 };
const TOTAL = {
  asset: "USDT_TRC20", ticker: "USDT", icon_url: "https://api.payitgo.co/coins/USDT_TRC20.svg", chain: "tron", network: "Tron (TRC-20)",
  items: 1, amount: "120", send_amount: "113.651787", fee: "6.348213", debit: "120",
  debit_usd: "120", saved_usd: "0",
};

const BATCH = {
  id: "6a1f3c8e2d9b4a7051c3e8f2",
  merchant_id: "3f8a1c27b94e05d6a2c71e90",
  livemode: false,
  reference: "payroll-2026-10",
  name: "October payroll",
  source: "api",
  inbox: false,
  open: false,
  created_by: "5e1a9c3d7b2f40e8a6c4d2b1",
  by_api_key: true,
  fee_paid_by: "merchant",
  convert: "same_network",
  status: "quoted",
  totals: [TOTAL],
  counts: COUNTS,
  total_usd: "120",
  quote_expires_at: "2026-10-20T10:15:02.41Z",
  approvals_needed: 0,
  approvals: [],
  created_at: "2026-10-20T09:15:01.87Z",
  updated_at: "2026-10-20T09:15:02.41Z",
};

// A submitted batch the wallet cannot cover yet.
const WAITING = {
  ...BATCH,
  status: "awaiting_funds",
  waiting: {
    reason: "funds",
    note: "top up the payout wallet: 120 USDT_TRC20 on Tron (TRC-20)",
    since: "2026-10-20T09:16:40.12Z",
    shortfall: [{ asset: "USDT_TRC20", network: "Tron (TRC-20)", amount: "120", address: "TMkq7dZ3vN8xR2pB6cH9sJ4fL1wY5tGaQe" }],
  },
  submitted_by: "5e1a9c3d7b2f40e8a6c4d2b1",
  submitted_at: "2026-10-20T09:16:40.09Z",
};

const WALLETS = [
  {
    chain: "tron",
    network: "Tron",
    address: "TMkq7dZ3vN8xR2pB6cH9sJ4fL1wY5tGaQe",
    livemode: false,
    assets: [
      { asset: "USDT_TRC20", ticker: "USDT", icon_url: "https://api.payitgo.co/coins/USDT_TRC20.svg", balance: "1000", reserved: "0", spendable: "1000", needed: "0" },
      { asset: "TRX", ticker: "TRX", icon_url: "https://api.payitgo.co/coins/TRX.svg", balance: "0", reserved: "0", spendable: "0", needed: "0" },
    ],
  },
];

// ── Payout requests ─────────────────────────────────────────────────────────

test("payouts.request posts the request and returns the payment: 201 new, 200 the one its reference names", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  const params = {
    reference: "wd-1042", asset: "USDT_TRC20", address: ITEM.address, amount: "120", name: "Ana Silva", email: "ana@example.com",
  };
  reply(201, { item: ITEM });
  assert.deepEqual(await payitgo.payouts.request(params), ITEM);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].url, "/v1/payouts");
  assert.equal(requests[0].headers.authorization, `Bearer ${KEY}`);
  assert.equal(requests[0].headers["content-type"], "application/json");
  assert.deepEqual(requests[0].body, params);
  // Sent again (a retry): the same payment, not a second one.
  reply(200, { item: ITEM });
  assert.deepEqual(await payitgo.payouts.request(params), ITEM);
  assert.deepEqual(requests[1].body, params);
  assert.equal(requests.length, 2);
});

test("payouts.request: an invalid request is kept and says why", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  const invalid = {
    ...ITEM, asset: "USDT_BEP20", chain: "bsc", status: "invalid", send_amount: "0", fee: "0", debit: "0",
    errors: [{ code: "wrong_network", field: "address", message: "this address is for Tron, not BNB Smart Chain", hint: "pay it in a coin of that network, or check the address" }],
  };
  reply(201, { item: invalid });
  const item = await payitgo.payouts.request({ asset: "USDT_BEP20", address: ITEM.address, amount: 120, tag: 7 });
  assert.deepEqual(requests[0].body, { asset: "USDT_BEP20", address: ITEM.address, amount: 120, tag: 7 });
  assert.equal(item.status, "invalid");
  assert.equal(item.errors[0].code, "wrong_network");
  assert.deepEqual(item.warnings, []);
});

test("payouts.retrieve reads a payment by id, escaped", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  reply(200, { item: ITEM });
  assert.deepEqual(await payitgo.payouts.retrieve(ITEM.id), ITEM);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].url, `/v1/payouts/${ITEM.id}`);
  assert.equal(requests[0].body, undefined);
  reply(200, { item: ITEM });
  await payitgo.payouts.retrieve("a b/c");
  assert.equal(requests[1].url, "/v1/payouts/a%20b%2Fc");
});

test("payouts.retrieveByReference reads a payment by your reference", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  reply(200, { item: ITEM });
  assert.deepEqual(await payitgo.payouts.retrieveByReference("wd-1042"), ITEM);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].url, "/v1/payouts?reference=wd-1042");
  reply(200, { item: ITEM });
  await payitgo.payouts.retrieveByReference("wd 1042/a&b");
  assert.equal(requests[1].url, "/v1/payouts?reference=wd+1042%2Fa%26b");
});

test("payouts.retrieveByReference: a reference no payment carries is a 404", async (t) => {
  const { payitgo, reply } = await fakeGateway(t);
  reply(404, { error: "not found" });
  await assert.rejects(payitgo.payouts.retrieveByReference("wd-9"), (e) => e instanceof PayitgoError && e.status === 404 && e.message === "not found");
});

test("payouts.retrieveByReference: a reference given back answers the latest payment that had it", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  const { reference, ...rest } = ITEM;
  const failed = { ...rest, status: "failed", fail_reason: "the address refused the transfer", released_reference: reference };
  reply(200, { item: failed });
  const item = await payitgo.payouts.retrieveByReference("wd-1042");
  assert.equal(requests[0].url, "/v1/payouts?reference=wd-1042");
  assert.deepEqual(item, failed);
  assert.equal(item.reference, undefined);
  assert.equal(item.released_reference, "wd-1042");
});

test("payouts.retrieveByReference: an empty reference is refused without a request, not read as a list", async (t) => {
  const { payitgo, requests } = await fakeGateway(t);
  await assert.rejects(payitgo.payouts.retrieveByReference(""), (e) => e instanceof PayitgoError && e.status === 400 && e.message === "payitgo: reference is required");
  assert.equal(requests.length, 0);
});

test("payouts.inbox returns the whole open list, with its filters", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  const { reference, quote_expires_at, ...list } = BATCH;
  const inbox = {
    inbox: { ...list, id: ITEM.batch_id, name: "Payout requests", source: "requests", inbox: true, open: true, created_by: "requests", by_api_key: false },
    coverage: [{ asset: "USDT_TRC20", ticker: "USDT", network: "Tron (TRC-20)", needed: "120", spendable: "100", top_up: "20", address: "TMkq7dZ3vN8xR2pB6cH9sJ4fL1wY5tGaQe" }],
    items: [ITEM],
    total: 1,
    limit: 50,
    offset: 0,
  };
  reply(200, inbox);
  assert.deepEqual(await payitgo.payouts.inbox(), inbox);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].url, "/v1/payouts/inbox");
  // Several statuses go comma-separated.
  reply(200, { ...inbox, limit: 10, offset: 20 });
  await payitgo.payouts.inbox({ status: ["ready", "invalid"], limit: 10, offset: 20 });
  assert.equal(requests[1].url, "/v1/payouts/inbox?status=ready%2Cinvalid&limit=10&offset=20");
  reply(200, inbox);
  await payitgo.payouts.inbox({ status: "invalid" });
  assert.equal(requests[2].url, "/v1/payouts/inbox?status=invalid");
  // An empty list of statuses is no filter.
  reply(200, inbox);
  await payitgo.payouts.inbox({ status: [] });
  assert.equal(requests[3].url, "/v1/payouts/inbox");
});

test("payouts.send sends every valid request, or those of ids, and returns the batch", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  const sent = { ...WAITING, source: "requests", inbox: true, name: "Payout requests of 20 Oct 2026 09:16 UTC" };
  reply(200, { batch: sent });
  assert.deepEqual(await payitgo.payouts.send(), sent);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].url, "/v1/payouts/send");
  assert.deepEqual(requests[0].body, {});
  reply(200, { batch: sent });
  await payitgo.payouts.send(["4e6a8c0b2d4f6a1c3e5b7d9a", "8b2d4f6a1c3e5a7b9d0f2c4e"]);
  assert.deepEqual(requests[1].body, { ids: ["4e6a8c0b2d4f6a1c3e5b7d9a", "8b2d4f6a1c3e5a7b9d0f2c4e"] });
});

test("payouts.send: an empty ids is refused without a request, not read as every request", async (t) => {
  const { payitgo, requests } = await fakeGateway(t);
  await assert.rejects(payitgo.payouts.send([]), (e) => e instanceof PayitgoError && e.status === 400 && /ids is empty/.test(e.message));
  assert.equal(requests.length, 0);
});

test("payouts.send: nothing valid to send is a 400", async (t) => {
  const { payitgo, reply } = await fakeGateway(t);
  reply(400, { error: "no valid payout request to send" });
  await assert.rejects(payitgo.payouts.send(), (e) => e instanceof PayitgoError && e.status === 400 && e.message === "no valid payout request to send");
});

// A payout request removed from the list: its record stays, without a batch.
const { batch_id: _batch, reference: _ref, ...UNLISTED } = ITEM;
const REMOVED = {
  ...UNLISTED,
  status: "canceled",
  released_reference: "wd-1042",
  cancel_reason: "removed",
  canceled_by: "5e1a9c3d7b2f40e8a6c4d2b1",
  canceled_at: "2026-10-20T09:20:11.5Z",
  members: { "5e1a9c3d7b2f40e8a6c4d2b1": "finance@acme.example" },
  updated_at: "2026-10-20T09:20:11.5Z",
};

test("payouts.cancel deletes the request and returns it canceled", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  reply(200, { item: REMOVED });
  const item = await payitgo.payouts.cancel(ITEM.id);
  assert.equal(requests[0].method, "DELETE");
  assert.equal(requests[0].url, `/v1/payouts/${ITEM.id}`);
  assert.equal(requests[0].body, undefined);
  assert.deepEqual(item, REMOVED);
  assert.equal(item.status, "canceled");
  assert.equal(item.cancel_reason, "removed");
  assert.equal(item.batch_id, undefined);
  assert.equal(item.members[item.canceled_by], "finance@acme.example");
  // Canceled already: answered as it is.
  reply(200, { item: REMOVED });
  assert.deepEqual(await payitgo.payouts.cancel(ITEM.id), REMOVED);
  reply(409, { error: "the payment is sent" });
  await assert.rejects(payitgo.payouts.cancel(ITEM.id), (e) => e instanceof PayitgoError && e.status === 409 && e.message === "the payment is sent");
});

test("payouts.remove posts the ids and returns a result per id", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  const sentAlready = "8b2d4f6a1c3e5a7b9d0f2c4e";
  const results = [
    { id: ITEM.id, item: REMOVED },
    { id: sentAlready, error: { status: 409, message: `not in your list of payout requests (sent already): cancel it with DELETE /v1/payouts/${sentAlready}` } },
    { id: "nope", error: { status: 404, message: "not found" } },
  ];
  reply(200, { results });
  const got = await payitgo.payouts.remove([ITEM.id, sentAlready, "nope"]);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].url, "/v1/payouts/remove");
  assert.equal(requests[0].headers.authorization, `Bearer ${KEY}`);
  assert.equal(requests[0].headers["content-type"], "application/json");
  assert.deepEqual(requests[0].body, { ids: [ITEM.id, sentAlready, "nope"] });
  assert.deepEqual(got, results);
  assert.equal(got[0].item.cancel_reason, "removed");
  assert.equal(got[0].item.released_reference, "wd-1042");
  assert.equal(got[0].error, undefined);
  assert.equal(got[1].item, undefined);
  assert.equal(got[1].error.status, 409);
  assert.equal(got[2].error.message, "not found");
});

test("payouts.remove: an empty ids is refused without a request", async (t) => {
  const { payitgo, requests } = await fakeGateway(t);
  await assert.rejects(payitgo.payouts.remove([]), (e) => e instanceof PayitgoError && e.status === 400 && /ids is empty/.test(e.message));
  await assert.rejects(payitgo.payouts.remove(), (e) => e instanceof PayitgoError && e.status === 400 && /ids is empty/.test(e.message));
  assert.equal(requests.length, 0);
});

test("payouts.remove: too many ids is a 400", async (t) => {
  const { payitgo, reply } = await fakeGateway(t);
  reply(400, { error: "remove between 1 and 1000 payout requests at a time" });
  await assert.rejects(
    payitgo.payouts.remove(Array.from({ length: 1001 }, (_, i) => `id-${i}`)),
    (e) => e instanceof PayitgoError && e.status === 400 && e.message === "remove between 1 and 1000 payout requests at a time",
  );
});

test("payouts.list sends its filters and returns the page", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  const page = { items: [ITEM, REMOVED], has_more: true, next_cursor: "MjAyNi0xMC0yMFQwOToyMDoxMS41Wnw0ZTZhOGMwYjJkNGY2YTFjM2U1YjdkOWE" };
  reply(200, page);
  const got = await payitgo.payouts.list();
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].url, "/v1/payouts");
  assert.equal(requests[0].body, undefined);
  assert.deepEqual(got, page);
  assert.equal(got.has_more, true);
  assert.equal(got.items[1].batch_id, undefined);
  // Several statuses go comma-separated; a Date goes as its ISO string.
  reply(200, page);
  await payitgo.payouts.list({
    status: ["sent", "failed", "canceled", "expired"],
    updated_since: new Date(Date.UTC(2026, 9, 20, 9, 0, 0)),
    limit: 200,
  });
  assert.equal(requests[1].url, "/v1/payouts?status=sent%2Cfailed%2Ccanceled%2Cexpired&updated_since=2026-10-20T09%3A00%3A00.000Z&limit=200");
  // A string time goes as given; then the cursor of the page before.
  reply(200, page);
  await payitgo.payouts.list({ status: "sent", updated_since: "2026-10-20T09:00:00Z" });
  assert.equal(requests[2].url, "/v1/payouts?status=sent&updated_since=2026-10-20T09%3A00%3A00Z");
  reply(200, { items: [], has_more: false });
  const last = await payitgo.payouts.list({ cursor: page.next_cursor, limit: 50 });
  assert.equal(requests[3].url, `/v1/payouts?cursor=${page.next_cursor}&limit=50`);
  assert.deepEqual(last, { items: [], has_more: false });
  assert.equal(last.next_cursor, undefined);
  // Unset filters are left out.
  reply(200, page);
  await payitgo.payouts.list({ status: [], updated_since: undefined, cursor: "", limit: null });
  assert.equal(requests[4].url, "/v1/payouts");
});

test("payouts.list: a cursor this API never gave is a 400", async (t) => {
  const { payitgo, reply } = await fakeGateway(t);
  reply(400, { error: "cursor is not one this API gave" });
  await assert.rejects(payitgo.payouts.list({ cursor: "x" }), (e) => e instanceof PayitgoError && e.status === 400 && e.message === "cursor is not one this API gave");
});

test("payouts.request and payoutBatches.create send each payment's webhook_url as given", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t, { webhookUrl: "https://acme.example/ipn" });
  const params = { reference: "wd-1042", asset: "USDT_TRC20", address: ITEM.address, amount: "120", webhook_url: "https://acme.example/withdrawals/ipn" };
  reply(201, { item: { ...ITEM, webhook_url: params.webhook_url } });
  const item = await payitgo.payouts.request(params);
  assert.deepEqual(requests[0].body, params);
  assert.equal(item.webhook_url, "https://acme.example/withdrawals/ipn");
  // The client's webhookUrl is never sent for a payment: it is payments.create's.
  reply(201, { batch: BATCH });
  await payitgo.payoutBatches.create({ webhook_url: "https://acme.example/payroll/ipn", items: [params, { asset: "TRX", address: ITEM.address, amount: 10 }] });
  assert.deepEqual(requests[1].body, { webhook_url: "https://acme.example/payroll/ipn", items: [params, { asset: "TRX", address: ITEM.address, amount: 10 }] });
});

test("payouts.quote prices payments without keeping them and returns quote and items", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  const { id, merchant_id, batch_id, created_at, updated_at, reference, ...quoted } = ITEM;
  const answer = {
    quote: { livemode: false, fee_paid_by: "recipient", totals: [TOTAL], total_usd: "120", counts: COUNTS },
    items: [{ ...quoted, row: 1, recipient: {} }],
  };
  reply(200, answer);
  const params = { fee_paid_by: "recipient", items: [{ asset: "USDT_TRC20", address: ITEM.address, amount: "120" }] };
  const result = await payitgo.payouts.quote(params);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].url, "/v1/payout-quotes");
  assert.deepEqual(requests[0].body, params);
  assert.deepEqual(result, answer);
  assert.equal(result.quote.total_usd, "120");
  assert.equal("id" in result.items[0], false);
});

// ── Batches ─────────────────────────────────────────────────────────────────

test("payoutBatches.create posts the batch: 201 new, 200 the batch its reference names", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  const params = {
    reference: "payroll-2026-10",
    name: "October payroll",
    fee_paid_by: "merchant",
    webhook_url: "https://acme.example/payouts/ipn",
    items: [{ reference: "payroll-2026-10-ana", asset: "USDT_TRC20", address: ITEM.address, amount: "120", name: "Ana Silva", note: "October salary" }],
  };
  reply(201, { batch: BATCH });
  assert.deepEqual(await payitgo.payoutBatches.create(params), BATCH);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].url, "/v1/payout-batches");
  assert.equal(requests[0].headers["content-type"], "application/json");
  assert.deepEqual(requests[0].body, params);
  reply(200, { batch: BATCH });
  assert.deepEqual(await payitgo.payoutBatches.create(params), BATCH);
  assert.equal(requests.length, 2);
});

test("payoutBatches.create sends no webhook_url of the client's: that default is payments.create's", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t, { webhookUrl: "https://acme.example/ipn" });
  reply(201, { batch: BATCH });
  await payitgo.payoutBatches.create({ items: [{ asset: "TRX", address: ITEM.address, amount: 10 }] });
  assert.deepEqual(requests[0].body, { items: [{ asset: "TRX", address: ITEM.address, amount: 10 }] });
});

test("payoutBatches.list sends its filters and returns the whole list", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  const list = { batches: [WAITING], total: 41, limit: 20, offset: 40 };
  reply(200, list);
  assert.deepEqual(await payitgo.payoutBatches.list({ status: "awaiting_funds", limit: 20, offset: 40 }), list);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].url, "/v1/payout-batches?status=awaiting_funds&limit=20&offset=40");
  reply(200, { batches: [], total: 0, limit: 50, offset: 0 });
  await payitgo.payoutBatches.list();
  assert.equal(requests[1].url, "/v1/payout-batches");
});

test("payoutBatches.retrieve reads a batch", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  reply(200, { batch: WAITING });
  const batch = await payitgo.payoutBatches.retrieve(BATCH.id);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].url, `/v1/payout-batches/${BATCH.id}`);
  assert.deepEqual(batch, WAITING);
  assert.equal(batch.waiting.shortfall[0].amount, "120");
});

test("payoutBatches.items lists a batch's payments, with one status or several", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  const list = { items: [ITEM], total: 1, limit: 50, offset: 0 };
  reply(200, list);
  assert.deepEqual(await payitgo.payoutBatches.items(BATCH.id), list);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].url, `/v1/payout-batches/${BATCH.id}/items`);
  reply(200, list);
  await payitgo.payoutBatches.items(BATCH.id, { status: ["sent", "failed"], limit: 100 });
  assert.equal(requests[1].url, `/v1/payout-batches/${BATCH.id}/items?status=sent%2Cfailed&limit=100`);
  reply(200, list);
  await payitgo.payoutBatches.items("b 1", { status: "invalid" });
  assert.equal(requests[2].url, "/v1/payout-batches/b%201/items?status=invalid");
});

test("payoutBatches.addItems posts the payments and returns the batch", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  const items = [{ reference: "payroll-2026-10-ben", asset: "USDT_BEP20", address: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", amount: "250" }];
  reply(200, { batch: BATCH });
  assert.deepEqual(await payitgo.payoutBatches.addItems(BATCH.id, items), BATCH);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].url, `/v1/payout-batches/${BATCH.id}/items`);
  assert.deepEqual(requests[0].body, { items });
});

for (const action of ["quote", "submit", "cancel"]) {
  test(`payoutBatches.${action} posts with no body and returns the batch`, async (t) => {
    const { payitgo, requests, reply } = await fakeGateway(t);
    reply(200, { batch: WAITING });
    assert.deepEqual(await payitgo.payoutBatches[action](BATCH.id), WAITING);
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].url, `/v1/payout-batches/${BATCH.id}/${action}`);
    assert.equal(requests[0].headers.authorization, `Bearer ${KEY}`);
    assert.equal(requests[0].headers["content-type"], undefined);
    assert.equal(requests[0].body, undefined);
  });
}

test("payoutBatches.submit: expired prices are a 409", async (t) => {
  const { payitgo, reply } = await fakeGateway(t);
  reply(409, { error: "its prices expired: get a new quote first" });
  await assert.rejects(payitgo.payoutBatches.submit(BATCH.id), (e) => {
    assert.ok(e instanceof PayitgoError);
    assert.equal(e.status, 409);
    assert.equal(e.message, "its prices expired: get a new quote first");
    return true;
  });
});

test("a key without payouts is a 403", async (t) => {
  const { payitgo, reply } = await fakeGateway(t);
  const message = "this api key cannot make payouts: turn payouts on for it in the dashboard";
  reply(403, { error: message });
  await assert.rejects(payitgo.payoutBatches.create({ items: [] }), (e) => e instanceof PayitgoError && e.status === 403 && e.message === message);
});

// ── Wallets ─────────────────────────────────────────────────────────────────

test("payoutWallets.list returns the wallets", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  reply(200, { wallets: WALLETS });
  assert.deepEqual(await payitgo.payoutWallets.list(), WALLETS);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].url, "/v1/payout-wallets");
  assert.equal(requests[0].body, undefined);
});

test("payoutWallets.simulateTopUp posts the amount and returns the wallets", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  reply(200, { wallets: WALLETS });
  assert.deepEqual(await payitgo.payoutWallets.simulateTopUp("USDT_TRC20", "1000"), WALLETS);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].url, "/v1/payout-wallets/USDT_TRC20/simulate-top-up");
  assert.equal(requests[0].headers["content-type"], "application/json");
  assert.deepEqual(requests[0].body, { amount: "1000" });
  reply(200, { wallets: WALLETS });
  await payitgo.payoutWallets.simulateTopUp("USDT TRC20", 5);
  assert.equal(requests[1].url, "/v1/payout-wallets/USDT%20TRC20/simulate-top-up");
  assert.deepEqual(requests[1].body, { amount: 5 });
});

test("payoutWallets.simulateTopUp: a live key is a 400", async (t) => {
  const { payitgo, reply } = await fakeGateway(t);
  reply(400, { error: "only a test wallet is topped up on paper: use a test key" });
  await assert.rejects(payitgo.payoutWallets.simulateTopUp("USDT_TRC20", 1000), (e) => e instanceof PayitgoError && e.status === 400);
});

// ── Webhooks ────────────────────────────────────────────────────────────────

test("a payout_item.sent event verifies and carries the payment", () => {
  const secret = "ab".repeat(32);
  const body = JSON.stringify({
    id: "9d1f3b5a7c2e4d6f8a0b1c2d", type: "payout_item.sent", livemode: false, created_at: "2026-10-20T09:31:13Z",
    data: { ...ITEM, status: "sent", tx_id: "3c9f1a7e5b2d8c4f6a0e9b3d7c1f5a2e8b4d0c6f9a3e7b1d5c8f2a6e0b4d9c3f", sent_at: "2026-10-20T09:31:12.6Z" },
  });
  const t = Math.floor(Date.now() / 1000);
  const header = `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
  const event = new Payitgo(KEY, { baseUrl: "http://x", webhookSecret: secret }).webhooks.constructEvent(body, header);
  assert.equal(event.type, "payout_item.sent");
  assert.equal(event.data.reference, "wd-1042");
  assert.equal(event.data.status, "sent");
});

// ── Claim links, conversion, schedules ──────────────────────────────────────

const SECRET = "ab".repeat(32);
function signedEvent(type, data) {
  const body = JSON.stringify({ id: "9d1f3b5a7c2e4d6f8a0b1c2d", type, livemode: false, created_at: "2026-10-20T09:31:13Z", data });
  const t = Math.floor(Date.now() / 1000);
  const header = `t=${t},v1=${crypto.createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex")}`;
  return new Payitgo(KEY, { baseUrl: "http://x", webhookSecret: SECRET }).webhooks.constructEvent(body, header);
}

// A claim link funded and waiting for its recipient.
const CLAIM_ITEM = {
  ...ITEM,
  reference: "prize-cup-1",
  recipient: { name: "Player One", email: "player@example.com" },
  address: "",
  status: "claimable",
  claim: {
    email: "player@example.com",
    assets: ["USDT_BEP20", "BTC"],
    expires_at: "2026-11-19T09:20:00Z",
    emailed: 1,
    last_email_at: "2026-10-20T09:20:01Z",
    extended: 0,
    url: "https://payitgo.co/claim/Zq3xT7m1Lw9vRk2sYc4bNf8hJd6pGa0E",
  },
};

test("payouts.request sends a claim link's fields as given and returns its claim", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  // claim_assets makes it a claim link (as claim: true does); the email gets the link.
  const params = { reference: "prize-cup-1", asset: "USDT_TRC20", amount: "120", email: "player@example.com", claim_assets: ["USDT_BEP20", "BTC"] };
  reply(201, { item: CLAIM_ITEM });
  const item = await payitgo.payouts.request(params);
  assert.deepEqual(requests[0].body, params);
  assert.equal("address" in requests[0].body, false);
  assert.deepEqual(item, CLAIM_ITEM);
  assert.equal(item.status, "claimable");
  assert.equal(item.claim.url, CLAIM_ITEM.claim.url);
  assert.deepEqual(item.claim.assets, ["USDT_BEP20", "BTC"]);
  assert.equal(item.claim.emailed, 1);
  // claim: true without an email: a link you share yourself.
  const shared = { ...CLAIM_ITEM, recipient: {}, claim: { assets: [], emailed: 0, extended: 0, url: CLAIM_ITEM.claim.url } };
  reply(201, { item: shared });
  const own = await payitgo.payouts.request({ reference: "prize-cup-2", asset: "USDT_TRC20", amount: 50, claim: true });
  assert.deepEqual(requests[1].body, { reference: "prize-cup-2", asset: "USDT_TRC20", amount: 50, claim: true });
  assert.equal(own.claim.email, undefined);
  assert.deepEqual(own.claim.assets, []);
});

test("a claimed link in another coin keeps what it was funded with", async (t) => {
  const { payitgo, reply } = await fakeGateway(t);
  const claimed = {
    ...CLAIM_ITEM,
    asset: "USDT_BEP20", chain: "bsc", address: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", status: "queued",
    claim: { ...CLAIM_ITEM.claim, claimed_at: "2026-10-21T08:00:00Z", funded_asset: "USDT_TRC20", funded_amount: "120" },
  };
  reply(200, { item: claimed });
  const item = await payitgo.payouts.retrieve(CLAIM_ITEM.id);
  assert.deepEqual(item, claimed);
  assert.equal(item.claim.funded_asset, "USDT_TRC20");
  assert.equal(item.claim.funded_amount, "120");
});

// A payment in BTC, paid from the wallet's USDT on Tron and converted on its way.
const CONVERTED = {
  ...ITEM,
  reference: "wd-2001",
  asset: "USDT_TRC20",
  address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
  amount: "130",
  send_amount: "133.12",
  fee: "6.022417",
  debit: "136.022417",
  amount_usd: "130",
  convert: { to: "BTC", ticker: "BTC", network: "Bitcoin", to_amount: "0.002", estimate: "0.00200041" },
};

test("payoutBatches.create sends convert and convert_from, and a converted payment decodes", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  const params = {
    reference: "wd-batch-7", convert: "convert", convert_from: "USDT_TRC20",
    items: [{ reference: "wd-2001", asset: "BTC", address: CONVERTED.address, amount: "0.002" }],
  };
  const batch = { ...BATCH, reference: "wd-batch-7", convert: "convert", convert_from: "USDT_TRC20", quote_expires_at: "2026-10-20T09:30:02.41Z" };
  reply(201, { batch });
  const made = await payitgo.payoutBatches.create(params);
  assert.deepEqual(requests[0].body, params);
  assert.equal(made.convert, "convert");
  assert.equal(made.convert_from, "USDT_TRC20");
  reply(200, { items: [CONVERTED], total: 1, limit: 50, offset: 0 });
  const { items } = await payitgo.payoutBatches.items(batch.id);
  assert.deepEqual(items[0], CONVERTED);
  assert.equal(items[0].convert.to, "BTC");
  assert.equal(items[0].convert.estimate, "0.00200041");
  assert.equal(items[0].fee, "6.022417");
  // Once sent: what arrived.
  reply(200, { item: { ...CONVERTED, status: "sent", convert: { ...CONVERTED.convert, amount_out: "0.00200113" } } });
  assert.equal((await payitgo.payouts.retrieve(CONVERTED.id)).convert.amount_out, "0.00200113");
});

test("payouts.quote sends convert and convert_from as given", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  const { id, merchant_id, batch_id, created_at, updated_at, ...quoted } = CONVERTED;
  reply(200, { quote: { livemode: false, fee_paid_by: "merchant", totals: [TOTAL], total_usd: "136.02", counts: COUNTS }, items: [quoted] });
  const params = { convert: "convert", convert_from: "USDT_TRC20", items: [{ asset: "BTC", address: CONVERTED.address, amount: "0.002" }] };
  const { items } = await payitgo.payouts.quote(params);
  assert.deepEqual(requests[0].body, params);
  assert.equal(items[0].convert.to_amount, "0.002");
});

test("a schedule's batch: source schedule, claimable and expired counts", async (t) => {
  const { payitgo, reply } = await fakeGateway(t);
  const scheduled = { ...BATCH, source: "schedule", status: "completed", counts: { ...COUNTS, total: 3, ready: 0, sent: 1, claimable: 1, expired: 1 } };
  reply(200, { batches: [scheduled], total: 1, limit: 50, offset: 0 });
  const { batches } = await payitgo.payoutBatches.list();
  assert.deepEqual(batches[0], scheduled);
  assert.equal(batches[0].source, "schedule");
  assert.equal(batches[0].counts.claimable, 1);
  assert.equal(batches[0].counts.expired, 1);
});

test("payout_item.claimed and payout_item.claim_expired events carry the payment", () => {
  const claimed = signedEvent("payout_item.claimed", { ...CLAIM_ITEM, status: "queued", claim: { ...CLAIM_ITEM.claim, claimed_at: "2026-10-21T08:00:00Z" } });
  assert.equal(claimed.type, "payout_item.claimed");
  assert.equal(claimed.data.claim.claimed_at, "2026-10-21T08:00:00Z");
  const { reference, ...rest } = CLAIM_ITEM;
  const expired = signedEvent("payout_item.claim_expired", { ...rest, status: "expired", released_reference: reference });
  assert.equal(expired.type, "payout_item.claim_expired");
  assert.equal(expired.data.status, "expired");
  assert.equal(expired.data.released_reference, "prize-cup-1");
  assert.equal(expired.data.reference, undefined);
});

// A schedule as its webhooks carry it: a summary, without its rows.
const SCHEDULE = {
  id: "2b4d6f8a0c1e3a5b7d9f1c3e",
  livemode: false,
  name: "Monthly payroll",
  status: "active",
  cadence: "monthly",
  weekday: 0,
  day: -1,
  at: "09:00",
  timezone: "Africa/Harare",
  fee_paid_by: "merchant",
  auto_submit: true,
  remind_days: 3,
  totals: [{ asset: "USDT_TRC20", ticker: "USDT", items: 1, amount: "1500" }],
  next_run_at: "2026-11-30T07:00:00Z",
  last_run_at: "2026-10-31T07:00:00Z",
  last_batch_id: BATCH.id,
  last_error: "",
  runs: 4,
};

test("payout_schedule.run and payout_schedule.funding_needed events carry the schedule", () => {
  const run = signedEvent("payout_schedule.run", SCHEDULE);
  assert.equal(run.type, "payout_schedule.run");
  assert.deepEqual(run.data, SCHEDULE);
  assert.equal(run.data.last_batch_id, BATCH.id);
  assert.equal("items" in run.data, false);
  const shortfall = [{ asset: "USDT_TRC20", network: "Tron (TRC-20)", amount: "1513.25", address: "TMkq7dZ3vN8xR2pB6cH9sJ4fL1wY5tGaQe" }];
  const funding = signedEvent("payout_schedule.funding_needed", { schedule: { ...SCHEDULE, last_run_at: null, runs: 0, last_batch_id: "" }, shortfall });
  assert.equal(funding.type, "payout_schedule.funding_needed");
  assert.equal(funding.data.schedule.name, "Monthly payroll");
  assert.equal(funding.data.schedule.last_run_at, null);
  assert.deepEqual(funding.data.shortfall, shortfall);
});

// ── Round trip: every payment's end, and the events around it ───────────────

test("payout_item.processing and payout_item.returned events carry the payment", () => {
  const processing = signedEvent("payout_item.processing", { ...ITEM, batch_id: BATCH.id });
  assert.equal(processing.type, "payout_item.processing");
  assert.equal(processing.data.status, "ready");
  assert.equal(processing.data.batch_id, BATCH.id);
  const errors = [{ code: "below_minimum", field: "amount", message: "the smallest USDT_TRC20 payout is 7.2 right now" }];
  const returned = signedEvent("payout_item.returned", { ...ITEM, status: "invalid", errors });
  assert.equal(returned.type, "payout_item.returned");
  assert.equal(returned.data.batch_id, ITEM.batch_id);
  assert.equal(returned.data.status, "invalid");
  assert.deepEqual(returned.data.errors, errors);
});

test("payout_item.canceled carries why, by whom and when", () => {
  const { reference, ...rest } = ITEM;
  const rejected = signedEvent("payout_item.canceled", {
    ...rest,
    batch_id: BATCH.id,
    status: "canceled",
    released_reference: reference,
    cancel_reason: "rejected",
    cancel_note: "paid by bank transfer instead",
    canceled_by: "5e1a9c3d7b2f40e8a6c4d2b1",
    canceled_at: "2026-10-20T15:02:44.3Z",
    members: { "5e1a9c3d7b2f40e8a6c4d2b1": "finance@acme.example" },
    fee_credit: "0.6",
    webhook_url: "https://acme.example/withdrawals/ipn",
  });
  assert.equal(rejected.data.cancel_reason, "rejected");
  assert.equal(rejected.data.cancel_note, "paid by bank transfer instead");
  assert.equal(rejected.data.members[rejected.data.canceled_by], "finance@acme.example");
  assert.equal(rejected.data.released_reference, "wd-1042");
  assert.equal(rejected.data.fee_credit, "0.6");
  assert.equal(rejected.data.webhook_url, "https://acme.example/withdrawals/ipn");
  const removed = signedEvent("payout_item.canceled", REMOVED);
  assert.equal(removed.data.cancel_reason, "removed");
  assert.equal(removed.data.batch_id, undefined);
  const invalid = signedEvent("payout_item.canceled", { ...REMOVED, batch_id: BATCH.id, cancel_reason: "invalid", canceled_by: "system", members: undefined });
  assert.equal(invalid.data.canceled_by, "system");
  assert.equal(invalid.data.members, undefined);
});

test("payout_wallet.withdrawal_failed carries the withdrawal and why", () => {
  const withdrawal = {
    id: "1c3e5a7b9d2f4a6c8e0b2d4f",
    merchant_id: "3f8a1c27b94e05d6a2c71e90",
    livemode: false,
    asset: "USDT_TRC20",
    chain: "tron",
    amount: "500",
    fee: "1.5",
    send_amount: "498.5",
    address_id: "7d9f1b3e5a2c4e6a8c0d2f4b",
    address: "TR7mNkucnhLZoJQLLJ6DR88jpLQufWxUJi",
    status: "failed",
    fail_reason: "the transfer was not confirmed in time",
    requested_by: "5e1a9c3d7b2f40e8a6c4d2b1",
    created_at: "2026-10-20T10:00:00Z",
    updated_at: "2026-10-20T10:40:00Z",
  };
  const event = signedEvent("payout_wallet.withdrawal_failed", withdrawal);
  assert.equal(event.type, "payout_wallet.withdrawal_failed");
  assert.deepEqual(event.data, withdrawal);
  assert.equal(event.data.status, "failed");
  assert.equal(event.data.fail_reason, "the transfer was not confirmed in time");
});
