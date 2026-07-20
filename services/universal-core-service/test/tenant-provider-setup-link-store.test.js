import assert from "node:assert/strict";
import test from "node:test";
import { createTenantProviderSetupLinkStore } from "../src/tenantProviderSetupLinkStore.js";

test("provider setup links require an opaque proof and are single-use after finalization", async () => {
  let stored = null;
  const pool = {
    query: async (query, values = []) => {
      if (query.startsWith("CREATE") || query.startsWith("ALTER") || query === "BEGIN" || query === "COMMIT" || query === "ROLLBACK") return { rows: [] };
      if (query.startsWith("DELETE")) return { rows: [] };
      if (query.startsWith("INSERT")) {
        stored = {
          token_hash: values[0],
          tenant_id: values[1],
          expires_at: values[2],
          link_id: values[3],
          proof_hash: values[4],
          owner_subject_fingerprint: values[5],
          claim_id: null,
        };
        return { rows: [] };
      }
      if (query.startsWith("UPDATE") && query.includes("SET revoked_at")) return { rows: [] };
      if (query.startsWith("UPDATE") && query.includes("SET claim_id=$3")) {
        if (!stored || stored.token_hash !== values[0] || stored.proof_hash !== values[1] || stored.claim_id) return { rows: [] };
        stored.claim_id = values[2];
        return { rows: [{
          link_id: stored.link_id,
          tenant_id: stored.tenant_id,
          owner_subject_fingerprint: stored.owner_subject_fingerprint,
          expires_at: stored.expires_at,
        }] };
      }
      if (query.startsWith("UPDATE") && query.includes("SET consumed_at=NOW()")) {
        if (!stored || stored.link_id !== values[0] || stored.claim_id !== values[1]) return { rows: [] };
        const row = {
          tenant_id: stored.tenant_id,
          owner_subject_fingerprint: stored.owner_subject_fingerprint,
          expires_at: stored.expires_at,
        };
        stored = null;
        return { rows: [row] };
      }
      if (query.startsWith("UPDATE") && query.includes("SET claim_id=NULL")) {
        if (!stored || stored.link_id !== values[0] || stored.claim_id !== values[1]) return { rows: [], rowCount: 0 };
        stored.claim_id = null;
        return { rows: [{ link_id: stored.link_id }], rowCount: 1 };
      }
      return { rows: [] };
    },
  };
  const store=createTenantProviderSetupLinkStore({connectionString:"postgres://governance:test@localhost:5432/nyra",pool,now:()=>new Date("2026-07-18T00:00:00.000Z")});
  const ownerSubjectFingerprint = `osf_${"c".repeat(64)}`;
  const issued=await store.issue({tenant_id:"tenant-a",owner_subject_fingerprint:ownerSubjectFingerprint,ttl_minutes:15});
  assert.match(issued.token,/^[A-Za-z0-9_-]{30,}$/);
  assert.match(issued.proof,/^[A-Za-z0-9_-]{30,}$/);
  assert.match(issued.link_id,/^psl_[A-Za-z0-9_-]{20,}$/);
  assert.equal(stored.token_hash.includes(issued.token),false);
  assert.equal(stored.proof_hash.includes(issued.proof),false);

  assert.equal(await store.claim({token:issued.token,proof:"wrong-proof"}),null);
  const claim = await store.claim({token:issued.token,proof:issued.proof});
  assert.equal(claim.tenant_id,"tenant-a");
  assert.equal(claim.owner_subject_fingerprint,ownerSubjectFingerprint);
  assert.equal(await store.claim({token:issued.token,proof:issued.proof}),null);
  assert.equal((await store.finalize({link_id:claim.link_id,claim_id:claim.claim_id})).tenant_id,"tenant-a");
  assert.equal(await store.claim({token:issued.token,proof:issued.proof}),null);
});
