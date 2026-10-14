import { createHmac, timingSafeEqual } from "node:crypto";

export const VERSION = "0.2.1";

/** Where the gateway lives when neither `baseUrl` nor PAYITGO_BASE_URL is set. */
const DEFAULT_BASE_URL = "https://api.payitgo.co";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PaymentStatus =
  | "pending"
  | "partially_paid"
  | "detecting"
  | "confirmed"
  | "underpaid"
  | "expired"
  | "failed";

/** An outcome a test payment can be made to go through: see `payments.simulate`. */
export type SimulationOutcome =
  | "confirmed"
  | "overpaid"
  | "partially_paid"
  | "underpaid"
  | "expired"
  | "failed"
  | "wrong_asset"
  | "paid_late";

/** A test payment's simulated outcome, and how far it is. */
export interface Simulation {
  outcome: SimulationOutcome;
  /** requested (asked for on create, waiting for the coin), running or done. */
  state: "requested" | "running" | "done";
}

/** One transfer to a payment's address. */
export interface Deposit {
  tx_id: string;
  /** The asset that arrived: another than the payment's own for a wrong-asset deposit. */
  token: string;
  chain: string;
  amount: string;
  usd_value: string;
  /** Whether it counts toward the payment. */
  counted: boolean;
  /** Whether it arrived after the payment had closed. */
  late?: boolean;
  /** pending (confirming), confirmed (final and credited) or failed. */
  status: "pending" | "confirmed" | "failed";
  /** When payitgo first saw it. */
  seen_at: string;
  /** When it became final. */
  confirmed_at?: string;
  /** The sender's address, when the network reports it (Bitcoin-like coins: the first input's): where a refund would go. */
  from?: string;
  /** The block (on XRP, the ledger) that holds it. */
  block?: number;
  /** That block's time. */
  made_at?: string;
  /** When it failed: it never became final and nothing was settled. */
  failed_at?: string;
  /** Why it failed: "transaction not found on chain" or "confirmation timeout". */
  fail_reason?: string;
  /** Played by a test payment's simulation: its tx_id starts with "sim_" and is on no chain. */
  simulated?: boolean;
}

/** A payment, as the API returns it. Amounts are decimal strings. */
export interface Payment {
  id: string;
  merchant_id?: string;
  store_id?: string;
  order_id: string;
  status: PaymentStatus;
  livemode: boolean;
  /** A test payment's simulated outcome, when it has one. */
  simulation?: Simulation;
  /** Empty until the customer chooses the coin (see token_options). */
  token: string;
  chain: string;
  /** While token is empty: the coins the customer may choose from. */
  token_options?: TokenInfo[];
  deposit_address: string;
  destination_tag?: number;
  crypto_amount: string;
  received_amount: string;
  /** Your price. */
  usd_amount: string;
  /** Your price as you gave it in another currency than the dollar; absent for a payment priced in dollars. */
  price_amount?: string;
  /** That currency's ISO 4217 code, upper case: "EUR". */
  price_currency?: string;
  /** The dollar value of one unit of `price_currency` that `usd_amount` was converted at. */
  price_rate?: string;
  /** What the customer pays in dollars: the price, plus the fees when you pass them on. */
  amount_due_usd: string;
  fees_paid_by_customer: boolean;
  /** The network fee quoted for moving the payment, in its coin and in dollars. */
  network_fee: string;
  network_fee_usd: string;
  /** Where the money goes once final: "custodial" (your balance) or "direct" (your payout address). */
  settlement: "custodial" | "direct";
  /** Dollar value of every deposit that counts toward the payment. */
  received_usd: string;
  rate_locked: string;
  tx_id?: string;
  overpaid?: boolean;
  /** Completed after it had expired. */
  paid_late?: boolean;
  deposits: Deposit[];
  expires_at: string;
  created_at: string;
  confirmed_at?: string;
  network_fee_note: string;
  qr_payload: string;
  checkout_token?: string;
  checkout_url?: string;
  description?: string;
  metadata?: Record<string, string>;
  customer_email?: string;
  success_url?: string;
  cancel_url?: string;
  /** Where this payment's events go instead of the webhook's URL, when it was created with one. */
  webhook_url?: string;
}

export interface CreatePaymentParams {
  /** Your id for the order; creating it again while it is open returns the same payment. */
  order_id: string;
  /** The price in US dollars. Leave it out to give `price_amount` and `price_currency` instead. */
  amount_usd?: number | string;
  /**
   * The price in another currency than the dollar, with `price_currency`, instead of `amount_usd`:
   * payitgo converts it into dollars at the rate of the moment.
   */
  price_amount?: number | string;
  /** The ISO 4217 code of `price_amount`'s currency, e.g. "EUR", "GBP" or "NGN" (any case). */
  price_currency?: string;
  /** A symbol from `tokens.list()`, e.g. "USDT_TRC20". Leave it out to let the customer choose on the checkout page. */
  token?: string;
  /** Without `token`: the coins to offer (default: every token the amount reaches the minimum of). */
  tokens?: string[];
  description?: string;
  metadata?: Record<string, string>;
  customer_email?: string;
  success_url?: string;
  cancel_url?: string;
  /**
   * An https:// URL that gets this payment's events (payment.* and its settlement.*)
   * instead of the webhook's URL, signed with the same secret. Default: the client's `webhookUrl`.
   */
  webhook_url?: string;
  /**
   * Test keys only: the outcome to simulate, as `payments.simulate` does. With `token` it
   * starts at once; without, once the coin is chosen.
   */
  simulate?: SimulationOutcome;
}

export interface ListPaymentsParams {
  status?: PaymentStatus;
  chain?: string;
  token?: string;
  /** Only the payments of this store (ignored for a storefront's key, which sees its own). */
  store_id?: string;
  limit?: number;
  offset?: number;
}

export interface PaymentList {
  payments: Payment[];
  total: number;
  limit: number;
  offset: number;
}

export interface TokenInfo {
  token: string;
  chain: string;
  /** The smallest payment accepted in the token right now (it moves with the network fee). */
  min_usd: string;
  /** The network fee for moving a payment in the token right now. */
  network_fee_usd: string;
  /** In a payment's token_options (or tokens.list with an amount), when fees are passed on: what the customer pays in this token. */
  amount_due_usd?: string;
  fee_note: string;
}

export interface WebhookEvent<T = any> {
  /** The event id: the same when the event is delivered again. */
  id: string;
  type: string;
  livemode: boolean;
  created_at: string;
  data: T;
}

/** The events payitgo sends. A test (`webhooks.test`) sends "ping". */
export type WebhookEventType =
  | "payment.partially_paid"
  | "payment.detecting"
  | "payment.confirmed"
  | "payment.underpaid"
  | "payment.expired"
  | "payment.failed"
  | "payment.wrong_asset"
  | "payment.late_deposit"
  | "payout.approved"
  | "payout.rejected"
  | "payout.sent"
  | "settlement.completed"
  | "settlement.failed"
  | "ping";

/**
 * The webhook (IPN) of the key's mode: the URL every event of the mode is POSTed to,
 * and the secret that signs them. A test key has the test webhook, a live key the live one.
 */
export interface Webhook {
  livemode: boolean;
  /** null when not set: events then go only to the payments created with their own webhook_url. */
  url: string | null;
  /** "whsec_…": signs every notification of the mode. Pass it to the client as `webhookSecret`. */
  secret: string;
  created_at: string;
  updated_at: string;
}

/** One try at a delivery, or a person's action on it. */
export interface WebhookDeliveryAttempt {
  at: string;
  /** Where it was actually posted. */
  url?: string;
  /** The signature's timestamp. */
  signed?: string;
  status_code?: number;
  error?: string;
  /** The start of the answer your server gave. */
  response?: string;
  millis?: number;
  /** Redelivered or resolved, and by whom. */
  note?: string;
}

/** One event on its way to one URL. */
export interface WebhookDelivery {
  id: string;
  merchant_id: string;
  /** "account": the webhook's URL (as it is at each attempt); "payment": the payment's own webhook_url. */
  target: "account" | "payment";
  url: string;
  event_id: string;
  event_type: string;
  /** The exact JSON body that is signed and posted. */
  payload: string;
  status: "pending" | "sending" | "delivered" | "failed" | "resolved";
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_status_code?: number;
  last_error?: string;
  last_attempt_at?: string;
  delivered_at?: string;
  resolved_at?: string;
  resolution_note?: string;
  created_at: string;
  history?: WebhookDeliveryAttempt[];
}

export interface PayitgoOptions {
  /** The gateway's address, e.g. "https://api.example.com". Defaults to PAYITGO_BASE_URL. */
  baseUrl?: string;
  /** Per-request timeout. Default 30 s. */
  timeoutMs?: number;
  /** Retries after a network error, a 429 or a 5xx. Default 2. */
  maxRetries?: number;
  /** The signing secret of the key's mode ("whsec_…"): `webhooks.constructEvent` uses it when given none. */
  webhookSecret?: string;
  /** Sent as `webhook_url` with every `payments.create` that does not pass its own. */
  webhookUrl?: string;
}

// ── Errors ────────────────────────────────────────────────────────────────────

/** The API refused the request; `status` is the HTTP status (0 for a network error). */
export class PayitgoError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "PayitgoError";
    this.status = status;
  }
}

/** A webhook request whose signature or timestamp did not check out. */
export class SignatureVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignatureVerificationError";
  }
}

// ── Webhooks ──────────────────────────────────────────────────────────────────

export const webhooks = {
  /**
   * Verifies a webhook request and returns its event. Pass the raw request
   * body (before any JSON parsing), the X-Webhook-Signature header and the
   * mode's signing secret. Throws SignatureVerificationError when the
   * signature is wrong or the timestamp is more than `toleranceSeconds` old
   * (0 disables the timestamp check).
   */
  constructEvent<T = any>(
    payload: string | Uint8Array,
    signatureHeader: string | undefined | null,
    secret: string,
    toleranceSeconds = 300,
  ): WebhookEvent<T> {
    const body = typeof payload === "string" ? Buffer.from(payload, "utf8") : Buffer.from(payload);
    const parts: Record<string, string> = {};
    for (const part of (signatureHeader ?? "").split(",")) {
      const i = part.indexOf("=");
      if (i > 0) parts[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    const t = parts["t"];
    const v1 = parts["v1"];
    if (!t || !v1) throw new SignatureVerificationError("missing or malformed X-Webhook-Signature header");
    const expected = createHmac("sha256", secret).update(`${t}.`).update(body).digest("hex");
    const given = Buffer.from(v1);
    if (given.length !== expected.length || !timingSafeEqual(given, Buffer.from(expected))) {
      throw new SignatureVerificationError("signature does not match");
    }
    if (toleranceSeconds > 0) {
      // A timestamp that is not a whole number of seconds cannot be checked: refuse it.
      if (!/^\d+$/.test(t)) throw new SignatureVerificationError("malformed timestamp");
      if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSeconds) {
        throw new SignatureVerificationError("timestamp outside the tolerance");
      }
    }
    return JSON.parse(body.toString("utf8")) as WebhookEvent<T>;
  },
};

// ── Client ────────────────────────────────────────────────────────────────────

/**
 * The payitgo client. Use it from your server only: the API key is a secret.
 *
 *   const payitgo = new Payitgo(process.env.PAYITGO_KEY!, { baseUrl: "https://api.example.com" });
 *   const payment = await payitgo.payments.create({ order_id: "ORD-1", amount_usd: 10, token: "USDT_TRC20" });
 */
export class Payitgo {
  /** false for a test key (sk_test_…), true for a live key (sk_live_…). */
  readonly livemode: boolean;
  readonly payments: Payments;
  readonly tokens: Tokens;
  readonly checkout: Checkout;
  /** Signature verification (`constructEvent`), also usable without a client. */
  static readonly webhooks = webhooks;
  /** The key's mode's webhook, and `constructEvent` to verify its notifications. */
  readonly webhooks: Webhooks;
  /** @internal */
  readonly webhookSecret?: string;
  /** @internal */
  readonly webhookUrl?: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(apiKey: string, options: PayitgoOptions = {}) {
    if (!/^sk_(test|live)_/.test(apiKey ?? "")) {
      throw new Error("payitgo: the API key must start with sk_test_ or sk_live_");
    }
    const baseUrl = options.baseUrl ?? process.env.PAYITGO_BASE_URL ?? DEFAULT_BASE_URL;
    if (!baseUrl) {
      throw new Error("payitgo: set baseUrl (or PAYITGO_BASE_URL) to your gateway's address");
    }
    this.apiKey = apiKey;
    this.livemode = apiKey.startsWith("sk_live_");
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.webhookSecret = options.webhookSecret || undefined;
    this.webhookUrl = options.webhookUrl || undefined;
    this.payments = new Payments(this);
    this.tokens = new Tokens(this);
    this.checkout = new Checkout(this);
    this.webhooks = new Webhooks(this);
  }

  /** @internal */
  async request<T>(method: string, path: string, body?: unknown, authenticated = true): Promise<T> {
    const headers: Record<string, string> = { "Accept": "application/json", "User-Agent": `payitgo-node/${VERSION}` };
    if (authenticated) headers["Authorization"] = `Bearer ${this.apiKey}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    for (let attempt = 0; ; attempt++) {
      let status: number;
      let text: string;
      try {
        // The timeout covers the whole attempt, reading the answer included.
        const res = await fetch(this.baseUrl + path, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        status = res.status;
        text = await res.text();
      } catch (err) {
        if (attempt < this.maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new PayitgoError(`payitgo: request failed: ${(err as Error).message}`, 0);
      }
      if ((status === 429 || status >= 500) && attempt < this.maxRetries) {
        await sleep(backoff(attempt));
        continue;
      }
      let json: any = undefined;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        // not JSON: reported below
      }
      if (status < 200 || status >= 300) {
        throw new PayitgoError(json?.error ?? `HTTP ${status}`, status);
      }
      return json as T;
    }
  }
}

class Payments {
  constructor(private readonly client: Payitgo) {}

  /** Creates a payment. Safe to retry: an order with an open payment returns that payment. */
  create(params: CreatePaymentParams): Promise<Payment> {
    const webhook_url = params.webhook_url ?? this.client.webhookUrl;
    return this.client.request("POST", "/v1/payments", webhook_url ? { ...params, webhook_url } : params);
  }

  /** A payment by its id (pay_…) or by your order id (the order's open payment). */
  retrieve(id: string): Promise<Payment> {
    return this.client.request("GET", `/v1/payments/${encodeURIComponent(id)}`);
  }

  /**
   * Sets the coin of a payment created without one, when the customer chose it on your
   * own page: one of its `token_options`. `id` is the payment's id (pay_…) or your order id.
   * Returns the whole payment, now with its address, amount, locked rate and a deadline
   * 15 minutes away. The coin is chosen once: choosing again is a 409.
   */
  selectToken(id: string, token: string): Promise<Payment> {
    return this.client.request("POST", `/v1/payments/${encodeURIComponent(id)}/token`, { token });
  }

  /**
   * Plays an outcome on a test payment: payitgo sends its deposits, status changes and
   * webhooks a few seconds apart, with no coins. `id` is the payment's id (pay_…) or your
   * order id. Returns the whole payment, with its `simulation`. A live payment is a 400;
   * a simulation that is still running, a 409.
   */
  simulate(id: string, outcome: SimulationOutcome): Promise<Payment> {
    return this.client.request("POST", `/v1/payments/${encodeURIComponent(id)}/simulate`, { outcome });
  }

  /** Payments of the key's mode, newest first. */
  list(params: ListPaymentsParams = {}): Promise<PaymentList> {
    return this.client.request("GET", `/v1/payments${query(params)}`);
  }
}

class Tokens {
  constructor(private readonly client: Payitgo) {}

  /**
   * The tokens a customer can pay with in the key's mode. With `amount_usd`,
   * only the ones a payment of that amount offers (its `token_options`), each
   * with `amount_due_usd` when fees are passed on: list them on your page,
   * then create the payment with the customer's choice.
   */
  async list(params: { amount_usd?: string | number } = {}): Promise<TokenInfo[]> {
    const query = params.amount_usd !== undefined ? `?amount_usd=${encodeURIComponent(String(params.amount_usd))}` : "";
    const res = await this.client.request<{ tokens: TokenInfo[] }>("GET", "/v1/tokens" + query);
    return res.tokens;
  }
}

class Checkout {
  constructor(private readonly client: Payitgo) {}

  /** The payer's view of a payment, by its checkout token. Public: sent without the API key. */
  retrieve(checkoutToken: string): Promise<Payment> {
    return this.client.request("GET", `/checkout/${encodeURIComponent(checkoutToken)}`, undefined, false);
  }

  /** The customer's choice of coin for a payment created without one. Public. */
  selectToken(checkoutToken: string, token: string): Promise<Payment> {
    return this.client.request("POST", `/checkout/${encodeURIComponent(checkoutToken)}/token`, { token }, false);
  }
}

/**
 * The webhook (IPN) of the key's mode: a test key manages the test webhook, a
 * live key the live one. A storefront's key may read and test it, not change it.
 */
class Webhooks {
  constructor(private readonly client: Payitgo) {}

  /** The webhook: its URL (null when not set) and its signing secret. */
  async get(): Promise<Webhook> {
    const res = await this.client.request<{ webhook: Webhook }>("GET", "/v1/webhook");
    return res.webhook;
  }

  /**
   * Sets the URL every event of the mode is POSTed to: https:// on a public host,
   * accepting POST requests. Safe to retry.
   */
  async set(url: string): Promise<Webhook> {
    const res = await this.client.request<{ webhook: Webhook }>("PUT", "/v1/webhook", { url });
    return res.webhook;
  }

  /** Stops POSTing to the URL (payments with their own webhook_url still get theirs); the secret stays. */
  async remove(): Promise<Webhook> {
    const res = await this.client.request<{ webhook: Webhook }>("DELETE", "/v1/webhook");
    return res.webhook;
  }

  /** Queues a signed "ping" event to the URL and returns its delivery. */
  async test(): Promise<WebhookDelivery> {
    const res = await this.client.request<{ delivery: WebhookDelivery }>("POST", "/v1/webhook/test");
    return res.delivery;
  }

  /**
   * Verifies a webhook request and returns its event; see `webhooks.constructEvent`.
   * `secret` defaults to the client's `webhookSecret`.
   */
  constructEvent<T = any>(
    payload: string | Uint8Array,
    signatureHeader: string | undefined | null,
    secret?: string,
    toleranceSeconds = 300,
  ): WebhookEvent<T> {
    const key = secret || this.client.webhookSecret;
    if (!key) throw new SignatureVerificationError("no webhook secret: pass one, or set the client's webhookSecret");
    return webhooks.constructEvent<T>(payload, signatureHeader, key, toleranceSeconds);
  }
}

function query(params: object): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

function backoff(attempt: number): number {
  return 500 * 2 ** attempt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default Payitgo;
