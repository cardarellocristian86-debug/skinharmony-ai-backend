import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '..', 'public');
const dataDir = process.env.NYRA_GENESIS_HOME
  ? path.resolve(process.env.NYRA_GENESIS_HOME)
  : path.join(os.homedir(), '.config', 'nyra-core-genesis');
const authorityPath = path.join(dataDir, 'local-pin-authority.json');
const auditPath = path.join(dataDir, 'local-pin-audit.jsonl');
const host = '127.0.0.1';
const port = Number.parseInt(process.env.PORT || '8788', 10);
const csrfToken = crypto.randomBytes(32).toString('base64url');
const maxBodyBytes = 128 * 1024;
const receiptSignatureDomain = Buffer.from('bootstrap_release_exception_v1:local_pin\0', 'utf8');
const receiptFields = [
  'schema_version',
  'exception_id',
  'tenant_id',
  'work_id',
  'repository',
  'pr_number',
  'head_sha',
  'allowed_action',
  'max_uses',
  'issued_at',
  'expires_at',
  'required_checks_digest',
  'required_checks_results_digest',
  'owner_confirmation_digest',
  'core_policy_verdict_digest',
  'core_policy_classification',
  'rollback_obligations_digest',
  'post_deploy_obligations_digest',
  'nonce',
  'authority_key_id',
  'authority_provider',
  'authority_assertion',
  'consumed_at',
  'revoked_at'
];
const unsignedReceiptFields = receiptFields.filter((field) => field !== 'authority_assertion');

let failedUnlocks = 0;
let blockedUntil = 0;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  const payload = Buffer.isBuffer(value) || value instanceof Uint8Array
    ? Buffer.from(value)
    : typeof value === 'string' ? value : canonical(value);
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function receiptForSigning(receipt) {
  const unsigned = { ...receipt };
  delete unsigned.authority_assertion;
  return unsigned;
}

function hasExactFields(value, expectedFields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedFields].sort();
  return actual.length === expected.length && actual.every((field, index) => field === expected[index]);
}

function validateReceipt(receipt, authority) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error('receipt_invalid');
  if (!hasExactFields(receipt, unsignedReceiptFields)) throw new Error('receipt_schema_invalid');
  const stringFields = unsignedReceiptFields.filter((field) => !['pr_number', 'max_uses', 'consumed_at', 'revoked_at'].includes(field));
  for (const field of stringFields) {
    if (!nonEmptyString(receipt[field])) throw new Error(`receipt_field_invalid:${field}`);
  }
  if (receipt.schema_version !== 'bootstrap_release_exception_v1') throw new Error('receipt_schema_version_invalid');
  if (receipt.authority_provider !== 'local_pin') throw new Error('receipt_authority_provider_invalid');
  if (!Number.isInteger(receipt.pr_number) || receipt.pr_number <= 0) throw new Error('receipt_pr_number_invalid');
  if (receipt.allowed_action !== 'github.merge') throw new Error('receipt_action_not_allowed');
  if (receipt.max_uses !== 1) throw new Error('receipt_max_uses_invalid');
  if (receipt.core_policy_classification !== 'BOOTSTRAP_DEADLOCK_VERIFIED') throw new Error('bootstrap_deadlock_not_verified');
  if (receipt.consumed_at !== null || receipt.revoked_at !== null) throw new Error('receipt_already_terminal');
  if (receipt.authority_key_id !== authority.authority_key_id) throw new Error('authority_key_id_mismatch');
  if (!/^[0-9a-f]{40}$/.test(receipt.head_sha)) throw new Error('head_sha_invalid');

  const issuedAt = Date.parse(receipt.issued_at);
  const expiresAt = Date.parse(receipt.expires_at);
  const now = Date.now();
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) throw new Error('receipt_time_invalid');
  if (issuedAt > now + 60_000) throw new Error('issued_at_in_future');
  if (expiresAt <= now) throw new Error('receipt_expired');
  if (expiresAt - issuedAt > 15 * 60_000) throw new Error('receipt_ttl_too_long');
  return receiptForSigning(receipt);
}

async function ensureDataDir() {
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  await fs.chmod(dataDir, 0o700);
}

async function exists(filename) {
  try {
    await fs.access(filename);
    return true;
  } catch {
    return false;
  }
}

async function readAuthority() {
  return JSON.parse(await fs.readFile(authorityPath, 'utf8'));
}

async function appendAudit(event) {
  await ensureDataDir();
  const line = `${JSON.stringify({ ...event, recorded_at: new Date().toISOString() })}\n`;
  await fs.appendFile(auditPath, line, { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(auditPath, 0o600);
}

async function derivePinKey(pin, salt, params) {
  return scrypt(pin, Buffer.from(salt, 'base64url'), 32, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 512 * 1024 * 1024
  });
}

async function createAuthority(pin) {
  if (await exists(authorityPath)) throw new Error('authority_already_initialized');
  if (typeof pin !== 'string' || pin.length < 8) throw new Error('pin_minimum_8_characters');

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicSpki = publicKey.export({ type: 'spki', format: 'der' });
  const privatePkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' });
  const authorityKeyId = `local-pin-p256:${digest(publicSpki).slice(0, 32)}`;
  const createdAt = new Date().toISOString();
  const metadata = {
    version: 'local_pin_authority_v1',
    authority_key_id: authorityKeyId,
    authority_provider: 'local_pin',
    custody_class: 'owner_local_encrypted',
    algorithm: 'ECDSA_P256_SHA256_P1363',
    public_key_spki: base64url(publicSpki),
    created_at: createdAt
  };
  const salt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const kdf = { name: 'scrypt', N: 262144, r: 8, p: 1, salt: base64url(salt) };
  const key = await derivePinKey(pin, kdf.salt, kdf);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(canonical(metadata)));
  const ciphertext = Buffer.concat([cipher.update(privatePkcs8), cipher.final()]);
  const tag = cipher.getAuthTag();
  key.fill(0);
  privatePkcs8.fill(0);

  const stored = {
    ...metadata,
    kdf,
    encrypted_private_key: {
      cipher: 'AES-256-GCM',
      iv: base64url(iv),
      tag: base64url(tag),
      ciphertext: base64url(ciphertext)
    }
  };
  await ensureDataDir();
  await fs.writeFile(authorityPath, `${JSON.stringify(stored, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await appendAudit({ event_type: 'local_pin_authority_initialized', authority_key_id: authorityKeyId, public_material_digest: digest(metadata) });
  return metadata;
}

function authorityMetadata(authority) {
  return {
    version: authority.version,
    authority_key_id: authority.authority_key_id,
    authority_provider: authority.authority_provider,
    custody_class: authority.custody_class,
    algorithm: authority.algorithm,
    public_key_spki: authority.public_key_spki,
    created_at: authority.created_at
  };
}

async function unlockPrivateKey(authority, pin) {
  if (Date.now() < blockedUntil) throw new Error(`unlock_rate_limited:${Math.ceil((blockedUntil - Date.now()) / 1000)}`);
  let derived;
  let plaintext;
  try {
    derived = await derivePinKey(pin, authority.kdf.salt, authority.kdf);
    const encrypted = authority.encrypted_private_key;
    const decipher = crypto.createDecipheriv('aes-256-gcm', derived, Buffer.from(encrypted.iv, 'base64url'));
    decipher.setAAD(Buffer.from(canonical(authorityMetadata(authority))));
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64url'));
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64url')),
      decipher.final()
    ]);
    failedUnlocks = 0;
    blockedUntil = 0;
    return { key: crypto.createPrivateKey({ key: plaintext, type: 'pkcs8', format: 'der' }), plaintext };
  } catch {
    failedUnlocks += 1;
    blockedUntil = Date.now() + Math.min(60_000, 1000 * (2 ** Math.min(failedUnlocks, 6)));
    await appendAudit({ event_type: 'local_pin_unlock_denied', authority_key_id: authority.authority_key_id, failed_attempt: failedUnlocks });
    throw new Error('pin_invalid_or_key_corrupt');
  } finally {
    if (derived) derived.fill(0);
  }
}

async function signReceipt(receipt, pin) {
  const authority = await readAuthority();
  const unsigned = validateReceipt(receipt, authority);
  const { key, plaintext } = await unlockPrivateKey(authority, pin);
  try {
    const payload = Buffer.concat([receiptSignatureDomain, Buffer.from(canonical(unsigned), 'utf8')]);
    const signature = crypto.sign('sha256', payload, { key, dsaEncoding: 'ieee-p1363' });
    const signed = {
      ...unsigned,
      authority_assertion: {
        algorithm: 'ECDSA-P256-SHA256-P1363',
        signature_p1363_base64url: base64url(signature)
      }
    };
    await appendAudit({
      event_type: 'bootstrap_release_exception_signed_locally',
      authority_key_id: authority.authority_key_id,
      exception_id: unsigned.exception_id,
      tenant_id: unsigned.tenant_id,
      work_id: unsigned.work_id,
      repository: unsigned.repository,
      pr_number: unsigned.pr_number,
      head_sha: unsigned.head_sha,
      allowed_action: unsigned.allowed_action,
      receipt_digest: digest(signed)
    });
    return signed;
  } finally {
    plaintext.fill(0);
  }
}

function securityHeaders(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
}

function sendJson(response, status, body) {
  securityHeaders(response);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function requestIsLocal(request) {
  const remote = request.socket.remoteAddress;
  const localRemote = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const hostHeader = request.headers.host || '';
  const localHost = hostHeader === `127.0.0.1:${port}` || hostHeader === `localhost:${port}`;
  const origin = request.headers.origin;
  const localOrigin = !origin || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
  return localRemote && localHost && localOrigin;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function serveStatic(response, filename, contentType) {
  securityHeaders(response);
  response.writeHead(200, { 'Content-Type': contentType });
  response.end(await fs.readFile(path.join(publicDir, filename)));
}

const server = http.createServer(async (request, response) => {
  try {
    if (!requestIsLocal(request)) return sendJson(response, 403, { ok: false, error: 'local_origin_required' });
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === 'GET' && url.pathname === '/') return serveStatic(response, 'index.html', 'text/html; charset=utf-8');
    if (request.method === 'GET' && url.pathname === '/app.js') return serveStatic(response, 'app.js', 'text/javascript; charset=utf-8');
    if (request.method === 'GET' && url.pathname === '/api/session') {
      const initialized = await exists(authorityPath);
      let publicMaterial = null;
      if (initialized) publicMaterial = authorityMetadata(await readAuthority());
      return sendJson(response, 200, { ok: true, csrf_token: csrfToken, initialized, public_material: publicMaterial });
    }

    if (request.method !== 'POST') return sendJson(response, 404, { ok: false, error: 'not_found' });
    if (request.headers['x-genesis-csrf'] !== csrfToken) return sendJson(response, 403, { ok: false, error: 'csrf_invalid' });
    const body = await readJson(request);

    if (url.pathname === '/api/initialize') {
      if (body.pin !== body.pin_confirmation) return sendJson(response, 400, { ok: false, error: 'pin_confirmation_mismatch' });
      const material = await createAuthority(body.pin);
      return sendJson(response, 201, { ok: true, public_material: material });
    }
    if (url.pathname === '/api/sign') {
      const signedReceipt = await signReceipt(body.receipt, body.pin);
      return sendJson(response, 200, { ok: true, signed_receipt: signedReceipt, receipt_digest: digest(signedReceipt) });
    }
    return sendJson(response, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    return sendJson(response, 400, { ok: false, error: error.message || 'request_failed' });
  }
});

server.listen(port, host, () => {
  process.stdout.write(`Nyra Core Genesis Local PIN: http://${host}:${port}\n`);
  process.stdout.write(`Authority storage: ${authorityPath}\n`);
});
