import { webcrypto } from "node:crypto";
import assert from "node:assert/strict";

Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
  configurable: true,
});

const {
  randomSaltB64,
  deriveKey,
  encryptJSON,
  decryptJSON,
  encryptBytes,
  decryptBytes,
  makeVerifier,
  checkVerifier,
  exportRecoveryKey,
  importRecoveryKey,
  cryptoParams,
} = await import("../crypto.js");

const salt = randomSaltB64();
const key = await deriveKey("correct horse battery staple", salt);
const wrongKey = await deriveKey("wrong passphrase", salt);

assert.equal(cryptoParams.kdf, "PBKDF2-SHA-256");
assert.ok(cryptoParams.iterations >= 310000);
assert.equal(cryptoParams.cipher, "AES-256-GCM");
assert.equal(cryptoParams.ivBytes, 12);

const jsonPayload = {
  pid: "p1",
  nested: { values: [1, "two", true] },
};
const encJson = await encryptJSON(key, jsonPayload);
assert.deepEqual(await decryptJSON(key, encJson.ct, encJson.iv), jsonPayload);

const bytesPayload = Uint8Array.from([0, 1, 2, 3, 254, 255]);
const encBytes = await encryptBytes(key, bytesPayload);
assert.deepEqual(await decryptBytes(key, encBytes.ct, encBytes.iv), bytesPayload);

await assert.rejects(
  () => decryptJSON(wrongKey, encJson.ct, encJson.iv),
  /operation failed|decrypt|bad decrypt|authentication/i
);

const verifier = await makeVerifier(key);
assert.equal(await checkVerifier(key, verifier), true);
assert.equal(await checkVerifier(wrongKey, verifier), false);

const recovery = await exportRecoveryKey(key);
const imported = await importRecoveryKey(recovery);
assert.deepEqual(await decryptJSON(imported, encJson.ct, encJson.iv), jsonPayload);

console.log("crypto validation passed");
