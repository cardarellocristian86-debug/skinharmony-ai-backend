import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createRemoteGenericWorkCoreJoinSigner } from "../src/genericWorkCoreJoinRemoteSigner.js";

const KEY_ID = "remote-key-v1"; const DIGEST = "a".repeat(64); const CONTEXT = { tenant_id: "tenant-a", work_id: "work-a", adapter: "generic", idempotency_digest: "b".repeat(64) }; const URL = "https://signer.example.com/sign"; const HEALTH = "https://signer.example.com/health"; const PUBLIC_V4 = "93.184.216.34"; const PUBLIC_V6 = "2606:2800:220:1:248:1893:25c8:1946";
function response(statusCode, body, headers = {}) { const stream = new PassThrough(); stream.statusCode = statusCode; stream.headers = headers; queueMicrotask(() => { if (body !== undefined) stream.write(body); stream.end(); }); return stream; }
function transport(handler) { const calls = []; const httpsRequest = (options, callback) => { const request = new EventEmitter(); request.write = (chunk) => { request.payload = Buffer.from(chunk); }; request.end = () => { calls.push({ options, request }); Promise.resolve(handler({ options, request, callback })).catch((error) => request.emit("error", error)); }; request.destroy = () => { request.destroyed = true; }; return request; }; return { calls, httpsRequest }; }
function fixture({ records = [{ address: PUBLIC_V4, family: 4 }, { address: PUBLIC_V6, family: 6 }], handler } = {}) {
  const keys = crypto.generateKeyPairSync("ed25519"); const fp = crypto.createHash("sha256").update(keys.publicKey.export({ type: "spki", format: "der" })).digest("hex"); const dnsCalls = [];
  const dnsLookup = async (hostname, options) => { dnsCalls.push({ hostname, options }); return records; };
  const network = transport(handler || (({ request, callback }) => { const input = JSON.parse(request.payload); const signature = crypto.sign(null, Buffer.from(`generic_work_core_join_v1\0${input.digest}`), keys.privateKey).toString("base64url"); callback(response(200, JSON.stringify({ schema_version: "generic_work_core_join_sign_response_v1", algorithm: "Ed25519", key_id: KEY_ID, digest: input.digest, public_key_fingerprint: fp, signature }))); }));
  const signer = createRemoteGenericWorkCoreJoinSigner({ url: URL, healthUrl: HEALTH, allowedUrls: [URL, HEALTH], authToken: "opaque", keyId: KEY_ID, publicKey: keys.publicKey }, { dnsLookup, httpsRequest: network.httpsRequest });
  return { keys, fp, signer, dnsCalls, network };
}

test("pins every public DNS result to HTTPS while preserving hostname, SNI, and certificate validation", async () => {
  const state = fixture({ handler: ({ options, request, callback }) => { options.lookup("signer.example.com", { all: true }, (error, addresses) => { assert.ifError(error); assert.deepEqual(addresses, [{ address: PUBLIC_V4, family: 4 }, { address: PUBLIC_V6, family: 6 }]); }); options.lookup("signer.example.com", { all: true }, (error, addresses) => { assert.ifError(error); assert.equal(addresses[0].address, PUBLIC_V4); }); const input = JSON.parse(request.payload); const signature = crypto.sign(null, Buffer.from(`generic_work_core_join_v1\0${input.digest}`), state.keys.privateKey).toString("base64url"); callback(response(200, JSON.stringify({ schema_version: "generic_work_core_join_sign_response_v1", algorithm: "Ed25519", key_id: KEY_ID, digest: input.digest, public_key_fingerprint: state.fp, signature }))); } });
  assert.equal(Boolean(await state.signer.signDigest(DIGEST, CONTEXT)), true); assert.equal(state.dnsCalls.length, 1); assert.equal(state.network.calls.length, 1); const options = state.network.calls[0].options; assert.equal(options.hostname, "signer.example.com"); assert.equal(options.servername, "signer.example.com"); assert.equal(options.rejectUnauthorized, true); assert.equal(options.headers.authorization, "Bearer opaque");
});

test("denies private, link-local, metadata, ULA, mapped-private, reserved, and mixed DNS before sending token", async () => {
  const denied = [
    [{ address: "127.0.0.1", family: 4 }], [{ address: "10.2.3.4", family: 4 }], [{ address: "169.254.169.254", family: 4 }],
    [{ address: "224.0.0.1", family: 4 }], [{ address: "0.0.0.0", family: 4 }], [{ address: "fc00::1", family: 6 }],
    [{ address: "fe80::1", family: 6 }], [{ address: "::ffff:127.0.0.1", family: 6 }], [{ address: "2001:db8::1", family: 6 }],
    [{ address: PUBLIC_V4, family: 4 }, { address: "192.168.1.2", family: 4 }]
  ];
  for (const records of denied) { const state = fixture({ records }); await assert.rejects(() => state.signer.signDigest(DIGEST, CONTEXT), /remote_dns_denied/); assert.equal(state.network.calls.length, 0); }
});

test("pre-resolution snapshot makes DNS rebinding impossible", async () => {
  let resolverCalls = 0; const state = fixture({ records: [{ address: PUBLIC_V4, family: 4 }], handler: ({ options, request, callback }) => { options.lookup("signer.example.com", {}, (error, address, family) => { assert.ifError(error); assert.equal(address, PUBLIC_V4); assert.equal(family, 4); }); options.lookup("attacker.example.com", {}, (error) => assert.match(error.message, /pin_mismatch/)); const input = JSON.parse(request.payload); const signature = crypto.sign(null, Buffer.from(`generic_work_core_join_v1\0${input.digest}`), state.keys.privateKey).toString("base64url"); callback(response(200, JSON.stringify({ schema_version: "generic_work_core_join_sign_response_v1", algorithm: "Ed25519", key_id: KEY_ID, digest: input.digest, public_key_fingerprint: state.fp, signature }))); } });
  state.dnsCalls.length = 0; const original = state.signer; await original.signDigest(DIGEST, CONTEXT); resolverCalls = state.dnsCalls.length; assert.equal(resolverCalls, 1); assert.equal(state.network.calls.length, 1);
});

test("requires exact HTTPS allowlist and forbids redirects", async () => {
  const { keys } = fixture(); assert.throws(() => createRemoteGenericWorkCoreJoinSigner({ url: `${URL}/extra`, allowedUrls: [URL], authToken: "x", keyId: KEY_ID, publicKey: keys.publicKey }), /url_not_allowed/);
  for (const url of ["http://signer.example.com/sign", "https://localhost/sign", "https://127.0.0.1/sign", "https://signer.local/sign"]) assert.throws(() => createRemoteGenericWorkCoreJoinSigner({ url, allowedUrls: [url], authToken: "x", keyId: KEY_ID, publicKey: keys.publicKey }));
  const state = fixture({ handler: ({ callback }) => callback(response(302, "", { location: "https://evil.example/sign" })) }); await assert.rejects(() => state.signer.signDigest(DIGEST, CONTEXT), /redirect_denied/); assert.equal(state.network.calls.length, 1);
});

test("bounds response body at 16 KiB and applies timeout through body", async () => {
  const huge = fixture({ handler: ({ callback }) => callback(response(200, "x".repeat(16 * 1024 + 1))) }); await assert.rejects(() => huge.signer.signDigest(DIGEST, CONTEXT), /response_invalid/);
  const stalled = fixture({ handler: ({ callback }) => { const stream = new PassThrough(); stream.statusCode = 200; stream.headers = {}; callback(stream); } }); const signer = createRemoteGenericWorkCoreJoinSigner({ url: URL, allowedUrls: [URL], authToken: "x", keyId: KEY_ID, publicKey: stalled.keys.publicKey, timeoutMs: 100 }, { dnsLookup: async () => [{ address: PUBLIC_V4, family: 4 }], httpsRequest: stalled.network.httpsRequest }); await assert.rejects(() => signer.signDigest(DIGEST, CONTEXT), /remote_unavailable/);
});

test("probe preserves nonce and Ed25519 attestation validation over pinned transport", async () => {
  const state = fixture({ handler: ({ request, callback }) => { const input = JSON.parse(request.payload); const signature = crypto.sign(null, Buffer.from(`generic_work_core_join_remote_probe_v1\0${input.nonce}`), state.keys.privateKey).toString("base64url"); callback(response(200, JSON.stringify({ schema_version: "generic_work_core_join_probe_response_v1", purpose: "generic_work_core_join_remote_probe_v1", key_id: KEY_ID, nonce: input.nonce, algorithm: "Ed25519", public_key_fingerprint: state.fp, signature }))); } }); assert.equal((await state.signer.probe()).key_id, KEY_ID);
  const forged = fixture({ handler: ({ request, callback }) => { const input = JSON.parse(request.payload); callback(response(200, JSON.stringify({ schema_version: "generic_work_core_join_probe_response_v1", purpose: "generic_work_core_join_remote_probe_v1", key_id: KEY_ID, nonce: `${input.nonce}x`, algorithm: "Ed25519", public_key_fingerprint: state.fp, signature: "forged" }))); } }); await assert.rejects(() => forged.signer.probe(), /probe_invalid/);
});

test("test transport and DNS injection are rejected inside production configuration", () => {
  const { keys } = fixture(); assert.throws(() => createRemoteGenericWorkCoreJoinSigner({ url: URL, allowedUrls: [URL], authToken: "x", keyId: KEY_ID, publicKey: keys.publicKey, dnsLookup: async () => [] }), /test_dependency_in_config/); assert.throws(() => createRemoteGenericWorkCoreJoinSigner({ url: URL, allowedUrls: [URL], authToken: "x", keyId: KEY_ID, publicKey: keys.publicKey, fetchImpl: async () => ({}) }), /test_dependency_in_config/);
});

test("trusted retired key remains available without replacing the active key", () => { const state = fixture(); const old = crypto.generateKeyPairSync("ed25519"); const signer = createRemoteGenericWorkCoreJoinSigner({ url: URL, allowedUrls: [URL], authToken: "x", keyId: KEY_ID, publicKey: state.keys.publicKey, trustedPublicKeys: { "retired-key": old.publicKey } }, { dnsLookup: async () => [{ address: PUBLIC_V4, family: 4 }], httpsRequest: state.network.httpsRequest }); assert.equal(signer.resolvePublicKey(KEY_ID).asymmetricKeyType, "ed25519"); assert.equal(signer.resolvePublicKey("retired-key").asymmetricKeyType, "ed25519"); });

test("successful DNS resolution clears a long deadline timer", async () => { const state = fixture(); const signer = createRemoteGenericWorkCoreJoinSigner({ url: URL, allowedUrls: [URL], authToken: "x", keyId: KEY_ID, publicKey: state.keys.publicKey, timeoutMs: 30000 }, { dnsLookup: async () => [{ address: PUBLIC_V4, family: 4 }], httpsRequest: state.network.httpsRequest }); const started = Date.now(); assert.equal(Boolean(await signer.signDigest(DIGEST, CONTEXT)), true); assert.ok(Date.now() - started < 1000); });
