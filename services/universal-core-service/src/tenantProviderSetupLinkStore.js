import crypto from "node:crypto";
import { Pool } from "pg";

function text(value, field, max = 4_000) { const normalized=String(value||"").trim(); if(!normalized||normalized.length>max) throw new Error(`${field}_invalid`); return normalized; }
function hash(token) { return crypto.createHash("sha256").update(token).digest("hex"); }

export function createTenantProviderSetupLinkStore({ connectionString, pool = null, now = () => new Date() } = {}) {
  const db=pool || new Pool({connectionString:text(connectionString,"governed_agent_database_url"),max:2,idleTimeoutMillis:10_000}); let initialized=false;
  async function init(){if(initialized)return;await db.query("CREATE TABLE IF NOT EXISTS governed_agent_provider_setup_links (token_hash TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, provider TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");initialized=true;}
  return {
    async issue({tenant_id,ttl_minutes=15}){const tenantId=text(tenant_id,"tenant_id",120), ttl=Math.max(5,Math.min(30,Number(ttl_minutes)||15)), token=crypto.randomBytes(32).toString("base64url"),expiresAt=new Date(now().getTime()+ttl*60_000).toISOString();await init();await db.query("INSERT INTO governed_agent_provider_setup_links (token_hash,tenant_id,provider,expires_at) VALUES ($1,$2,'openai',$3)",[hash(token),tenantId,expiresAt]);return {token,expires_at:expiresAt};},
    async consume({token}){const value=text(token,"setup_token",200);await init();const result=await db.query("UPDATE governed_agent_provider_setup_links SET consumed_at=NOW() WHERE token_hash=$1 AND provider='openai' AND consumed_at IS NULL AND expires_at>NOW() RETURNING tenant_id,expires_at",[hash(value)]);return result.rows[0]||null;},
  };
}
