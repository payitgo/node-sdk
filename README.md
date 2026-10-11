# payitgo for Node.js

Accept crypto payments with [payitgo](https://api.payitgo.co/docs) from Node.js 18+. TypeScript types
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
  webhookSecret: process.env.PAYITGO_WEBHOOK_SECRET, // "whsec_…": see Webhooks (IPN) below
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

Start with your test key (`sk_test_…`) and testnet coins; switch to the live key
(`sk_live_…`) when the account owner has turned live mode on.

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

The coin is chosen once: choosing again is a `409` (`payments.retrieve` then returns the
payment with its coin). A coin outside `token_options`, or a payment that can no longer be
paid, is a `400`.

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
Payout events always go to the webhook's URL.

**The signing secret.** Every notification of a mode is signed with that mode's secret
(`whsec_…`), whichever URL it goes to. Copy it from the dashboard or read it with
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

## API

```ts
const payitgo = new Payitgo(apiKey, {
  baseUrl: "https://api.example.com", // or PAYITGO_BASE_URL
  timeoutMs: 30_000,
  maxRetries: 2,                      // network errors, 429 and 5xx
  webhookSecret: "whsec_…",           // for webhooks.constructEvent
  webhookUrl: "https://…",            // default webhook_url of payments.create
});

payitgo.livemode;                                     // false for sk_test_ keys
await payitgo.payments.create({ order_id, amount_usd, token, description?, metadata?,
                              customer_email?, success_url?, cancel_url?, webhook_url? });
await payitgo.payments.selectToken("pay_…", token);   // or your order id: the payment with its coin
await payitgo.payments.retrieve("pay_…");             // or your order id
await payitgo.payments.list({ status: "confirmed", store_id: "sto_…", limit: 50, offset: 0 }); // every filter optional
await payitgo.tokens.list();                          // [{ token, chain, min_usd, network_fee_usd, fee_note }]
await payitgo.tokens.list({ amount_usd: "49.90" });   // the coins a $49.90 payment offers, with amount_due_usd
await payitgo.checkout.retrieve(checkoutToken);       // public payer view
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
