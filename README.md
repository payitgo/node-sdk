# payitgo for Node.js

Accept crypto payments, and pay your own clients, with [payitgo](https://api.payitgo.co/docs) from Node.js 18+. TypeScript types
included, no runtime dependencies.

Full reference, with every method, option, type and error: [api.payitgo.co/docs/sdk-node](https://api.payitgo.co/docs/sdk-node).

```bash
npm install @payitgo/node
```

```ts
import Payitgo from "@payitgo/node";              // ES modules and TypeScript; also { Payitgo, PayitgoError, … }
const { Payitgo } = require("@payitgo/node");     // CommonJS
```

## Accept a payment in three steps

```ts
import express from "express";
import { Payitgo } from "@payitgo/node";

const payitgo = new Payitgo(process.env.PAYITGO_KEY!, {
  baseUrl: process.env.PAYITGO_BASE_URL,
  webhookSecret: process.env.PAYITGO_WEBHOOK_SECRET, // the signing secret: see Webhooks (IPN) below
});
const app = express();

// 1. Create a payment and send the customer to the checkout page.
app.post("/checkout", express.json(), async (req, res) => {
  const payment = await payitgo.payments.create({
    order_id: req.body.orderId,      // your order id: safe to retry
    amount_usd: req.body.total,      // e.g. 19.99
    // token: "USDT_TRC20",          // optional: without it the customer picks the coin
    success_url: "https://shop.example/thanks",
  });
  res.redirect(payment.checkout_url!);
});

// 2. Receive the notification (the complete handler is under Webhooks (IPN) below).
//    Use the raw body: the signature covers its exact bytes.
app.post("/payitgo/ipn", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    event = payitgo.webhooks.constructEvent(req.body, req.get("X-Webhook-Signature"));
  } catch {
    return res.sendStatus(400);
  }
  // 3. Fulfil the order once the payment is final.
  if (event.type === "payment.confirmed") {
    markOrderPaid(event.data.order_id); // make this idempotent: events can arrive twice
  }
  res.sendStatus(200);
});
```

Start with a test key, where you [simulate](#test-mode) what the customer pays; switch to
a live key when the account owner has turned live mode on. A key does not say its mode
(the dashboard shows a Test or Live badge next to it): `await payitgo.isLive()` asks
payitgo, once.

## Prices in other currencies

To price a payment in your own currency, give `price_amount` and `price_currency` (an ISO
4217 code such as `EUR`, `GBP` or `NGN`) instead of `amount_usd`. payitgo converts the price
into dollars at the rate of the moment, and the payment keeps both:

```ts
const payment = await payitgo.payments.create({
  order_id: "ORD-1002",
  price_amount: "45.50",   // a string avoids float rounding; a number works too
  price_currency: "EUR",   // any case
});
// payment.price_amount "45.5", payment.price_currency "EUR",
// payment.price_rate "1.082" (dollars per euro), payment.usd_amount "49.23"
```

Everything else (`usd_amount`, `crypto_amount`, fees, minimums) stays in dollars; a payment
priced in dollars has no `price_*` fields. Give `amount_usd` or the pair, not both (`400`).
When no exchange rate can be had, `create` rejects with a `503` (`exchange rate unavailable
for price_currency: try again shortly`) once the client's retries are spent: try again
shortly.

## Your own payment page

`checkout_url` is only for payitgo's hosted page. To show the payment on your own page,
render the payment your server gets back (`deposit_address`, `crypto_amount`,
`destination_tag` for XRP, a QR code of `qr_payload`, `expires_at`); no `checkout` calls
are needed.

- **You know the coin:** create the payment with `token` and render the payment it returns.
- **The customer chooses it:** create the payment without `token`, show
  `payment.token_options` on your page, then call `payments.selectToken(payment.id, chosen)`
  from your server and render the payment it returns: it now has its coin, address, amount,
  locked rate and a deadline 15 minutes away.

```ts
const payment = await payitgo.payments.create({ order_id: "ORD-1", amount_usd: 10 });
// your page shows payment.token_options; the customer picks one
const chosen = await payitgo.payments.selectToken(payment.id, "USDT_TRC20"); // or your order id
// render chosen.deposit_address, chosen.crypto_amount, chosen.qr_payload, chosen.expires_at
```

The customer can change the coin while the payment still has `token_options` (nothing has
arrived yet): call `payments.selectToken` again with another. Once it can no longer change, it is a `409`
(`payments.retrieve` then returns the payment with its coin). A coin outside `token_options`, or a
payment that can no longer be paid, is a `400`.

## Test mode

A test payment gets an address like a live one, but no coins are involved: you choose an
outcome and payitgo plays its deposits, status changes and webhooks a few seconds apart
([Test mode](https://api.payitgo.co/docs/testing)).

```ts
// Choose the outcome when you create the payment (with token it starts at once,
// without it once the coin is chosen)…
await payitgo.payments.create({ order_id: "TEST-1", amount_usd: 10, token: "USDT_TRC20", simulate: "confirmed" });

// …or later, on a payment you already have (its id or your order id).
const payment = await payitgo.payments.simulate("TEST-2", "partially_paid");
// payment.simulation: { outcome: "partially_paid", state: "running" }
```

Outcomes: `confirmed`, `overpaid`, `partially_paid`, `underpaid`, `expired`, `failed`,
`wrong_asset`, `paid_late`. Simulated deposits have `simulated: true`; their `tx_id` names
no transaction on any chain. A live key gets `400`; a payment whose simulation is still
running, `409`.

## Webhooks (IPN)

payitgo POSTs a signed notification for every change of a payment (`payment.confirmed`,
`payment.expired`, …), of a direct settlement and of a payout. Each mode has one webhook:
a test key manages the test one, a live key the live one.

**Where the notifications go.** Set the URL once per mode (https:// on a public host,
accepting POST requests), or give a payment its own when you create it:

```ts
// Once per mode (safe to repeat):
await payitgo.webhooks.set("https://shop.example/payitgo/ipn");

// Or per payment: its events go there instead of the webhook's URL.
await payitgo.payments.create({ order_id: "ORD-1", amount_usd: 10, webhook_url: "https://shop.example/orders/ipn" });

// Or as the client's default for every payment it creates (a payment's own webhook_url wins):
const shop = new Payitgo(process.env.PAYITGO_KEY!, { webhookUrl: "https://shop.example/orders/ipn" });
```

A storefront's key cannot set the account's URL (`403`): pass `webhook_url` instead.
Events of your own payouts always go to the webhook's URL; a [payout batch](#payouts) made
with its own `webhook_url` sends its events there.

**The signing secret.** Every notification of a mode is signed with that mode's secret,
whichever URL it goes to. Copy it from the dashboard or read it with
`(await payitgo.webhooks.get()).secret`, and give it to the client once:

```ts
const payitgo = new Payitgo(process.env.PAYITGO_KEY!, { webhookSecret: process.env.PAYITGO_WEBHOOK_SECRET });
```

**Receiving them** (Express). Verify the raw body, handle each event once, and answer
`2xx` within 10 seconds; otherwise payitgo retries after 1 min, 5 min, 30 min, 2 h, 6 h and
24 h.

```ts
app.post("/payitgo/ipn", express.raw({ type: "application/json" }), async (req, res) => {
  let event;
  try {
    // Checks the signature with the client's webhookSecret and refuses anything older than 5 minutes.
    event = payitgo.webhooks.constructEvent(req.body, req.get("X-Webhook-Signature"));
  } catch {
    return res.sendStatus(400);
  }
  // The same event can arrive more than once: handle each event id once,
  // e.g. by inserting it into a table with a unique key.
  if (!(await recordEventOnce(event.id))) return res.sendStatus(200);

  switch (event.type) {
    case "payment.confirmed":
      await jobs.enqueue("fulfil", { orderId: event.data.order_id }); // slow work off the request
      break;
    case "payment.expired":
      await jobs.enqueue("release-stock", { orderId: event.data.order_id });
      break;
  }
  res.sendStatus(200);
});
```

**Testing it.** `await payitgo.webhooks.test()` queues a signed `ping` event to the
webhook's URL and returns its delivery (`400` when no URL is set).

## Payouts

Pay your own clients (withdrawals from your platform, prizes, payroll) from your **payout
wallet**: one address per network (Tron, BNB Smart Chain, Ethereum, Bitcoin, Litecoin,
Dogecoin, XRP Ledger), yours alone, that you top up. Payouts are paid in `USDT_TRC20`, `TRX`,
`USDT_BEP20`, `USDC_BEP20`, `ETH_BEP20`, `BNB`, `USDT_ERC20`, `USDC_ERC20`, `DAI_ERC20`, `ETH`,
`BTC`, `LTC`, `DOGE` and `XRP` (with `tag` for XRP's destination tag), or in another coin,
converted on its way (below) ([Mass payouts](https://api.payitgo.co/docs/payouts)).

Reading works with any key; everything else needs a key with **payouts** turned on in the
dashboard (`403` otherwise). The key's mode decides the wallet: a test key pays from a test
wallet, on paper. Amounts are decimal strings; amounts you send may be strings or numbers.

**Payout requests, one by one.** Send each of your clients' payout requests as it comes in.
payitgo checks and prices it at once and keeps it in your open list with its costs, until
you send the list (or it goes by itself, with auto-send turned on in the dashboard):

```ts
// A client asks to withdraw. Pass your own id for the request as reference: sending it
// again (a retry, yours or the client's) returns the same payment instead of a second one.
const item = await payitgo.payouts.request({
  reference: "wd-1042",
  asset: "USDT_TRC20",
  address: "TR7mNkucnhLZoJQLLJ6DR88jpLQufWxUJi",
  amount: "120",
  name: "Ana Silva",             // optional, with email and note
});
if (item.status === "invalid") console.log(item.errors.map((e) => e.message)); // kept, never sent
else console.log(item.fee, item.send_amount, item.debit); // its costs, in the coin

// The open list, and what sending it needs of each coin against what the wallet can spend.
const { inbox, coverage, items } = await payitgo.payouts.inbox(); // inbox.totals, inbox.counts
for (const c of coverage) {
  if (Number(c.top_up) > 0) console.log(`send ${c.top_up} ${c.asset} to ${c.address} first`);
}

// Send every valid request, or some (payouts.send([id, …])): they become a batch, priced
// again and submitted. It then waits for approval and/or funds, or starts.
const batch = await payitgo.payouts.send();

await payitgo.payouts.cancel(item.id);                // out of the list (or canceled, if not on its way yet)
await payitgo.payouts.retrieveByReference("wd-1042"); // or payouts.retrieve(item.id)
```

`payouts.quote` prices up to 100 payments without keeping anything, for example to show a
client the fee before they confirm:

```ts
const { quote, items } = await payitgo.payouts.quote({
  fee_paid_by: "recipient",      // the fees come out of the amount ("merchant": on top)
  items: [{ asset: "USDT_BEP20", address: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", amount: "120" }],
});
// items[0].send_amount: what the client receives; quote.total_usd: what it takes from the wallet
```

**Batches.** A whole list at once (payroll, prizes): up to 1000 payments a call, 10,000 a
batch.

```ts
const batch = await payitgo.payoutBatches.create({
  reference: "payroll-2026-10",  // safe to retry: a reference used already returns that batch
  name: "October payroll",
  items: [
    { reference: "payroll-2026-10-ana", asset: "USDT_TRC20", address: "TR7mNkucnhLZoJQLLJ6DR88jpLQufWxUJi", amount: "1500" },
    { reference: "payroll-2026-10-ben", asset: "USDT_BEP20", address: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", amount: "250" },
  ],
});
// "quoted": batch.totals (per coin) and batch.total_usd. Invalid rows are left out:
const invalid = await payitgo.payoutBatches.items(batch.id, { status: "invalid" }); // their errors say why

const submitted = await payitgo.payoutBatches.submit(batch.id);
// "pending_approval" (your payout settings ask for approvals, given in the dashboard),
// "awaiting_funds" (submitted.waiting.shortfall: what to send where), or "processing".
```

A batch's prices hold for an hour (15 minutes with converted payments): past it, `submit` is
a `409` (`its prices expired: get a new quote first`): call `payoutBatches.quote(batch.id)`,
then submit. Also `payoutBatches.addItems(id, items)`, `list({ status })`, `retrieve(id)` and
`cancel(id)`.

**Claim links.** A payment whose recipient chooses where to receive it: pass `claim: true`
(or `claim_assets`, the other coins they may choose, paid at the same dollar value) and no
`address`. With an `email`, payitgo emails them the link and they confirm with a code sent
there; without one, you share the link (`claim.url`) yourself. An email alone is not a claim
link: a payment with no address and no `claim` is invalid. It works in payout requests,
batches and quotes alike.

```ts
const item = await payitgo.payouts.request({
  reference: "prize-cup-1",
  asset: "USDT_TRC20",
  amount: "120",
  claim: true,
  email: "player@example.com",          // optional: emailed the link (else send item.claim.url yourself)
  claim_assets: ["USDT_BEP20", "BTC"],  // optional: other coins they may choose
});
```

Once funded, the payment is `claimable` until its recipient claims it (`payout_item.claimed`:
it is then `queued`, with the address and the coin they chose; `claim.funded_asset` and
`claim.funded_amount` say what it was funded with when they chose another) or until
`claim.expires_at` (`payout_item.claim_expired`: it is `expired`, its money free again in the
wallet, its reference in `released_reference`). Read `item.claim`: `url`, `email`, `assets`,
`expires_at`, `claimed_at`, `emailed`, `extended`. Resending and extending a link are done in
the dashboard. A bad email is an `invalid_email` error.

**Converted payments.** Pay a recipient in a coin your wallet does not hold: with
`convert: "convert"`, every payment in another coin than `convert_from` is paid from
`convert_from`, converted on its way. Both default to your payout settings.

```ts
const batch = await payitgo.payoutBatches.create({
  reference: "wd-batch-7",
  convert: "convert",
  convert_from: "USDT_TRC20",           // the wallet's coin that pays
  items: [{ reference: "wd-2001", asset: "BTC", address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", amount: "0.002" }],
});
const { items } = await payitgo.payoutBatches.items(batch.id);
// items[0].convert: { to: "BTC", ticker, network, to_amount: "0.002", estimate: "0.00200041" }
// items[0].asset, amount, fee and debit are in USDT_TRC20; conversion_fee is part of fee.
```

`convert.estimate` is about what arrives; `convert.amount_out` is what did, once sent. A coin
that cannot be converted right now is a `conversion_unavailable` error. `payouts.quote`
takes `convert` and `convert_from` too; payout requests follow your payout settings. Claim
links are never converted.

**The wallet.**

```ts
const wallets = await payitgo.payoutWallets.list();
// [{ chain: "tron", network, address, assets: [{ asset, balance, reserved, spendable, needed }] }, { chain: "bsc", … }, …]
```

Send each network's address only its payout coins. `needed` is what batches waiting for
funds lack: they start by themselves once it arrives.

**Test mode.** With a test key, top the test wallet up on paper. Payments are then sent on
paper within seconds, with a made-up `tx_id`, and their webhooks arrive as live ones do:

```ts
await payitgo.payoutWallets.simulateTopUp("USDT_TRC20", "1000"); // test keys only: 400 with a live key
```

**Webhooks.** Each step raises an event, signed like the others: `payout_batch.quoted`,
`payout_batch.pending_approval`, `payout_batch.approved`, `payout_batch.rejected`,
`payout_batch.awaiting_funds`, `payout_batch.processing`, `payout_batch.completed` and
`payout_batch.canceled` carry the batch; `payout_item.sent`, `payout_item.failed`,
`payout_item.canceled`, `payout_item.claimed` and `payout_item.claim_expired` the payment;
`payout_wallet.withdrawn` the withdrawal. Schedules (made in the dashboard) send
`payout_schedule.run` (a summary of the schedule, without its rows: `last_batch_id` is the
batch it made, `last_error` why it made none) and `payout_schedule.funding_needed`
(`{ schedule, shortfall }`, a few days before a run the wallet cannot cover); their batches
have `source: "schedule"`. A payment
never sent (failed, canceled or expired) gives its reference back: it is then in
`released_reference`, so the same request can be paid again.

```ts
import type { PayoutItem } from "@payitgo/node";

const event = payitgo.webhooks.constructEvent<PayoutItem>(req.body, req.get("X-Webhook-Signature"));
switch (event.type) {
  case "payout_item.sent":   // on chain
    await markWithdrawalPaid(event.data.reference, event.data.tx_id);
    break;
  case "payout_item.failed": // given up: its money stays in the wallet
    await reopenWithdrawal(event.data.released_reference, event.data.fail_reason);
    break;
}
```

## API

```ts
const payitgo = new Payitgo(apiKey, {
  baseUrl: "https://api.example.com", // or PAYITGO_BASE_URL
  timeoutMs: 30_000,
  maxRetries: 2,                      // network errors, 429 and 5xx
  webhookSecret: process.env.PAYITGO_WEBHOOK_SECRET, // for webhooks.constructEvent
  webhookUrl: "https://…",            // default webhook_url of payments.create
});

await payitgo.isLive();                               // false for a test key (asks payitgo once)
await payitgo.payments.create({ order_id, amount_usd, token, description?, metadata?,
                              customer_email?, success_url?, cancel_url?, webhook_url?, simulate? });
await payitgo.payments.create({ order_id, price_amount, price_currency, … }); // priced in another currency
await payitgo.payments.selectToken(paymentId, token); // or your order id: the payment with its coin
await payitgo.payments.simulate(paymentId, "confirmed"); // test keys: plays the outcome
await payitgo.payments.retrieve(paymentId);           // or your order id
await payitgo.payments.list({ status: "confirmed", store_id: storeId, limit: 50, offset: 0 }); // every filter optional
await payitgo.tokens.list();                          // [{ token, chain, min_usd, network_fee_usd, fee_note }]
await payitgo.tokens.list({ amount_usd: "49.90" });   // the coins a $49.90 payment offers, with amount_due_usd
await payitgo.checkout.retrieve(checkoutToken);       // public payer view
await payitgo.payouts.request({ reference, asset, address, amount, tag?, name?, email?, note?, claim?, claim_assets? }); // PayoutItem
await payitgo.payouts.retrieve(itemId);               // PayoutItem: a request or a batch's row
await payitgo.payouts.retrieveByReference(reference); // PayoutItem
await payitgo.payouts.inbox({ status?, limit?, offset? }); // PayoutInbox { inbox, coverage, items, total, limit, offset }
await payitgo.payouts.send(ids?);                     // PayoutBatch: every valid request, or those of ids
await payitgo.payouts.cancel(itemId);                 // PayoutItem, status "canceled"
await payitgo.payouts.quote({ fee_paid_by?, convert?, convert_from?, items }); // { quote, items }: nothing kept
await payitgo.payoutBatches.create({ reference?, name?, fee_paid_by?, convert?, convert_from?, webhook_url?, items }); // PayoutBatch
await payitgo.payoutBatches.list({ status?, limit?, offset? }); // { batches, total, limit, offset }
await payitgo.payoutBatches.retrieve(batchId);        // PayoutBatch
await payitgo.payoutBatches.items(batchId, { status?, limit?, offset? }); // { items, total, limit, offset }
await payitgo.payoutBatches.addItems(batchId, items); // PayoutBatch
await payitgo.payoutBatches.quote(batchId);           // PayoutBatch, priced again
await payitgo.payoutBatches.submit(batchId);          // PayoutBatch
await payitgo.payoutBatches.cancel(batchId);          // PayoutBatch
await payitgo.payoutWallets.list();                   // PayoutWallet[]
await payitgo.payoutWallets.simulateTopUp(asset, amount); // PayoutWallet[]: test keys only
await payitgo.webhooks.get();                         // Webhook { livemode, url, secret, created_at, updated_at }
await payitgo.webhooks.set(url);                      // Webhook
await payitgo.webhooks.remove();                      // Webhook, url null (the secret stays)
await payitgo.webhooks.test();                        // WebhookDelivery of a "ping" event
payitgo.webhooks.constructEvent(rawBody, signatureHeader, secret?, toleranceSeconds = 300);
Payitgo.webhooks.constructEvent(rawBody, signatureHeader, secret, toleranceSeconds = 300); // no client needed
```

Every method returns the API's JSON with its field names (`order_id`, `checkout_url`, …);
see the [payment object](https://api.payitgo.co/docs/payments) and [webhooks](https://api.payitgo.co/docs/webhooks).

## Errors

```ts
import { PayitgoError, SignatureVerificationError } from "@payitgo/node";

try {
  await payitgo.payments.create({ order_id: "ORD-1", amount_usd: 1, token: "BTC" });
} catch (e) {
  if (e instanceof PayitgoError) console.log(e.status, e.message); // 400 "minimum payment in BTC is $10 right now (network fees)"
}
```

`PayitgoError.status` is the HTTP status (0 for a network error). `constructEvent` throws
`SignatureVerificationError` for a bad signature, a stale or malformed timestamp, or when it
has no secret (none passed and no `webhookSecret`). A timeout counts as a network error
whether it happens before the answer starts or while it is read.

## Development

```bash
npm install && npm test
```
