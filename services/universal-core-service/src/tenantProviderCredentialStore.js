import crypto from "node:crypto";
import { Pool } from "pg";

function text(value, field, max = 8_000) { const normalized = String(value || "").trim(); if (!normalized || normalized.length > max) throw new Error(`${field}_invalid`); return normalized; }
function keyFor(secret) { return crypto.scryptSync(text(secret, "credential_vault_secret", 4_000), "governed-agent-provider-v1", 32); }
function encrypt(secret, plaintext) { const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv("aes-256-gcm",keyFor(secret),iv); const ciphertext=Buffer.concat([cipher.update(plaintext,"utf8"),cipher.final()]); return { ciphertext:ciphertext.toString("base64"), iv:iv.toString("base64"), tag:cipher.getAuthTag().toString("base64") }; }
function decrypt(secret, record) { const decipher=crypto.createDecipheriv("aes-256-gcm",keyFor(secret),Buffer.from(record.iv,"base64")); decipher.setAuthTag(Buffer.from(record.tag,"base64")); return Buffer.concat([decipher.update(Buffer.from(record.ciphertext,"base64")),decipher.final()]).toString("utf8"); }
function keyHint(value) { return `${value.slice(0, 3)}…${value.slice(-4)}`; }
function validateOpenAiKey(value) { const key=text(value,"openai_api_key",1_000); if (!/^sk-(?:proj-)?[A-Za-z0-9_-]{12,}$/.test(key)) throw new Error("openai_api_key_format_invalid"); return key; }

export function createTenantProviderCredentialStore({ connectionString, masterSecret, pool = null } = {}) {
  const url=text(connectionString,"governed_agent_database_url",4_000), secret=text(masterSecret,"credential_vault_secret",4_000); const db=pool || new Pool({ connectionString:url, max:2, idleTimeoutMillis:10_000 }); let initialized=false;
  async function init() { if(initialized)return; await db.query(`CREATE TABLE IF NOT EXISTS governed_agent_provider_credentials (
    tenant_id TEXT NOT NULL, provider TEXT NOT NULL, ciphertext TEXT NOT NULL, iv TEXT NOT NULL, tag TEXT NOT NULL, key_hint TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (tenant_id, provider)
  )`); initialized=true; }
  async function saveOpenAiInTransaction({ tenant_id, api_key, client }) {
    if (!client || typeof client.query !== "function") throw new Error("credential_transaction_client_required");
    const tenantId=text(tenant_id,"tenant_id",120), key=validateOpenAiKey(api_key), encrypted=encrypt(secret,key);
    const result=await client.query(`INSERT INTO governed_agent_provider_credentials (tenant_id,provider,ciphertext,iv,tag,key_hint) VALUES ($1,'openai',$2,$3,$4,$5) ON CONFLICT (tenant_id,provider) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,iv=EXCLUDED.iv,tag=EXCLUDED.tag,key_hint=EXCLUDED.key_hint,updated_at=NOW() RETURNING provider,key_hint,updated_at`,[tenantId,encrypted.ciphertext,encrypted.iv,encrypted.tag,keyHint(key)]);
    if (!result.rows[0]) throw new Error("credential_save_failed");
    return { provider:result.rows[0].provider, configured:true, key_hint:result.rows[0].key_hint, updated_at:result.rows[0].updated_at };
  }
  return {
    // Setup-link consumption initializes both tables before its transaction,
    // then calls saveOpenAiInTransaction with the link store's checked-out
    // client. Keeping this public helper narrow avoids a second, independent
    // credential write transaction.
    async ensureInitialized() { await init(); },
    async saveOpenAiInTransaction(input) { return saveOpenAiInTransaction(input); },
    async saveOpenAi({ tenant_id, api_key }) { await init(); return saveOpenAiInTransaction({ tenant_id, api_key, client:db }); },
    async status({ tenant_id }) { const tenantId=text(tenant_id,"tenant_id",120); await init(); const result=await db.query("SELECT provider,key_hint,updated_at FROM governed_agent_provider_credentials WHERE tenant_id=$1 AND provider='openai'",[tenantId]); return result.rows[0] ? { provider:"openai", configured:true, key_hint:result.rows[0].key_hint, updated_at:result.rows[0].updated_at, execution_enabled:false } : { provider:"openai", configured:false, execution_enabled:false }; },
    async removeOpenAi({ tenant_id }) { const tenantId=text(tenant_id,"tenant_id",120); await init(); const result=await db.query("DELETE FROM governed_agent_provider_credentials WHERE tenant_id=$1 AND provider='openai'",[tenantId]); return { removed:result.rowCount > 0 }; },
    async getOpenAiForExecution({ tenant_id }) { const tenantId=text(tenant_id,"tenant_id",120); await init(); const result=await db.query("SELECT ciphertext,iv,tag FROM governed_agent_provider_credentials WHERE tenant_id=$1 AND provider='openai'",[tenantId]); if(!result.rows[0]) return null; return decrypt(secret,result.rows[0]); },
  };
}
