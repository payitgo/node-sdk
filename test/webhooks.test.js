const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const { Payitgo, PayitgoError, webhooks, SignatureVerificationError } = require("../dist");

const KEY = "8334dfeae25b9b200b75995e6e55cf8c3602120c1920bfef7a4ff8900b620881";

// Signed by the gateway's own signer.
const SECRET = "05bd6b428158318cc38756fa34aa60795af0fc5d9a316dcc9b060c8ca1863fc3";
const HEADER = "t=1760000000,v1=75eb20fb34bccab4b9121285930b076e5e60ccad0a2542bd76eb56d89744faed";
const BODY = '{"id":"b8e1f80bd70ae0784c7855a4","type":"payment.confirmed","livemode":false,"created_at":"2026-10-09T12:00:00Z","data":{"id":"040ffd5925d40e11c67b7238","order_id":"ORD-1","status":"confirmed","usd_amount":"10"}}';
const OTHER_SECRET = "bd4106123e659e259c401119d0c7ef0a221df306a5a414b6fb6a579499962d26";

const sign = (secret, t, body) =>
  `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

test("accepts a delivery signed by the gateway", () => {
  const event = webhooks.constructEvent(BODY, HEADER, SECRET, 0);
  assert.equal(event.type, "payment.confirmed");
  assert.equal(event.data.order_id, "ORD-1");
  assert.equal(event.livemode, false);
});

test("accepts a Buffer body", () => {
  assert.equal(webhooks.constructEvent(Buffer.from(BODY), HEADER, SECRET, 0).id, "b8e1f80bd70ae0784c7855a4");
});

test("rejects a changed body", () => {
  assert.throws(() => webhooks.constructEvent(BODY.replace('"10"', '"1000"'), HEADER, SECRET, 0), SignatureVerificationError);
});

test("rejects the wrong secret", () => {
  assert.throws(() => webhooks.constructEvent(BODY, HEADER, OTHER_SECRET, 0), SignatureVerificationError);
});

test("rejects a missing header", () => {
  assert.throws(() => webhooks.constructEvent(BODY, undefined, SECRET), SignatureVerificationError);
});

test("rejects an old timestamp, accepts a fresh one", () => {
  assert.throws(() => webhooks.constructEvent(BODY, HEADER, SECRET), SignatureVerificationError);
  const now = Math.floor(Date.now() / 1000);
  assert.equal(webhooks.constructEvent(BODY, sign(SECRET, now, BODY), SECRET).id, "b8e1f80bd70ae0784c7855a4");
});

test("client checks the key and the base URL", () => {
  assert.throws(() => new Payitgo("", { baseUrl: "http://x" }), /API key is required/);
  assert.throws(() => new Payitgo("  ", { baseUrl: "http://x" }), /API key is required/);
  assert.throws(() => new Payitgo(undefined, { baseUrl: "http://x" }), /API key is required/);
  delete process.env.PAYITGO_BASE_URL;
  assert.throws(() => new Payitgo(KEY, { baseUrl: "" }), /baseUrl/);
  assert.equal("livemode" in new Payitgo(KEY, { baseUrl: "http://x" }), false);
});

// ── The webhook (IPN), against a fake gateway on 127.0.0.1 ──────────────────

const http = require("node:http");

const WEBHOOK = {
  livemode: false,
  url: "https://shop.example/payitgo/ipn",
  secret: "ab".repeat(32),
  created_at: "2026-10-10T09:00:00Z",
  updated_at: "2026-10-10T09:05:00Z",
};
const DELIVERY = {
  id: "whd_1",
  merchant_id: "mch_1",
  target: "account",
  url: WEBHOOK.url,
  event_id: "evt_1",
  event_type: "ping",
  payload: '{"id":"evt_1","type":"ping"}',
  status: "pending",
  attempts: 0,
  max_attempts: 7,
  next_attempt_at: "2026-10-10T12:00:00Z",
  created_at: "2026-10-10T12:00:00Z",
};

// Records each request and answers with the next queued [status, body], or
// echoes a created payment's body back as the payment.
async function fakeGateway(t, options = {}) {
  const requests = [];
  const replies = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      const [status, reply] =
        replies.shift() ??
        (req.url === "/v1/payments" ? [201, { id: "pay_1", status: "pending", ...body }] : [500, { error: "no reply queued" }]);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const payitgo = new Payitgo(KEY, { baseUrl: `http://127.0.0.1:${server.address().port}/`, maxRetries: 0, ...options });
  return { payitgo, requests, reply: (status, body) => replies.push([status, body]) };
}

test("webhooks.get reads the mode's webhook", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  reply(200, { webhook: WEBHOOK });
  assert.deepEqual(await payitgo.webhooks.get(), WEBHOOK);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].url, "/v1/webhook");
  assert.equal(requests[0].headers.authorization, `Bearer ${KEY}`);
  assert.equal(requests[0].body, undefined);
});

test("isLive asks payitgo once: a live key", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  reply(200, { webhook: { ...WEBHOOK, livemode: true } });
  assert.equal(await payitgo.isLive(), true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].url, "/v1/webhook");
  assert.equal(requests[0].headers.authorization, `Bearer ${KEY}`);
  // The second call does not ask again (no reply is queued: asking would fail).
  assert.equal(await payitgo.isLive(), true);
  assert.equal(requests.length, 1);
});

test("isLive asks payitgo once: a test key", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  reply(200, { webhook: WEBHOOK });
  assert.equal(await payitgo.isLive(), false);
  assert.equal(await payitgo.isLive(), false);
  assert.equal(requests.length, 1);
});

test("isLive: a key payitgo refuses is a PayitgoError, and is asked again next time", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  reply(401, { error: "invalid API key" });
  await assert.rejects(payitgo.isLive(), (e) => e instanceof PayitgoError && e.status === 401 && e.message === "invalid API key");
  reply(200, { webhook: WEBHOOK });
  assert.equal(await payitgo.isLive(), false);
  assert.equal(requests.length, 2);
});

test("webhooks.set puts the URL", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  reply(200, { webhook: WEBHOOK });
  const webhook = await payitgo.webhooks.set(WEBHOOK.url);
  assert.equal(requests[0].method, "PUT");
  assert.equal(requests[0].url, "/v1/webhook");
  assert.equal(requests[0].headers["content-type"], "application/json");
  assert.deepEqual(requests[0].body, { url: WEBHOOK.url });
  assert.equal(webhook.url, WEBHOOK.url);
  assert.equal(webhook.secret, WEBHOOK.secret);
});

test("webhooks.remove deletes the URL and keeps the secret", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  reply(200, { webhook: { ...WEBHOOK, url: null } });
  const webhook = await payitgo.webhooks.remove();
  assert.equal(requests[0].method, "DELETE");
  assert.equal(requests[0].url, "/v1/webhook");
  assert.equal(webhook.url, null);
  assert.equal(webhook.secret, WEBHOOK.secret);
});

test("webhooks.test queues a ping and returns its delivery", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  reply(202, { delivery: DELIVERY });
  const delivery = await payitgo.webhooks.test();
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].url, "/v1/webhook/test");
  assert.equal(requests[0].headers.authorization, `Bearer ${KEY}`);
  assert.equal(delivery.event_type, "ping");
  assert.equal(delivery.target, "account");
  assert.equal(delivery.status, "pending");
});

test("webhooks errors carry the API's message and status", async (t) => {
  const { payitgo, reply } = await fakeGateway(t);
  reply(400, { error: "no webhook url is set for this mode: set one first" });
  await assert.rejects(payitgo.webhooks.test(), (e) => {
    assert.ok(e instanceof PayitgoError);
    assert.equal(e.status, 400);
    assert.equal(e.message, "no webhook url is set for this mode: set one first");
    return true;
  });
  const forbidden = "a storefront's key cannot change the account's webhook: set webhook_url on its payments instead";
  reply(403, { error: forbidden });
  await assert.rejects(payitgo.webhooks.set(WEBHOOK.url), (e) => e instanceof PayitgoError && e.status === 403 && e.message === forbidden);
});

// ── Events, replayed ────────────────────────────────────────────────────────

const EVENTS = {
  events: [
    {
      id: "2b4d6f8a0c1e3a5c7e9b1d3f",
      type: "payment.confirmed",
      livemode: false,
      created_at: "2026-10-20T09:31:12.614Z",
      data: { id: "040ffd5925d40e11c67b7238", order_id: "ORD-1", status: "confirmed", usd_amount: "10" },
    },
    {
      id: "9b1e3c5a7d2f4b6e8a0c1d3f",
      type: "payout_item.canceled",
      livemode: false,
      created_at: "2026-10-20T15:02:44.312Z",
      data: { id: "5c7e9a1b3d5f7a9c1e3b5d7f", status: "canceled", cancel_reason: "rejected", cancel_note: "paid by bank transfer instead", released_reference: "wd-88231" },
    },
  ],
  has_more: true,
};

test("events.list reads the mode's events, oldest first", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  reply(200, EVENTS);
  const page = await payitgo.events.list();
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].url, "/v1/events");
  assert.equal(requests[0].headers.authorization, `Bearer ${KEY}`);
  assert.equal(requests[0].body, undefined);
  assert.deepEqual(page, EVENTS);
  assert.equal(page.has_more, true);
  assert.equal(page.events[1].type, "payout_item.canceled");
  assert.equal(page.events[1].data.cancel_reason, "rejected");
});

test("events.list sends its filters: types and families comma-separated, a Date as its ISO string", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  reply(200, EVENTS);
  await payitgo.events.list({ type: ["payout_item.*", "payment.confirmed"], after: "2b4d6f8a0c1e3a5c7e9b1d3f", limit: 200 });
  assert.equal(requests[0].url, "/v1/events?type=payout_item.*%2Cpayment.confirmed&after=2b4d6f8a0c1e3a5c7e9b1d3f&limit=200");
  reply(200, { events: [], has_more: false });
  const empty = await payitgo.events.list({ type: "payout_item.sent", created_after: new Date(Date.UTC(2026, 9, 20, 9, 0, 0)) });
  assert.equal(requests[1].url, "/v1/events?type=payout_item.sent&created_after=2026-10-20T09%3A00%3A00.000Z");
  assert.deepEqual(empty, { events: [], has_more: false });
  reply(200, EVENTS);
  await payitgo.events.list({ created_after: "2026-10-20T09:00:00Z" });
  assert.equal(requests[2].url, "/v1/events?created_after=2026-10-20T09%3A00%3A00Z");
  // Unset filters are left out.
  reply(200, EVENTS);
  await payitgo.events.list({ type: [], after: "", created_after: undefined, limit: null });
  assert.equal(requests[3].url, "/v1/events");
});

test("events.list: a storefront's key is a 403, an unknown after a 400", async (t) => {
  const { payitgo, reply } = await fakeGateway(t);
  const forbidden = "a storefront's key cannot read the account's events: use an account key";
  reply(403, { error: forbidden });
  await assert.rejects(payitgo.events.list(), (e) => e instanceof PayitgoError && e.status === 403 && e.message === forbidden);
  reply(400, { error: "after is not an event of this mode" });
  await assert.rejects(payitgo.events.list({ after: "x" }), (e) => e instanceof PayitgoError && e.status === 400 && e.message === "after is not an event of this mode");
});

test("payments.create sends webhook_url: the call's own, else the client's default", async (t) => {
  const { payitgo, requests } = await fakeGateway(t, { webhookUrl: "https://shop.example/default" });
  const own = await payitgo.payments.create({ order_id: "ORD-1", amount_usd: 10, webhook_url: "https://shop.example/own" });
  assert.equal(requests[0].body.webhook_url, "https://shop.example/own");
  assert.equal(own.webhook_url, "https://shop.example/own");
  const fallback = await payitgo.payments.create({ order_id: "ORD-2", amount_usd: 10 });
  assert.deepEqual(requests[1].body, { order_id: "ORD-2", amount_usd: 10, webhook_url: "https://shop.example/default" });
  assert.equal(fallback.webhook_url, "https://shop.example/default");
});

test("payments.create sends no webhook_url without one", async (t) => {
  const { payitgo, requests } = await fakeGateway(t);
  await payitgo.payments.create({ order_id: "ORD-1", amount_usd: 10 });
  assert.deepEqual(requests[0].body, { order_id: "ORD-1", amount_usd: 10 });
});

// A payment whose coin the customer chose on the merchant's own page.
const CHOSEN = {
  id: "pay_1",
  merchant_id: "mch_1",
  order_id: "ORD-7",
  status: "pending",
  livemode: false,
  token: "XRP",
  chain: "xrp",
  deposit_address: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
  destination_tag: 1042,
  crypto_amount: "20",
  received_amount: "0",
  usd_amount: "10",
  amount_due_usd: "10",
  fees_paid_by_customer: false,
  settlement: "custodial",
  received_usd: "0",
  rate_locked: "0.5",
  deposits: [],
  expires_at: "2026-10-10T12:15:00Z",
  created_at: "2026-10-10T12:00:00Z",
  network_fee_note: "Final in seconds. Include the destination tag: it is required.",
  qr_payload: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
  checkout_token: "ct_abc",
  checkout_url: "https://pay.example/ct_abc",
  description: "Order 7",
  metadata: { cart: "42" },
};

test("payments.selectToken posts the coin with the key and returns the whole payment", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  reply(200, CHOSEN);
  const payment = await payitgo.payments.selectToken("pay_1", "XRP");
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].url, "/v1/payments/pay_1/token");
  assert.equal(requests[0].headers.authorization, `Bearer ${KEY}`);
  assert.equal(requests[0].headers["content-type"], "application/json");
  assert.deepEqual(requests[0].body, { token: "XRP" });
  assert.deepEqual(payment, CHOSEN);
  // An order id is escaped in the path, as payments.retrieve does.
  reply(200, CHOSEN);
  await payitgo.payments.selectToken("ORD 7/1", "XRP");
  assert.equal(requests[1].url, "/v1/payments/ORD%207%2F1/token");
});

test("payments.selectToken: a coin already chosen is a 409", async (t) => {
  const { payitgo, reply } = await fakeGateway(t);
  reply(409, { error: "the coin for this payment can no longer be changed" });
  await assert.rejects(payitgo.payments.selectToken("pay_1", "XRP"), (e) => {
    assert.ok(e instanceof PayitgoError);
    assert.equal(e.status, 409);
    assert.equal(e.message, "the coin for this payment can no longer be changed");
    return true;
  });
});

// A test payment whose simulated outcome has paid it.
const SIMULATED = {
  id: "pay_2",
  merchant_id: "mch_1",
  order_id: "ORD-8",
  status: "detecting",
  livemode: false,
  simulation: { outcome: "confirmed", state: "running" },
  token: "USDT_TRC20",
  chain: "tron",
  deposit_address: "TPk2bpQqWRpXiaUHS9SXnZCDgvwrsuJ71o",
  crypto_amount: "20",
  received_amount: "20",
  usd_amount: "20",
  amount_due_usd: "20",
  fees_paid_by_customer: false,
  settlement: "custodial",
  received_usd: "20",
  rate_locked: "1",
  deposits: [
    {
      tx_id: "8de0120d502929788a71a7b7cf60e5ef3c095cdbb05cd8a7ddabc0bc9ffa9582", token: "USDT_TRC20", chain: "tron", amount: "20", usd_value: "20",
      counted: true, status: "pending", seen_at: "2026-10-10T12:00:05Z", simulated: true,
    },
  ],
  expires_at: "2026-10-10T12:15:00Z",
  created_at: "2026-10-10T12:00:00Z",
  network_fee_note: "Final in about a minute.",
  qr_payload: "TPk2bpQqWRpXiaUHS9SXnZCDgvwrsuJ71o",
};

test("payments.simulate posts the outcome with the key and returns the payment with its simulation", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  reply(200, SIMULATED);
  const payment = await payitgo.payments.simulate("pay_2", "confirmed");
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].url, "/v1/payments/pay_2/simulate");
  assert.equal(requests[0].headers.authorization, `Bearer ${KEY}`);
  assert.equal(requests[0].headers["content-type"], "application/json");
  assert.deepEqual(requests[0].body, { outcome: "confirmed" });
  assert.deepEqual(payment, SIMULATED);
  assert.deepEqual(payment.simulation, { outcome: "confirmed", state: "running" });
  assert.equal(payment.deposits[0].simulated, true);
  // An order id is escaped in the path, as payments.retrieve does.
  reply(200, SIMULATED);
  await payitgo.payments.simulate("ORD 8/1", "expired");
  assert.equal(requests[1].url, "/v1/payments/ORD%208%2F1/simulate");
});

test("payments.simulate: a simulation still running is a 409", async (t) => {
  const { payitgo, reply } = await fakeGateway(t);
  reply(409, { error: "a simulation is already running for this payment" });
  await assert.rejects(payitgo.payments.simulate("pay_2", "confirmed"), (e) => {
    assert.ok(e instanceof PayitgoError);
    assert.equal(e.status, 409);
    assert.equal(e.message, "a simulation is already running for this payment");
    return true;
  });
});

test("payments.create sends simulate", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  reply(201, SIMULATED);
  const payment = await payitgo.payments.create({ order_id: "ORD-8", amount_usd: 20, token: "USDT_TRC20", simulate: "confirmed" });
  assert.deepEqual(requests[0].body, { order_id: "ORD-8", amount_usd: 20, token: "USDT_TRC20", simulate: "confirmed" });
  assert.deepEqual(payment.simulation, { outcome: "confirmed", state: "running" });
});

// A payment priced in euros: the gateway converted the price into usd_amount at price_rate.
const PRICED = {
  ...CHOSEN,
  order_id: "ORD-10",
  usd_amount: "49.23",
  amount_due_usd: "49.23",
  price_amount: "45.5",
  price_currency: "EUR",
  price_rate: "1.082",
};

test("payments.create sends a price in another currency, and the payment carries it", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  reply(201, PRICED);
  const payment = await payitgo.payments.create({ order_id: "ORD-10", price_amount: "45.50", price_currency: "eur" });
  assert.deepEqual(requests[0].body, { order_id: "ORD-10", price_amount: "45.50", price_currency: "eur" });
  assert.deepEqual(payment, PRICED);
  assert.equal(payment.price_amount, "45.5");
  assert.equal(payment.price_currency, "EUR");
  assert.equal(payment.price_rate, "1.082");
  assert.equal(payment.usd_amount, "49.23");
  // A payment priced in dollars has none of them.
  reply(200, CHOSEN);
  const dollars = await payitgo.payments.retrieve("pay_1");
  assert.equal("price_amount" in dollars || "price_currency" in dollars || "price_rate" in dollars, false);
});

test("payments.create: no exchange rate for the currency is a 503", async (t) => {
  const { payitgo, reply } = await fakeGateway(t);
  reply(503, { error: "exchange rate unavailable for price_currency: try again shortly" });
  await assert.rejects(payitgo.payments.create({ order_id: "ORD-10", price_amount: 45.5, price_currency: "EUR" }), (e) => {
    assert.ok(e instanceof PayitgoError);
    assert.equal(e.status, 503);
    assert.equal(e.message, "exchange rate unavailable for price_currency: try again shortly");
    return true;
  });
});

test("tokens.list: every token, or a payment of an amount's options", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  const tokens = [{ token: "USDT_BEP20", chain: "bsc", min_usd: "1", network_fee_usd: "0.01", amount_due_usd: "40.43", fee_note: "" }];
  reply(200, { tokens });
  assert.deepEqual(await payitgo.tokens.list(), tokens);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].url, "/v1/tokens");
  reply(200, { tokens });
  await payitgo.tokens.list({ amount_usd: "49.90" });
  assert.equal(requests[1].url, "/v1/tokens?amount_usd=49.90");
});

test("client webhooks.constructEvent uses the client's secret, or the one passed", () => {
  const withSecret = new Payitgo(KEY, { baseUrl: "http://x", webhookSecret: SECRET });
  assert.equal(withSecret.webhooks.constructEvent(BODY, HEADER, undefined, 0).id, "b8e1f80bd70ae0784c7855a4");
  const now = Math.floor(Date.now() / 1000);
  assert.equal(withSecret.webhooks.constructEvent(BODY, sign(SECRET, now, BODY)).id, "b8e1f80bd70ae0784c7855a4");
  // An explicit secret wins over the client's.
  const other = new Payitgo(KEY, { baseUrl: "http://x", webhookSecret: OTHER_SECRET });
  assert.throws(() => other.webhooks.constructEvent(BODY, HEADER, undefined, 0), SignatureVerificationError);
  assert.equal(other.webhooks.constructEvent(BODY, HEADER, SECRET, 0).id, "b8e1f80bd70ae0784c7855a4");
  // Without any secret there is nothing to verify with.
  const none = new Payitgo(KEY, { baseUrl: "http://x" });
  assert.throws(() => none.webhooks.constructEvent(BODY, HEADER), (e) => e instanceof SignatureVerificationError && /no webhook secret/.test(e.message));
  assert.equal(Payitgo.webhooks.constructEvent(BODY, HEADER, SECRET, 0).id, "b8e1f80bd70ae0784c7855a4");
});

test("rejects a signed but non-numeric timestamp unless the timestamp check is off", () => {
  const header = sign(SECRET, "soon", BODY);
  assert.throws(() => webhooks.constructEvent(BODY, header, SECRET), (e) => e instanceof SignatureVerificationError && /malformed timestamp/.test(e.message));
  assert.equal(webhooks.constructEvent(BODY, header, SECRET, 0).id, "b8e1f80bd70ae0784c7855a4");
});

test("a signature of non-ASCII characters is a signature error", () => {
  // 64 characters, but more than 64 bytes: must not reach timingSafeEqual with unequal lengths.
  const header = "t=1760000000,v1=" + "é".repeat(64);
  assert.throws(() => webhooks.constructEvent(BODY, header, SECRET, 0), SignatureVerificationError);
});

test("payments.list sends its filters, store_id included", async (t) => {
  const { payitgo, requests, reply } = await fakeGateway(t);
  reply(200, { payments: [], total: 0, limit: 10, offset: 20 });
  const page = await payitgo.payments.list({ status: "confirmed", store_id: "sto_1", limit: 10, offset: 20 });
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].url, "/v1/payments?status=confirmed&store_id=sto_1&limit=10&offset=20");
  assert.deepEqual(page, { payments: [], total: 0, limit: 10, offset: 20 });
});

test("a payment's deposits keep every field the gateway sends", async (t) => {
  const { payitgo, reply } = await fakeGateway(t);
  const deposit = {
    tx_id: "c19240", token: "USDT_TRC20", chain: "tron", amount: "49.9", usd_value: "49.9", counted: true, late: true,
    status: "failed", seen_at: "2026-10-10T09:03:02.418Z", confirmed_at: "2026-10-10T09:04:03.77Z", from: "TL8wHk",
    block: 79412538, made_at: "2026-10-10T09:02:57Z", failed_at: "2026-10-10T15:03:02Z", fail_reason: "confirmation timeout",
  };
  reply(200, { ...CHOSEN, deposits: [deposit] });
  assert.deepEqual((await payitgo.payments.retrieve("pay_1")).deposits, [deposit]);
});

// A gateway that sends the headers of its first answer and then stalls, and
// answers the second request in full.
async function stallingGateway(t) {
  let calls = 0;
  const server = http.createServer((req, res) => {
    calls++;
    res.writeHead(200, { "Content-Type": "application/json" });
    if (calls === 1) {
      res.write('{"webhook":'); // …and nothing more
      return;
    }
    res.end(JSON.stringify({ webhook: WEBHOOK }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { url: `http://127.0.0.1:${server.address().port}`, calls: () => calls };
}

test("a timeout while reading the answer is retried like a network error", async (t) => {
  const gw = await stallingGateway(t);
  const payitgo = new Payitgo(KEY, { baseUrl: gw.url, timeoutMs: 300, maxRetries: 1 });
  assert.deepEqual(await payitgo.webhooks.get(), WEBHOOK);
  assert.equal(gw.calls(), 2);
});

test("a timeout while reading the answer, with no retries left, is a PayitgoError with status 0", async (t) => {
  const gw = await stallingGateway(t);
  const payitgo = new Payitgo(KEY, { baseUrl: gw.url, timeoutMs: 300, maxRetries: 0 });
  await assert.rejects(payitgo.webhooks.get(), (e) => e instanceof PayitgoError && e.status === 0 && /request failed/.test(e.message));
  assert.equal(gw.calls(), 1);
});
