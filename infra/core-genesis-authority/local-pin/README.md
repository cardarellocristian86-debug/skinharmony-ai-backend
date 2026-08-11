# Nyra Core Genesis Local PIN Authority

Owner-only local authority for signing `bootstrap_release_exception_v1` receipts. It does not issue a Core Join and it does not make a blocked release valid.

## Security model

- Listens only on `127.0.0.1`.
- Generates an ECDSA P-256 authority key locally.
- Encrypts PKCS#8 private material with AES-256-GCM.
- Derives the encryption key from the owner PIN with memory-hard scrypt.
- Requires at least eight PIN/passphrase characters.
- Applies exponential delay after failed unlock attempts.
- Never accepts the PIN as a command-line argument or environment variable.
- Writes only metadata and receipt digests to the local audit log.
- Signs only `github.merge`, `max_uses=1`, unconsumed, unrevoked receipts classified as `BOOTSTRAP_DEADLOCK_VERIFIED` with a maximum fifteen-minute TTL.

The encrypted key remains software-protected. It is not equivalent to Secure Enclave, KMS, or HSM custody. Protect the Mac login, full-disk encryption, backups, and the authority PIN.

## Start

```sh
./run.sh
```

Open `http://127.0.0.1:8788` manually. Enter the PIN only in that local page. Never send it through chat or expose it to an agent.

Storage defaults to:

```text
~/.config/nyra-core-genesis/local-pin-authority.json
~/.config/nyra-core-genesis/local-pin-audit.jsonl
```

`NYRA_GENESIS_HOME` can relocate storage for an offline encrypted volume. `PORT` can change the localhost port.

## Genesis registration

After initialization, register only the public material with Universal Core's trust registry. Do not upload `local-pin-authority.json`: it contains the encrypted private key and must remain owner-local.

## Required server-side controls

The Core consumer remains responsible for signature verification, tenant/Work/repository/PR/SHA/action binding, required-check digest verification, expiry, revocation, atomic one-use consumption, ledger recording, and post-deploy obligations.

## One-shot public trust-key installation

The Local-PIN authority private key and PIN never enter Universal Core, Render configuration, or this installer. After the owner has exported the canonical `bootstrap_authority_trust_bundle_v1` public bundle, an authorized administrator installs its public trust pin exactly once, outside the normal application release path.

Run from an authenticated administrative or Render shell where `GOVERNED_AGENT_DATABASE_URL` is already injected into the process environment:

```sh
node install-trust-key.mjs /secure/path/public-trust-bundle.json
```

The database URL must not be supplied on the command line, placed in this repository, copied into the bundle, or loaded from a local `.env` file. The script has no HTTP route and does not accept a PIN or private key. It validates the exact public-bundle schema, rejects private-material fields, verifies the canonical P-256 SPKI fingerprint and derived `authority_key_id`, runs the additive store initialization, and refuses installation when a different tenant key is already `ACTIVE`.

For `local_pin`, `provider_attestation_digest` is explicitly `null`. This is an owner-held, unattested local software signer and it must not claim a provider attestation digest.

A successful invocation prints only a public installation receipt and digest. Subsequent Universal Core operation resolves the pinned public trust key from PostgreSQL; it does not rerun the genesis installer and never receives Local-PIN private material. Rotation or replacement requires a separately governed trust-key procedure rather than editing the existing record.
