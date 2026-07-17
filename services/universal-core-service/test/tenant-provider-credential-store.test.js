import assert from "node:assert/strict";
import test from "node:test";
import { createTenantProviderCredentialStore } from "../src/tenantProviderCredentialStore.js";

test("tenant provider vault stores only encrypted OpenAI credentials and returns a hint", async () => {
  let record = null; const pool = { query: async (query, values = []) => { if(query.startsWith("CREATE")) return { rows: [] }; if(query.startsWith("INSERT")){ record={ ciphertext:values[1],iv:values[2],tag:values[3],key_hint:values[4] }; return { rows:[{provider:"openai",key_hint:record.key_hint,updated_at:"2026-07-18T00:00:00.000Z"}]}; } if(query.startsWith("SELECT provider")) return {rows:record?[{provider:"openai",key_hint:record.key_hint,updated_at:"2026-07-18T00:00:00.000Z"}]:[]}; if(query.startsWith("SELECT ciphertext")) return {rows:record?[record]:[]}; if(query.startsWith("DELETE")){const existed=Boolean(record);record=null;return {rowCount:existed?1:0,rows:[]};} return {rows:[]}; } };
  const store=createTenantProviderCredentialStore({connectionString:"postgres://governance:test@localhost:5432/nyra",masterSecret:"x".repeat(32),pool});
  const saved=await store.saveOpenAi({tenant_id:"tenant-a",api_key:"sk-proj_12345678901234567890"});
  assert.equal(saved.configured,true); assert.equal(saved.key_hint.includes("12345678901234567890"),false); assert.equal(record.ciphertext.includes("sk-proj"),false);
  assert.equal(await store.getOpenAiForExecution({tenant_id:"tenant-a"}),"sk-proj_12345678901234567890");
  assert.deepEqual(await store.removeOpenAi({tenant_id:"tenant-a"}),{removed:true});
});
