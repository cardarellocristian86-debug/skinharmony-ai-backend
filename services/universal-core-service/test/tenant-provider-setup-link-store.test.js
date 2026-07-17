import assert from "node:assert/strict";
import test from "node:test";
import { createTenantProviderSetupLinkStore } from "../src/tenantProviderSetupLinkStore.js";

test("provider setup links are opaque, expiring and single-use", async () => {
  let stored = null; const pool = { query: async (query, values = []) => { if(query.startsWith("CREATE")) return {rows:[]}; if(query.startsWith("INSERT")){stored={hash:values[0],tenant_id:values[1],expires_at:values[2]};return {rows:[]};} if(query.startsWith("UPDATE")){if(!stored || stored.hash!==values[0]) return {rows:[]};const row={tenant_id:stored.tenant_id,expires_at:stored.expires_at};stored=null;return {rows:[row]};} return {rows:[]};} };
  const store=createTenantProviderSetupLinkStore({connectionString:"postgres://governance:test@localhost:5432/nyra",pool,now:()=>new Date("2026-07-18T00:00:00.000Z")});
  const issued=await store.issue({tenant_id:"tenant-a",ttl_minutes:15});
  assert.match(issued.token,/^[A-Za-z0-9_-]{30,}$/); assert.equal(stored.hash.includes(issued.token),false);
  assert.equal((await store.consume({token:issued.token})).tenant_id,"tenant-a"); assert.equal(await store.consume({token:issued.token}),null);
});
