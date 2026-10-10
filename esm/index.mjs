// The ES module entry point: the same classes as the CommonJS build (one
// implementation, so instanceof PayitgoError holds whichever way you import),
// with Payitgo as the default export.
import cjs from "../dist/index.js";

export const { Payitgo, PayitgoError, SignatureVerificationError, webhooks, VERSION } = cjs;
export default cjs.Payitgo;
