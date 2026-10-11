import test from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";

// The package by its own name: the ES module entry point of package.json's "exports".
import Payitgo, { Payitgo as NamedPayitgo, PayitgoError, SignatureVerificationError, webhooks, VERSION } from "@payitgo/node";

test("ES modules: the default export is the Payitgo class", () => {
  assert.equal(typeof Payitgo, "function");
  assert.equal(Payitgo, NamedPayitgo);
  const payitgo = new Payitgo("sk_live_abc", { baseUrl: "http://x" });
  assert.ok(payitgo instanceof NamedPayitgo);
  assert.equal(payitgo.livemode, true);
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
