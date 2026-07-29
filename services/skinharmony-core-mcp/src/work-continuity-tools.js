function annotations(readOnly) {
  return { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false, idempotentHint: true };
}

const ownerProperties = {
  owner_confirmed: { type: "boolean", description: "Set true only after the owner confirms this exact write." },
  confirmation_reference: { type: "string", maxLength: 240 },
};
const presence = {
  agent_id: { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$" },
  client_type: { type: "string", enum: ["chatgpt", "codex", "api_agent", "other"] },
  session_id: { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$" },
};
const object = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const text = (maxLength = 20_000) => ({ type: "string", minLength: 1, maxLength });
const identifier = { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$" };
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" };
const uuid = { type: "string", format: "uuid" };
const stateHashes = object({ repository_hash: hash, policy_hash: hash, live_state_hash: hash },
  ["repository_hash", "policy_hash", "live_state_hash"]);

function tool(name, title, description, inputSchema, readOnly) {
  const schema = {
    ...inputSchema,
    properties: { ...inputSchema.properties, ...presence, ...(!readOnly ? ownerProperties : {}) },
  };
  return {
    name, title, description, inputSchema: schema,
    scopes: [readOnly ? "core:read" : "core:govern"],
    annotations: annotations(readOnly),
    ...(!readOnly ? { _meta: { "skinharmony/ownerConfirmationRequired": true } } : {}),
  };
}

export const WORK_CONTINUITY_TOOLS = [
  tool("work_continuity_create", "Create persistent work continuity",
    "Create tenant-scoped Work Identity and the first architecture-map version with a hash-chained event ledger.",
    object({
      project_id: identifier, work_id: uuid, session_id: identifier, parent_work_id: uuid,
      idea: text(8_000), objective: text(8_000), architecture: { type: "object", additionalProperties: true },
      repository_hash: hash, policy_hash: hash, live_state_hash: hash, next_action: text(4_000),
    }, ["project_id", "session_id", "idea", "objective", "architecture", "next_action"]), false),
  tool("work_continuity_record_change", "Version architecture and impact map",
    "Persist a new architecture version and calculate affected functions, components, links, dependencies, depth and regressions.",
    object({
      work_id: uuid, expected_version: { type: "integer", minimum: 1 },
      architecture: { type: "object", additionalProperties: true },
      change: object({
        function_id: { type: "string", maxLength: 160 }, reason: text(2_000),
        components: { type: "array", maxItems: 100, items: { type: "string", maxLength: 160 } },
        dependencies: { type: "array", maxItems: 100, items: { type: "string", maxLength: 160 } },
        links: { type: "array", maxR][\ÎˆL][\ÎˆÈ\Nˆœİš[™È‹X^[™İˆMŒHKˆ™YÜ™\ÜÚ[Û—İ\™Ù]ÎˆÈ\Nˆ˜\œ˜^H‹X^][\ÎˆL][\ÎˆÈ\Nˆœİš[™È‹X^[™İˆMŒHKˆ\Ù[NˆÈ\Nˆš[YÙ\ˆ‹Z[š[][NˆLM‹X^[][NˆMˆKˆKÈœ™X\ÛÛˆ—JKˆ]™[İ\NˆÈ\Nˆœİš[™È‹[[NˆÈ˜œ˜[˜ÚÛÜ[™Y‹™[˜İ[Û—ØYY‹™[˜İ[Û—ØÚ[™ÙY‹™\[™[˜ŞWØÚ[™ÙY‹\İØÛÛ\]Y‹™Y™XİÙ›İ[™‹˜ÛÜœ™Xİ[Û—İ™\šYšYY‹œ›Û˜XÚ×Ü™\\™Y—HKˆ™^ØXİ[Ûˆ^
Ì
KY[\İ[˜ŞWÚÙ^Nˆ^
MŒ
KˆKÈÛÜš×ÚY‹™^XİYİ™\œÚ[Ûˆ‹˜\˜Ú]Xİ\™H‹˜Ú[™ÙH‹›™^ØXİ[Ûˆ‹šY[\İ[˜ŞWÚÙ^H—JK˜[ÙJKˆÛÛ
ÛÜš×ØÛÛ[Z]WØÚXÚÜÚ[‹Ü™X]HÛÛ[Z]HØ\İ[H‹ˆÜ™X]HHYÙ\İ]™\šYšXX›HÛÛ[Z]HØ\İ[HÚ]Û˜\Úİ]šY[˜ÙKÛÛ[Z]\İË]]Üš^˜][Û‹›Û˜XÚÈ[™™^Xİ[Û‹ˆ‹ˆØš™Xİ
ÂˆÛÜš×ÚYˆ]ZY]šY[˜ÙNˆÈ\Nˆ˜\œ˜^H‹X^][\ÎˆL][\ÎˆÈ\Nˆ›Øš™Xİ‹Y][Û˜[›Ü\Y\ÎˆYHHKˆÛÛ[Z]Ü]ÚˆÈ\Nˆ›Øš™Xİ‹Y][Û˜[›Ü\Y\ÎˆYHKˆ\İÎˆÈ\Nˆ˜\œ˜^H‹X^][\ÎˆL][\ÎˆÈ\Nˆ›Øš™Xİ‹Y][Û˜[›Ü\Y\ÎˆYHHKˆ]]Üš^˜][ÛœÎˆÈ\Nˆ˜\œ˜^H‹X^][\ÎˆL][\ÎˆÈ\Nˆ›Øš™Xİ‹Y][Û˜[›Ü\Y\ÎˆYHHKˆ›Û˜XÚÎˆÈ\Nˆ›Øš™Xİ‹Y][Û˜[›Ü\Y\ÎˆYHK™^ØXİ[Ûˆ^
Ì
Kˆ›İ™[˜[˜ÙNˆÈ\Nˆ›Øš™Xİ‹Y][Û˜[›Ü\Y\ÎˆYHKˆ™\ÜÚ]ÜWÚ\Úˆ\ÚÛXŞWÚ\Úˆ\Ú]™WÜİ]WÚ\Úˆ\Úˆİ\\š\ÛÜ—Ø\›İ™YˆÈ\Nˆ˜›ÛÛX[ˆˆK[™Ù™—İÎˆÈ\Nˆœİš[™È‹X^[™İˆLŒKˆY[\İ[˜ŞWÚÙ^Nˆ^
MŒ
KˆKÈÛÜš×ÚY‹›™^ØXİ[Ûˆ‹œ›Û˜XÚÈ‹œ›İ™[˜[˜ÙH‹šY[\İ[˜ŞWÚÙ^H—JK˜[ÙJKˆÛÛ
ÛÜš×ØÛÛ[Z]WÜ™XY‹”™XY\œÚ\İ[ÛÜšÈÛÛ[Z]H‹ˆ”™XYÛ™H[˜[\ØÛÜYÛÜšÈY[]K]\İ\˜Ú]Xİ\™KØ\İ[H[™\ÚXÚZ[™Y]™[Ëˆ‹ˆØš™Xİ
ÈÛÜš×ÚYˆ]ZY]™[Û[Z]ˆÈ\Nˆš[YÙ\ˆ‹Z[š[][NˆKX^[][NˆŒHKÈÛÜš×ÚY—JKYJKˆÛÛ
ÛÜš×ØÛÛ[Z]WÜ™\İ[YH‹”™\İ[YH™\šYšYY\œÚ\İ[ÛÜšÈ‹ˆ”™\İ[YHÛ›HY\ˆØ\İ[HYÙ\İšYÚXÚÜÈ[™Hœ™\Ú[š]™\œØ[ÛÜ™H]]Üš^˜][Ûˆ™XØ[İ[][Û‹ˆ‹ˆØš™Xİ
ÈÛÜš×ÚYˆ]ZYÙ\ÜÚ[Û—ÚYˆY[YšY\‹İ\œ™[Üİ]WÚ\Ú\Îˆİ]R\Ú\ËY[\İ[˜ŞWÚÙ^Nˆ^
MŒ
HKˆÈÛÜš×ÚY‹œÙ\ÜÚ[Û—ÚY‹˜İ\œ™[Üİ]WÚ\Ú\È‹šY[\İ[˜ŞWÚÙ^H—JK˜[ÙJKˆÛÛ
ÛÜš×ØÛÛ[Z]Wİ™\šYWÛY[[ÜH‹”›Û[İH™\šYšYYÛÛ[Z]HY[[ÜH‹ˆ“X\šÈHØ\İ[H\È™\šYšYYY[[ÜHÛ›HY\ˆ\İ]šY[˜ÙH[™š[Üˆİ\\š\ÛÜˆ\›İ˜[ˆ‹ˆØš™Xİ
ÈÛÜš×ÚYˆ]ZYØ\İ[WÚYˆ]ZY\İÙ]šY[˜ÙNˆ^
Ì
KY[\İ[˜ŞWÚÙ^Nˆ^
MŒ
HKˆÈÛÜš×ÚY‹˜Ø\İ[WÚY‹\İÙ]šY[˜ÙH‹šY[\İ[˜ŞWÚÙ^H—JK˜[ÙJK—NÂ