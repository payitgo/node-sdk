import test from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";

// The package by its own name: the ES module entry point of package.json's "exports".
import Payitgo, { Payitgo as NamedPayitgo, PayitgoError, SignatureVerificationError, webhooks, VERSION } from "@payitgo/node";

test("ES modules: the default export is the Payitgo class", () => {
  assert.equal(typeof Payitgo, "function");
  assert.equal(Payitgo, NamedPayitgo);
  const payitgo = new Payitgo("4f9c2a7e1b8d3f6a0c5e9b2d7a4f1c8e3b6d9a2f5c8e1b4d7a0f3c6e9b2d5a8f", { baseUrl: "http://x" });
  assert.ok(payitgo instanceof NamedPayitgo);
  assert.equal(typeof payitgo.isLive, "function");
  assert.equal(typeof payitgo.payouts.request, "function");
  assert.equal(typeof payitgo.payoutBatches.create, "function");
  assert.equal(typeof payitgo.payoutWallets.simulateTopUp, "function");
  assert.equal(Payitgo.webhooks, webhooks);
  assert.equal(typeof VERSION, "string");
});

test("ES modules and CommonJS share one implementation", () => {
  const cjs = createRequire(import.meta.url)("@payitgo/node");
  assert.equal(cjs.Payitgo, Payitgo);
  assert.equal(cjs.default, Payitgo);
  assert.equal(cjs.PayitgoError, PayitgoError);
  assert.equal(cjs.SignatureVerificationError, SignatureVerificationError);
});
