const PBKDF2_ITERATIONS = 310000;
const AES_GCM_IV_BYTES = 12;
const AES_KEY_BITS = 256;
const VERIFIER_TOKEN = "econsolver-sync-verifier-v1";

function getCrypto() {
  const c = globalThis.crypto;
  if (!c?.subtle || typeof c.getRandomValues !== "function") {
    throw new Error("WebCrypto is not available in this environment.");
  }
  return c;
}

function textEncoder() {
  return new TextEncoder();
}

function textDecoder() {
  return new TextDecoder();
}

export function bytesToB64(bytes) {
  const bin = Array.from(bytes, b => String.fromCharCode(b)).join("");
  if (typeof btoa === "function") return btoa(bin);
  return Buffer.from(bytes).toString("base64");
}

export function b64ToBytes(b64) {
  if (typeof atob === "function") {
    const bin = atob(b64);
    return Uint8Array.from(bin, ch => ch.charCodeAt(0));
  }
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

export function randomSaltB64(byteLength = 16) {
  const salt = new Uint8Array(byteLength);
  getCrypto().getRandomValues(salt);
  return bytesToB64(salt);
}

export async function deriveKey(passphrase, saltB64) {
  if (typeof passphrase !== "string" || passphrase.length === 0) {
    throw new Error("Passphrase is required.");
  }
  if (typeof saltB64 !== "string" || saltB64.length === 0) {
    throw new Error("Salt is required.");
  }

  const crypto = getCrypto();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    textEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: b64ToBytes(saltB64),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: AES_KEY_BITS },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function encryptBytes(key, bytes) {
  if (!(bytes instanceof Uint8Array)) {
    bytes = new Uint8Array(bytes);
  }
  const crypto = getCrypto();
  const iv = new Uint8Array(AES_GCM_IV_BYTES);
  crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return {
    ct: bytesToB64(new Uint8Array(ct)),
    iv: bytesToB64(iv),
  };
}

export async function decryptBytes(key, ct, iv) {
  const crypto = getCrypto();
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBytes(iv) },
    key,
    b64ToBytes(ct)
  );
  return new Uint8Array(plain);
}

export async function encryptJSON(key, obj) {
  return encryptBytes(key, textEncoder().encode(JSON.stringify(obj)));
}

export async function decryptJSON(key, ct, iv) {
  const bytes = await decryptBytes(key, ct, iv);
  return JSON.parse(textDecoder().decode(bytes));
}

export async function makeVerifier(key) {
  return encryptJSON(key, { token: VERIFIER_TOKEN });
}

export async function checkVerifier(key, verifier) {
  try {
    const decoded = await decryptJSON(key, verifier.ct, verifier.iv);
    return decoded?.token === VERIFIER_TOKEN;
  } catch {
    return false;
  }
}

export async function exportRecoveryKey(key) {
  const raw = await getCrypto().subtle.exportKey("raw", key);
  return bytesToB64(new Uint8Array(raw));
}

export async function importRecoveryKey(rawKeyB64) {
  if (typeof rawKeyB64 !== "string" || rawKeyB64.length === 0) {
    throw new Error("Recovery key is required.");
  }
  return getCrypto().subtle.importKey(
    "raw",
    b64ToBytes(rawKeyB64),
    { name: "AES-GCM", length: AES_KEY_BITS },
    true,
    ["encrypt", "decrypt"]
  );
}

export const cryptoParams = Object.freeze({
  kdf: "PBKDF2-SHA-256",
  iterations: PBKDF2_ITERATIONS,
  cipher: "AES-256-GCM",
  ivBytes: AES_GCM_IV_BYTES,
});
