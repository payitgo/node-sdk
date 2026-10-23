import { createHmac, timingSafeEqual } from "node:crypto";

export const VERSION = "0.7.1";

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
/** A coin chosen for a payment before its current one, when the customer changed it. Its address is still watched. */
export interface PreviousCoin {
  token: string;
  chain: string;
  deposit_address: string;
  destination_tag?: number;
  crypto_amount: string;
  rate_locked: string;
}

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
  /** The address it was sent to: the payment's deposit_address, or a previous coin's. */
  to?: string;
  /** The block (on XRP, the ledger) that holds it. */
  block?: number;
  /** That block's time. */
  made_at?: string;
  /** When it failed: it never became final and nothing was settled. */
  failed_at?: string;
  /** Why it failed: "transaction not found on chain" or "confirmation timeout". */
  fail_reason?: string;
  /** Played by a test payment's simulation: its tx_id names no transaction on any chain. */
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
  /** While token is empty, or while the coin can still change: the coins the customer may choose from. */
  token_options?: TokenInfo[];
  /** The coins chosen before token, when the customer changed it. */
  previous_coins?: PreviousCoin[];
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
  | "payout_batch.quoted"
  | "payout_batch.pending_approval"
  | "payout_batch.approved"
  | "payout_batch.rejected"
  | "payout_batch.awaiting_funds"
  | "payout_batch.processing"
  | "payout_batch.completed"
  | "payout_batch.canceled"
  | "payout_item.processing"
  | "payout_item.returned"
  | "payout_item.sent"
  | "payout_item.failed"
  | "payout_item.canceled"
  | "payout_item.claimed"
  | "payout_item.claim_expired"
  | "payout_wallet.withdrawn"
  | "payout_wallet.withdrawal_failed"
  | "payout_schedule.run"
  | "payout_schedule.funding_needed"
  | "ping";

export interface ListEventsParams {
  /** Event types such as "payout_item.sent", or families such as "payout_item.*": one, or several. */
  type?: WebhookEventType | (string & {}) | (WebhookEventType | (string & {}))[];
  /** An event's id: the events after it. */
  after?: string;
  /** The events after this time (a Date is sent as its ISO string); ignored with `after`. */
  created_after?: Date | string;
  /** Page size, 1 to 200 (default 100). */
  limit?: number;
}

/** A page of `events.list`: events oldest first, each as its webhook carried it. */
export interface EventList {
  events: WebhookEvent[];
  /** More events follow: call again with `after` = the last event's id. */
  has_more: boolean;
}

/**
 * The webhook (IPN) of the key's mode: the URL every event of the mode is POSTed to,
 * and the secret that signs them. A test key has the test webhook, a live key the live one.
 */
export interface Webhook {
  livemode: boolean;
  /** null when not set: events then go only to the payments created with their own webhook_url. */
  url: string | null;
  /** Signs every notification of the mode. Pass it to the client as `webhookSecret`. */
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

// ── Payout types ──────────────────────────────────────────────────────────────

/** A payout batch's status. Only a validating or quoted batch can change. */
export type PayoutBatchStatus =
  | "validating"
  | "quoted"
  | "pending_approval"
  | "awaiting_funds"
  | "processing"
  | "completed"
  | "canceled"
  | "rejected";

/**
 * A payment's (a payout request's) status. A claim link's payment is "claimable" once
 * funded, until its recipient claims it (then queued) or the link ends ("expired": its
 * money is free again).
 */
export type PayoutItemStatus =
  | "validating"
  | "ready"
  | "invalid"
  | "cooling"
  | "queued"
  | "claimable"
  | "sending"
  | "sent"
  | "failed"
  | "canceled"
  | "expired";

/**
 * Why a payment was canceled: "removed" (taken out of your list of payout requests),
 * "canceled" (the payment alone, by your team or an API key), "batch_canceled" (its batch
 * was canceled), "rejected" (its batch was rejected: `cancel_note` says why) or "invalid"
 * (no longer payable when its batch was submitted or funded: `errors` say why).
 */
export type PayoutCancelReason =
  | "removed"
  | "canceled"
  | "batch_canceled"
  | "rejected"
  | "invalid";

/**
 * How a batch pays coins its wallet does not hold: "same_network" (each payment from the
 * wallet's balance of its own coin) or "convert" (every payment in another coin than
 * `convert_from` is paid from `convert_from`, converted on its way).
 */
export type PayoutConvertRule = "same_network" | "convert";

/** Who pays a payout's fees: "merchant" (on top of the amount) or "recipient" (out of it). */
export type PayoutFeePaidBy = "merchant" | "recipient";

/** Something wrong with a payment (in `errors`: it is left out) or worth knowing (in `warnings`). */
export interface PayoutIssue {
  /** For programs: "wrong_network", "below_minimum", "new_recipient", … New codes may be added. */
  code: string;
  /** The field at fault: asset, amount, address, tag or reference. */
  field?: string;
  /** For people: what is wrong. */
  message: string;
  /** For people: what to do. */
  hint?: string;
}

/**
 * A claim link: a payment its recipient claims, choosing the coin (its own, or one of
 * `assets`, at the same dollar value) and the address. Emailed to `email` when there is
 * one (the recipient confirms with a code sent there); otherwise you share `url`, and give
 * `pin` another way (a call, a text message): the link alone pays no one.
 */
export interface PayoutClaim {
  email?: string;
  /** The other coins the recipient may choose; [] when only the payment's own. */
  assets: string[];
  /** Set when it is funded: the link works until then. */
  expires_at?: string;
  claimed_at?: string;
  /** How many times the link was emailed. */
  emailed: number;
  last_email_at?: string;
  /** How many times it was extended. */
  extended: number;
  /** The link to give the recipient. Absent in a quote. */
  url?: string;
  /** A link without an email: the 6 digits its recipient enters to claim it. Give it apart from the link. */
  pin?: string;
  /** 5 wrong PINs were entered: a new PIN from the dashboard unlocks it. */
  pin_locked?: boolean;
  /** When the recipient chose another coin: what the payment was funded with. */
  funded_asset?: string;
  funded_amount?: string;
}

/**
 * A payment converted on its way: the recipient receives `to`, paid from the wallet's
 * coin (the payment's `asset`). The payment's amount, fees and debit are in the wallet's
 * coin, its `address` is on `to`'s network.
 */
export interface PayoutConversion {
  /** The coin the recipient receives. */
  to: string;
  ticker: string;
  network: string;
  /** What you asked to pay, in `to`. */
  to_amount: string;
  /** About what arrives, in `to`. */
  estimate: string;
  /** What arrived, once sent. */
  amount_out?: string;
}

/** Who a payment is for, as you named them. Each field is absent when empty. */
export interface PayoutRecipient {
  name?: string;
  email?: string;
  note?: string;
}

/** One payment to a recipient: a payout request, or a row of a batch. Amounts are decimal strings in its coin. */
export interface PayoutItem {
  id: string;
  merchant_id: string;
  livemode: boolean;
  /**
   * Its batch: while it waits in your open list of payout requests, that list's id.
   * Absent for a request removed from the list (its record stays: canceled, cancel_reason "removed").
   */
  batch_id?: string;
  /** Your id for it, unique in its mode. */
  reference?: string;
  /** A reference given that another payment carries already: it keeps none, and is invalid. */
  refused_reference?: string;
  /** Once canceled or failed (never sent): the reference it had, given back for a new payment to use. */
  released_reference?: string;
  /** Its place in its batch, from 1. */
  row: number;
  recipient: PayoutRecipient;
  /** The coin the wallet pays it in: "USDT_TRC20", "BTC", … (for a converted payment, `convert_from`). */
  asset: string;
  /** What people call the coin ("USDT"), and its icon. Absent for a coin payouts do not know. */
  ticker?: string;
  icon_url?: string;
  chain: string;
  /** The recipient's address ("" for a claim link until it is claimed). */
  address: string;
  /** XRP's destination tag. */
  tag?: number;
  /** What you asked to pay (converted: its worth in the wallet's coin). */
  amount: string;
  /** What reaches the recipient: amount, or amount less fee when the recipient pays the fees. */
  send_amount: string;
  /** The whole fee: a converted payment's converting included. */
  fee: string;
  /** What it takes from the payout wallet. */
  debit: string;
  /** The coin's dollar price when it was priced. */
  usd_rate: string;
  amount_usd: string;
  status: PayoutItemStatus;
  /** Why it is invalid; [] when nothing is wrong. */
  errors: PayoutIssue[];
  /** Worth knowing, and it still goes; [] when none. */
  warnings: PayoutIssue[];
  /** A new recipient's payment waits until then. */
  cooling_until?: string;
  /** Its transaction, once sent (made up in test mode). */
  tx_id?: string;
  /** The transaction on the block explorer (live only). */
  explorer_url?: string;
  fail_reason?: string;
  /** Once canceled: why. */
  cancel_reason?: PayoutCancelReason;
  /** With cancel_reason "rejected": the approver's reason. */
  cancel_note?: string;
  /** Who canceled it: a team member's id, an API key's id, or "system" (payitgo itself). */
  canceled_by?: string;
  canceled_at?: string;
  /** The email of the team member in canceled_by, by id. */
  members?: Record<string, string>;
  /** Where its events go instead of its batch's webhook_url or the account's webhook URL. */
  webhook_url?: string;
  /** A claim link's state. */
  claim?: PayoutClaim;
  /** A payment converted on its way. */
  convert?: PayoutConversion;
  /** The fee given back for a payment never sent, taken off your next fees in its coin. */
  fee_credit?: string;
  sent_at?: string;
  created_at: string;
  updated_at: string;
}

/** A payment as a quote prices it: nothing is kept, so it has no id, merchant_id, batch_id or times. */
export type PayoutQuoteItem = Omit<PayoutItem, "id" | "merchant_id" | "batch_id" | "created_at" | "updated_at">;

/** A batch's valid payments in one coin: what they send, what they pay, and what the wallet gives (debit). */
export interface PayoutAssetTotal {
  asset: string;
  ticker: string;
  icon_url: string;
  chain: string;
  /** The network for people: "Tron (TRC-20)". */
  network: string;
  /** How many payments. */
  items: number;
  amount: string;
  send_amount: string;
  fee: string;
  debit: string;
  debit_usd: string;
  /** What sending them together saves in network fees against one transfer each. */
  saved_usd: string;
}

/** A batch's payments by status. */
export interface PayoutCounts {
  total: number;
  invalid: number;
  ready: number;
  cooling: number;
  queued: number;
  sending: number;
  sent: number;
  failed: number;
  canceled: number;
  claimable: number;
  expired: number;
}

/** How much more of a coin the payout wallet needs, and the address to send it to. */
export interface PayoutShortfall {
  asset: string;
  network: string;
  amount: string;
  address: string;
}

/** Why a batch awaiting funds waits, and since when. */
export interface PayoutWaiting {
  /** funds (top the wallet up: shortfall), daily_limit (funded from 00:00 UTC) or paused (contact support). */
  reason: "funds" | "daily_limit" | "paused";
  /** The same, for people. */
  note: string;
  since: string;
  /** For funds: what to send where. */
  shortfall?: PayoutShortfall[];
}

/** A team member's approval of a batch. */
export interface PayoutApproval {
  user_id: string;
  at: string;
}

/** Who decided, when, and why: a rejected batch's `rejection`. */
export interface PayoutDecision {
  by: string;
  at: string;
  reason: string;
}

/** A set of payments, checked, priced, approved and funded together. */
export interface PayoutBatch {
  id: string;
  merchant_id: string;
  livemode: boolean;
  /** Your id for it, unique in its mode: creating a batch with it again returns this batch. */
  reference?: string;
  /** Your name for it; "" when none. */
  name: string;
  /** Where it came from: "requests" for payout requests sent together, "schedule" for a schedule's run. */
  source: "api" | "dashboard" | "csv" | "requests" | "schedule";
  /** Made of payout requests. */
  inbox: boolean;
  /** Your open list of payout requests itself (never submitted: sending moves its requests into a batch). */
  open: boolean;
  /** The team member who made it, or the API key's id (by_api_key). */
  created_by: string;
  by_api_key: boolean;
  fee_paid_by: PayoutFeePaidBy;
  convert: PayoutConvertRule;
  /** With convert: the coin its payments in other coins are paid from. */
  convert_from?: string;
  /** Where its events go instead of the account's webhook URL. */
  webhook_url?: string;
  status: PayoutBatchStatus;
  /** While awaiting_funds: why it waits. */
  waiting?: PayoutWaiting;
  /** Its valid payments, per coin. */
  totals: PayoutAssetTotal[];
  counts: PayoutCounts;
  /** What it takes from the wallet, in dollars. */
  total_usd: string;
  /** Its prices hold until then (an hour; 15 minutes with converted payments). */
  quote_expires_at?: string;
  approvals_needed: number;
  approvals: PayoutApproval[];
  rejection?: PayoutDecision;
  submitted_by?: string;
  submitted_at?: string;
  funded_at?: string;
  completed_at?: string;
  canceled_by?: string;
  canceled_at?: string;
  created_at: string;
  updated_at: string;
}

/** What sending the valid payout requests in one coin needs, against what the wallet can spend. */
export interface PayoutCoverage {
  asset: string;
  ticker: string;
  network: string;
  /** Their debits together. */
  needed: string;
  spendable: string;
  /** What to send to `address` first: needed less spendable, "0" when covered. */
  top_up: string;
  address: string;
}

/** Your open payout requests: the list, what sending them needs of each coin, and a page of the requests. */
export interface PayoutInbox {
  /** The list itself, a batch with inbox and open true: its totals and counts. */
  inbox: PayoutBatch;
  coverage: PayoutCoverage[];
  items: PayoutItem[];
  total: number;
  limit: number;
  offset: number;
}

/** What a payout wallet holds of one coin. */
export interface PayoutWalletAsset {
  asset: string;
  ticker: string;
  icon_url: string;
  /** On chain (on paper in test mode). */
  balance: string;
  /** Promised to payments funded, and fees and withdrawals not sent yet. */
  reserved: string;
  /** balance less reserved: what a new batch can use. */
  spendable: string;
  /** What batches awaiting funds need beyond spendable: the top-up to send now. */
  needed: string;
}

/** Your payout wallet on one chain: where to top it up, and what it holds. */
export interface PayoutWallet {
  /** "tron", "bsc", "ethereum", "bitcoin", "litecoin", "dogecoin" or "xrp". */
  chain: string;
  network: string;
  address: string;
  /** Live only. */
  explorer_url?: string;
  livemode: boolean;
  assets: PayoutWalletAsset[];
  /** Why its balances could not be read just now (they are then "0"). */
  error?: string;
}

/**
 * A payout wallet's funds sent back to one of your payout addresses: a payout_wallet.withdrawn
 * or payout_wallet.withdrawal_failed event's data.
 */
export interface PayoutWithdrawal {
  id: string;
  merchant_id: string;
  livemode: boolean;
  asset: string;
  chain: string;
  /** What leaves the wallet: fee goes to payitgo, send_amount arrives. */
  amount: string;
  fee: string;
  send_amount: string;
  address_id: string;
  address: string;
  tag?: number;
  status: "requested" | "sending" | "sent" | "failed";
  tx_id?: string;
  explorer_url?: string;
  /** Why a failed withdrawal failed: its money stays in the wallet. */
  fail_reason?: string;
  requested_by: string;
  created_at: string;
  updated_at: string;
  sent_at?: string;
}

/** What a batch of the quoted payments would total. */
export interface PayoutQuote {
  livemode: boolean;
  fee_paid_by: PayoutFeePaidBy;
  convert: PayoutConvertRule;
  /** Present when the payments are converted: the coin the wallet pays them from. */
  convert_from?: string;
  totals: PayoutAssetTotal[];
  total_usd: string;
  counts: PayoutCounts;
}

/** `payouts.quote`'s answer: the totals, and each payment as it would be. */
export interface PayoutQuoteResult {
  quote: PayoutQuote;
  items: PayoutQuoteItem[];
}

export interface PayoutBatchList {
  batches: PayoutBatch[];
  total: number;
  limit: number;
  offset: number;
}

export interface PayoutItemList {
  items: PayoutItem[];
  total: number;
  limit: number;
  offset: number;
}

/** A page of `payouts.list`: payments oldest change first, and where the next read starts. */
export interface PayoutList {
  items: PayoutItem[];
  /** More changed payments follow: call again with `cursor` = next_cursor. */
  has_more: boolean;
  /**
   * Where the next read starts: keep it, and call again with it later to get what changed
   * since. Absent when the page is empty.
   */
  next_cursor?: string;
}

/** What `payouts.remove` did with one id: the request, now canceled (`item`), or why not (`error`). */
export interface PayoutRemoveResult {
  id: string;
  /** Removed now or already: status "canceled", cancel_reason "removed", no batch_id. */
  item?: PayoutItem;
  /** 404 not found; 409 sent from the list already, or ended. */
  error?: { status: number; message: string };
}

/**
 * A payment to make: a row of a batch or a quote, or a payout request. With `claim: true`
 * or `claim_assets` (and no `address`), it is a claim link: its recipient chooses where
 * to receive it.
 */
export interface PayoutItemInput {
  /** A payout coin, such as "USDT_TRC20" or "BTC" (any case). */
  asset: string;
  /** The recipient's address on the coin's network. Required, except for a claim link (which takes none). */
  address?: string;
  /** How much of the coin, e.g. "120". A string avoids float rounding. */
  amount: number | string;
  /** Your id for it, unique in its mode: a row whose reference another payment carries is invalid (duplicate_reference). */
  reference?: string;
  /** XRP's destination tag. */
  tag?: number;
  name?: string;
  /** The recipient's email: a claim link's is emailed the link (without one, you share `claim.url`). */
  email?: string;
  note?: string;
  /** Makes it a claim link. */
  claim?: boolean;
  /** A claim link's other coins the recipient may choose, paid at the same dollar value (makes it a claim link too). */
  claim_assets?: string[];
  /**
   * An https:// URL on a public host that gets this payment's events instead of its batch's
   * webhook_url or the account's webhook URL (a request keeps it when it is sent into a
   * batch). The payments of one call may name at most 10 different ones. A quote ignores it.
   */
  webhook_url?: string;
}

/** One of your clients' payout requests: `payouts.request`. */
export interface RequestPayoutParams extends PayoutItemInput {
  /** Your id for it (the client's withdrawal request), unique in its mode: sending it again returns that payment. */
  reference?: string;
}

export interface CreatePayoutBatchParams {
  /** Your id for the batch, unique in its mode: creating it again returns that batch. */
  reference?: string;
  name?: string;
  /** Default: your payout settings'. */
  fee_paid_by?: PayoutFeePaidBy;
  /** Default: your payout settings'. */
  convert?: PayoutConvertRule;
  /** With convert: the wallet's coin to pay other coins from, e.g. "USDT_TRC20". Default: your payout settings'. */
  convert_from?: string;
  /** An https:// URL that gets this batch's events instead of the account's webhook URL (a payment's own webhook_url wins). */
  webhook_url?: string;
  /** 1 to 1000 payments; add more with `payoutBatches.addItems`. */
  items: PayoutItemInput[];
}

export interface PayoutQuoteParams {
  fee_paid_by?: PayoutFeePaidBy;
  convert?: PayoutConvertRule;
  convert_from?: string;
  /** 1 to 100 payments. */
  items: PayoutItemInput[];
}

/** What a schedule's rows pay in one coin at each run (fees aside: priced at the run). */
export interface PayoutScheduleTotal {
  asset: string;
  ticker: string;
  items: number;
  amount: string;
}

/**
 * A payout schedule (made in the dashboard): the same batch made again and again, as
 * the payout_schedule.* events carry it: a summary, without its rows.
 */
export interface PayoutSchedule {
  id: string;
  livemode: boolean;
  name: string;
  status: "active" | "paused";
  /** weekly or biweekly (on `weekday`, 0 Sunday to 6 Saturday), or monthly (on `day`: 1 to 28, -1 the last). */
  cadence: "weekly" | "biweekly" | "monthly";
  weekday: number;
  day: number;
  /** The time of day, "HH:MM", in `timezone`. */
  at: string;
  timezone: string;
  fee_paid_by: PayoutFeePaidBy;
  /** Each run's batch is submitted by itself. */
  auto_submit: boolean;
  /** How many days before a run a wallet short of funds is announced (payout_schedule.funding_needed). */
  remind_days: number;
  /** What its rows pay, per coin, at each run. */
  totals: PayoutScheduleTotal[];
  /** null when it has none (paused). */
  next_run_at: string | null;
  last_run_at: string | null;
  /** The batch its last run made; "" when none. */
  last_batch_id: string;
  /** Why its last run made no batch; "" when it made one. */
  last_error: string;
  runs: number;
}

/** A payout_schedule.funding_needed event's data: what the wallet lacks for the schedule's next run. */
export interface PayoutScheduleFunding {
  schedule: PayoutSchedule;
  shortfall: PayoutShortfall[];
}

export interface ListPayoutBatchesParams {
  status?: PayoutBatchStatus;
  limit?: number;
  offset?: number;
}

export interface ListPayoutItemsParams {
  /** One status, or several. */
  status?: PayoutItemStatus | PayoutItemStatus[];
  limit?: number;
  offset?: number;
}

export interface ListPayoutsParams {
  /** One status, or several. */
  status?: PayoutItemStatus | PayoutItemStatus[];
  /** Only the payments changed at or after this time (a Date is sent as its ISO string). */
  updated_since?: Date | string;
  /** The `next_cursor` of the page before: the payments changed after the last one it listed. */
  cursor?: string;
  /** Page size, 1 to 200 (default 50). */
  limit?: number;
}

export interface PayitgoOptions {
  /** payitgo's API address. Defaults to PAYITGO_BASE_URL, then "https://api.payitgo.co". */
  baseUrl?: string;
  /** Per-request timeout. Default 30 s. */
  timeoutMs?: number;
  /** Retries after a network error, a 429 or a 5xx. Default 2. */
  maxRetries?: number;
  /** The signing secret of the key's mode: `webhooks.constructEvent` uses it when given none. */
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
 *   const payitgo = new Payitgo(process.env.PAYITGO_KEY!);
 *   const payment = await payitgo.payments.create({ order_id: "ORD-1", amount_usd: 10, token: "USDT_TRC20" });
 */
export class Payitgo {
  readonly payments: Payments;
  readonly tokens: Tokens;
  readonly checkout: Checkout;
  /** Your clients' payout requests, one by one, from your payout wallet. */
  readonly payouts: Payouts;
  /** Payout batches: a whole list of payments at once. */
  readonly payoutBatches: PayoutBatches;
  /** Your payout wallets: where to top them up, and what they hold. */
  readonly payoutWallets: PayoutWallets;
  /** Signature verification (`constructEvent`), also usable without a client. */
  static readonly webhooks = webhooks;
  /** The key's mode's webhook, and `constructEvent` to verify its notifications. */
  readonly webhooks: Webhooks;
  /** The key's mode's events, as their webhooks carried them: to replay any you missed. */
  readonly events: Events;
  /** @internal */
  readonly webhookSecret?: string;
  /** @internal */
  readonly webhookUrl?: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  /** The key's mode, once payitgo has said it (isLive). */
  private live?: boolean;

  constructor(apiKey: string, options: PayitgoOptions = {}) {
    if (typeof apiKey !== "string" || !apiKey.trim()) {
      throw new Error("payitgo: the API key is required");
    }
    const baseUrl = options.baseUrl ?? process.env.PAYITGO_BASE_URL ?? DEFAULT_BASE_URL;
    if (!baseUrl) {
      throw new Error("payitgo: baseUrl is empty: leave it out to use https://api.payitgo.co");
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.webhookSecret = options.webhookSecret || undefined;
    this.webhookUrl = options.webhookUrl || undefined;
    this.payments = new Payments(this);
    this.tokens = new Tokens(this);
    this.checkout = new Checkout(this);
    this.payouts = new Payouts(this);
    this.payoutBatches = new PayoutBatches(this);
    this.payoutWallets = new PayoutWallets(this);
    this.webhooks = new Webhooks(this);
    this.events = new Events(this);
  }

  /**
   * Whether the key is a live key (its payments are real) rather than a test key.
   * payitgo says which (`GET /v1/webhook`'s `livemode`) the first time; the answer
   * is kept for the client's life. Rejects with a PayitgoError when payitgo refuses
   * the key or cannot be reached.
   */
  async isLive(): Promise<boolean> {
    if (this.live === undefined) this.live = (await this.webhooks.get()).livemode;
    return this.live;
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

  /** A payment by its id or by your order id (the order's open payment). */
  retrieve(id: string): Promise<Payment> {
    return this.client.request("GET", `/v1/payments/${encodeURIComponent(id)}`);
  }

  /**
   * Sets the coin of a payment created without one, when the customer chose it on your
   * own page: one of its `token_options`. `id` is the payment's id or your order id.
   * Returns the whole payment, now with its address, amount, locked rate and a deadline
   * 15 minutes away. Another coin changes it while the payment still has `token_options`;
   * once it can no longer change, a 409.
   */
  selectToken(id: string, token: string): Promise<Payment> {
    return this.client.request("POST", `/v1/payments/${encodeURIComponent(id)}/token`, { token });
  }

  /**
   * Plays an outcome on a test payment: payitgo sends its deposits, status changes and
   * webhooks a few seconds apart, with no coins. `id` is the payment's id or your
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

  /** The customer's choice of coin for a payment created without one, or a change of it. Public. */
  selectToken(checkoutToken: string, token: string): Promise<Payment> {
    return this.client.request("POST", `/checkout/${encodeURIComponent(checkoutToken)}/token`, { token }, false);
  }
}

/**
 * Payout requests: your system sends each of its clients' payout requests as it
 * comes in; payitgo checks and prices it and keeps it in your open list, with
 * its costs, until you send the list (or it goes by itself with auto-send).
 * Paid from your payout wallet in the key's mode. Reading works with any key;
 * the rest needs a key with payouts turned on (403 otherwise).
 */
class Payouts {
  constructor(private readonly client: Payitgo) {}

  /**
   * Adds one of your clients' payout requests to your open list, checked and
   * priced at once. An invalid one is kept too (status "invalid", `errors`
   * say why) and is never sent. Safe to retry with a `reference`: a reference
   * already used returns that payment.
   */
  async request(params: RequestPayoutParams): Promise<PayoutItem> {
    const res = await this.client.request<{ item: PayoutItem }>("POST", "/v1/payouts", params);
    return res.item;
  }

  /** A payment by its id: a payout request, or a row of any batch. */
  async retrieve(id: string): Promise<PayoutItem> {
    const res = await this.client.request<{ item: PayoutItem }>("GET", `/v1/payouts/${encodeURIComponent(id)}`);
    return res.item;
  }

  /**
   * A payment by your reference: the payout request or batch row carrying it, or else
   * the latest payment that gave it back (canceled, failed or expired, with it as
   * `released_reference`): what became of a request sent with it. An empty
   * reference is refused (400) without a request.
   */
  async retrieveByReference(reference: string): Promise<PayoutItem> {
    // Sent empty, it would read as payouts.list.
    if (!reference) throw new PayitgoError("payitgo: reference is required", 400);
    const res = await this.client.request<{ item: PayoutItem }>("GET", `/v1/payouts${query({ reference })}`);
    return res.item;
  }

  /**
   * The key's mode's payments across batches (requests in your list, removed ones,
   * every batch's), oldest change first: to bring your system back in sync. Call again
   * with `cursor` = next_cursor while has_more; then keep next_cursor, and call again
   * with it later to get what changed since. Changes of the last few seconds are left
   * for the next read.
   */
  list(params: ListPayoutsParams = {}): Promise<PayoutList> {
    return this.client.request("GET", `/v1/payouts${query(params)}`);
  }

  /**
   * Your open list of payout requests: the list (a batch with its totals and
   * counts), what sending its valid requests needs of each coin against what
   * the wallet can spend (`coverage`, with the `top_up` to send first), and a
   * page of the requests.
   */
  inbox(params: ListPayoutItemsParams = {}): Promise<PayoutInbox> {
    return this.client.request("GET", `/v1/payouts/inbox${query(params)}`);
  }

  /**
   * Sends your open payout requests: every valid one, or those of `ids`. They
   * move into a batch of their own, priced again and submitted: it then waits
   * for approval and/or funds, or starts. Returns that batch. An empty `ids`
   * is refused (400) rather than read as "every request".
   */
  async send(ids?: string[]): Promise<PayoutBatch> {
    if (ids !== undefined && ids.length === 0) {
      throw new PayitgoError("payitgo: ids is empty: leave it out to send every valid request", 400);
    }
    const res = await this.client.request<{ batch: PayoutBatch }>("POST", "/v1/payouts/send", ids ? { ids } : {});
    return res.batch;
  }

  /**
   * Takes a payment out: a request still in your open list is removed (its
   * record kept: cancel_reason "removed", no batch_id); any other payment not
   * on its way yet (in a batch not funded yet, or funded and queued, cooling
   * or claimable) is canceled (cancel_reason "canceled"). Returns it, status
   * "canceled". Safe to retry: a payment canceled already is returned as it is.
   */
  async cancel(id: string): Promise<PayoutItem> {
    const res = await this.client.request<{ item: PayoutItem }>("DELETE", `/v1/payouts/${encodeURIComponent(id)}`);
    return res.item;
  }

  /**
   * Takes 1 to 1000 payout requests out of your open list at once: each one
   * still there is removed as `cancel` removes it. Returns a result per id
   * (duplicates once), in the order given: `item` when it is removed (now or
   * already: safe to retry), or `error` (404 not found; 409 sent from the
   * list already, or ended). An empty `ids` is refused (400) without a request.
   */
  async remove(ids: string[]): Promise<PayoutRemoveResult[]> {
    if (!ids || ids.length === 0) {
      throw new PayitgoError("payitgo: ids is empty: name at least one payout request to remove", 400);
    }
    const res = await this.client.request<{ results: PayoutRemoveResult[] }>("POST", "/v1/payouts/remove", { ids });
    return res.results;
  }

  /**
   * What up to 100 payments would cost, checked and priced as in a batch,
   * without keeping anything: the totals, and each payment as it would be.
   */
  quote(params: PayoutQuoteParams): Promise<PayoutQuoteResult> {
    return this.client.request("POST", "/v1/payout-quotes", params);
  }
}

/**
 * Payout batches: a whole list of payments at once, checked and priced when
 * made, then submitted, approved (when your payout settings ask) and funded
 * from your payout wallet. Only a validating or quoted batch can change.
 */
class PayoutBatches {
  constructor(private readonly client: Payitgo) {}

  /**
   * Makes a batch of 1 to 1000 payments, checked and priced: "quoted" (or
   * "validating", checked in the background, past 100). Safe to retry with a
   * `reference`: a reference already used returns that batch.
   */
  async create(params: CreatePayoutBatchParams): Promise<PayoutBatch> {
    const res = await this.client.request<{ batch: PayoutBatch }>("POST", "/v1/payout-batches", params);
    return res.batch;
  }

  /** Batches of the key's mode, newest first. */
  list(params: ListPayoutBatchesParams = {}): Promise<PayoutBatchList> {
    return this.client.request("GET", `/v1/payout-batches${query(params)}`);
  }

  async retrieve(id: string): Promise<PayoutBatch> {
    const res = await this.client.request<{ batch: PayoutBatch }>("GET", `/v1/payout-batches/${encodeURIComponent(id)}`);
    return res.batch;
  }

  /** A batch's payments, in row order. */
  items(id: string, params: ListPayoutItemsParams = {}): Promise<PayoutItemList> {
    return this.client.request("GET", `/v1/payout-batches/${encodeURIComponent(id)}/items${query(params)}`);
  }

  /** Adds 1 to 1000 payments to a validating or quoted batch; the whole batch is priced again. */
  async addItems(id: string, items: PayoutItemInput[]): Promise<PayoutBatch> {
    const res = await this.client.request<{ batch: PayoutBatch }>("POST", `/v1/payout-batches/${encodeURIComponent(id)}/items`, { items });
    return res.batch;
  }

  /** Checks and prices a batch not submitted yet again: its prices then hold for another hour. */
  async quote(id: string): Promise<PayoutBatch> {
    const res = await this.client.request<{ batch: PayoutBatch }>("POST", `/v1/payout-batches/${encodeURIComponent(id)}/quote`);
    return res.batch;
  }

  /**
   * Sends a quoted batch on: pending_approval, or awaiting_funds (`waiting`
   * says why, with the shortfall to send), or processing when the wallet
   * covers it. A 409 when its prices expired: `quote` it again first.
   */
  async submit(id: string): Promise<PayoutBatch> {
    const res = await this.client.request<{ batch: PayoutBatch }>("POST", `/v1/payout-batches/${encodeURIComponent(id)}/submit`);
    return res.batch;
  }

  /**
   * Cancels a batch before it is funded (nothing leaves the wallet), or, once
   * processing, its payments not sent yet.
   */
  async cancel(id: string): Promise<PayoutBatch> {
    const res = await this.client.request<{ batch: PayoutBatch }>("POST", `/v1/payout-batches/${encodeURIComponent(id)}/cancel`);
    return res.batch;
  }
}

/** Your payout wallets in the key's mode: one address per chain, yours alone, that you top up. */
class PayoutWallets {
  constructor(private readonly client: Payitgo) {}

  /** Each wallet: its address, and what it holds of each coin. Made the first time it is asked for. */
  async list(): Promise<PayoutWallet[]> {
    const res = await this.client.request<{ wallets: PayoutWallet[] }>("GET", "/v1/payout-wallets");
    return res.wallets;
  }

  /**
   * Test keys only: adds `amount` of `asset` to the test wallet's balance on
   * paper, and funds any test batch waiting for it. Returns the wallets.
   */
  async simulateTopUp(asset: string, amount: number | string): Promise<PayoutWallet[]> {
    const res = await this.client.request<{ wallets: PayoutWallet[] }>(
      "POST",
      `/v1/payout-wallets/${encodeURIComponent(asset)}/simulate-top-up`,
      { amount },
    );
    return res.wallets;
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

/**
 * The key's mode's events, as their webhooks carried them, kept to replay any
 * your system missed. Any account key, read-only ones too; a storefront's key
 * is refused (403).
 */
class Events {
  constructor(private readonly client: Payitgo) {}

  /**
   * Events oldest first, each exactly as its webhook carried it (the same `id`,
   * so skip the ones you handled already). Call again with `after` = the
   * last event's id while has_more. Test pings are left out, and events of the
   * last few seconds are left for the next read. A key without payouts gets
   * claim links without their url and pin.
   */
  list(params: ListEventsParams = {}): Promise<EventList> {
    return this.client.request("GET", `/v1/events${query(params)}`);
  }
}

function query(params: object): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    // A list (several statuses) goes comma-separated; a time, as its ISO string.
    const s = Array.isArray(v) ? v.join(",") : v instanceof Date ? v.toISOString() : String(v);
    if (s !== "") q.set(k, s);
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
