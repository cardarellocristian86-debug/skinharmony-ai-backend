"use strict";

const crypto = require("crypto");
const {
  DATASET_VERSION,
  DATASET_CENTER_NAME,
  TOTAL_REVENUE_CENTS,
  COLLECTION_NAMES,
  buildGold18mDataset,
  auditCollections,
  buildApplyDigest,
  planStructureCollections,
  planWaveCollections,
  planFinalizeCollections,
  dashboardSnapshotsForDataset,
  collectionsForService,
  initializeServiceRepositories,
  commitCollections,
  flushLegacyWritesAndVerify,
  verifyGold18mCollections,
  runtimeGoldSummary,
  assertSafeTargetCenterId,
  assertSafeTargetCenterName,
  superadminSetDigest,
  tenantAuthDigest,
  collectionDigests,
  stableStringify,
  sha256
} = require("../src/Gold18mTenantAdmin");
const { DesktopMirrorService } = require("../src/DesktopMirrorService");
const { PostgresPersistenceAdapter } = require("../src/PostgresPersistenceAdapter");
const {
  computeCenterProfitabilitySnapshot
} = require("../src/core/profitability/ProfitabilityCore");

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {};
  argv.forEach((arg) => {
    if (!arg.startsWith("--")) return;
    const [rawKey, ...rawValue] = arg.slice(2).split("=");
    parsed[rawKey] = rawValue.length ? rawValue.join("=") : true;
  });
  return parsed;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizedAudit(audit) {
  return {
    datasetVersion: audit.datasetVersion,
    superadminCount: audit.superadminCount,
    tenantCenterCount: audit.tenantCenterCount,
    tenantAccountCount: audit.tenantAccountCount,
    recommendedKeepCenterId: audit.recommendedKeepCenterId,
    previewDigest: audit.previewDigest,
    superadminSetDigest: audit.superadminSetDigest,
    centerlessCounts: audit.centerlessCounts,
    candidates: audit.candidates.map((candidate) => ({
      centerId: candidate.centerId,
      centerName: candidate.centerName,
      accountCount: candidate.accountCount,
      primaryUserId: candidate.primaryUserId,
      primaryUserFingerprint: candidate.primaryUserFingerprint,
      accounts: candidate.accounts,
      plan: candidate.plan,
      active: candidate.active,
      counts: candidate.counts,
      score: candidate.score
    }))
  };
}

function requireDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    const error = new Error("DATABASE_URL PostgreSQL obbligatorio. Il job non usa fallback JSON.");
    error.code = "gold_seed_postgres_required";
    throw error;
  }
  return process.env.DATABASE_URL;
}

async function readCollectionsReadonly() {
  const adapter = new PostgresPersistenceAdapter(requireDatabaseUrl());
  const pool = adapter.createPool();
  const client = await pool.connect();
  let began = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    began = true;
    const result = await client.query(
      `SELECT collection_name, payload, revision
       FROM smartdesk_collection_snapshots
       WHERE tenant_id = $1 AND collection_name = ANY($2::text[])
       ORDER BY collection_name`,
      [adapter.tenantId, COLLECTION_NAMES]
    );
    const rows = new Map(result.rows.map((row) => [String(row.collection_name), row]));
    const missing = COLLECTION_NAMES.filter((name) => !rows.has(name));
    if (missing.length) {
      const error = new Error(`Collezioni PostgreSQL mancanti: ${missing.join(", ")}`);
      error.code = "gold_seed_readonly_collection_missing";
      throw error;
    }
    const collections = Object.fromEntries(COLLECTION_NAMES.map((name) => [name, rows.get(name).payload]));
    const revisions = Object.fromEntries(COLLECTION_NAMES.map((name) => [name, Number(rows.get(name).revision || 0)]));
    await client.query("COMMIT");
    began = false;
    return { adapter, collections, revisions };
  } catch (error) {
    if (began) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original read-only failure.
      }
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function acquireApplyLock(adapter) {
  const client = await adapter.createPool().connect();
  try {
    const result = await client.query(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
      [`smartdesk:${adapter.tenantId}:exclusive_tenant_maintenance`]
    );
    if (!result.rows[0]?.locked) {
      const error = new Error("Un altro job Gold 18m e gia in esecuzione.");
      error.code = "gold_seed_concurrent_job";
      throw error;
    }
    return client;
  } catch (error) {
    client.release();
    throw error;
  }
}

async function releaseApplyLock(client, adapter) {
  if (!client) return;
  try {
    await client.query(
      "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
      [`smartdesk:${adapter.tenantId}:exclusive_tenant_maintenance`]
    );
  } finally {
    client.release();
  }
}

async function assertLockAlive(client) {
  const result = await client.query("SELECT pg_backend_pid() AS backend_pid");
  assertInvariantForJob(Boolean(result.rows[0]?.backend_pid), "Lock PostgreSQL non disponibile", "gold_seed_lock_lost");
}

async function openLockedService(options = {}) {
  const adapter = options.adapter || new PostgresPersistenceAdapter(requireDatabaseUrl());
  const buildService = options.buildService
    || ((persistenceAdapter) => new DesktopMirrorService({ persistenceAdapter }));
  const initialize = options.initialize || initializeServiceRepositories;
  let lockClient;
  try {
    lockClient = await acquireApplyLock(adapter);
    await assertLockAlive(lockClient);
    const service = buildService(adapter);
    await initialize(service, adapter);
    await assertLockAlive(lockClient);
    return { adapter, service, lockClient };
  } catch (error) {
    if (lockClient) {
      try {
        await releaseApplyLock(lockClient, adapter);
      } catch {
        // Preserve the initialization/lock failure.
      }
    }
    await adapter.pool?.end?.();
    throw error;
  }
}

function assertInvariantForJob(condition, message, code) {
  if (condition) return;
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertWriteFreeze() {
  const enabled = ["1", "true", "yes", "on"].includes(String(process.env.SMARTDESK_WRITE_FREEZE || "").toLowerCase());
  assertInvariantForJob(enabled, "SMARTDESK_WRITE_FREEZE deve essere attivo prima di apply/rollback.", "gold_seed_write_freeze_required");
}

function assertPreview(audit, args, centerId, userId, centerName) {
  const expected = String(args["confirm-digest"] || "").trim();
  const actual = buildApplyDigest(audit, { centerId, userId, centerName });
  if (!expected || expected !== actual) {
    const error = new Error("Digest inventario assente o non coincidente: riesegui --mode=audit.");
    error.code = "gold_seed_preview_digest_mismatch";
    throw error;
  }
}

function resolveTargetCenter(audit, args) {
  const requested = String(args["keep-center-id"] || "").trim();
  assertInvariantForJob(Boolean(requested), "--keep-center-id esplicito obbligatorio", "gold_seed_target_required");
  assertSafeTargetCenterId(requested);
  const candidate = audit.candidates.find((item) => item.centerId === requested);
  if (!candidate) {
    const error = new Error("Il centerId target non appartiene a un account tenant verificato.");
    error.code = "gold_seed_target_not_found";
    throw error;
  }
  return requested;
}

function assertSafeTargetUserId(userId = "") {
  const value = String(userId || "").trim();
  assertInvariantForJob(Boolean(value), "--keep-user-id esplicito obbligatorio", "gold_seed_target_user_required");
  assertInvariantForJob(
    !["__proto__", "prototype", "constructor"].includes(value.toLowerCase()),
    "Account target non sicuro",
    "gold_seed_invalid_target_user"
  );
  assertInvariantForJob(
    /^[a-zA-Z0-9._:-]{3,160}$/.test(value),
    "Account target contiene caratteri non ammessi",
    "gold_seed_invalid_target_user"
  );
  return value;
}

function resolveTargetUser(audit, centerId, args) {
  const requested = assertSafeTargetUserId(args["keep-user-id"]);
  const candidate = audit.candidates.find((item) => item.centerId === centerId);
  const matches = (candidate?.accounts || []).filter((item) => item.id === requested);
  assertInvariantForJob(matches.length === 1, "Account target non presente o ambiguo", "gold_seed_target_user_missing");
  return requested;
}

async function ensureBackupTable(client, tenantId) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS smartdesk_gold_seed_backups (
      tenant_id TEXT NOT NULL,
      backup_id UUID NOT NULL,
      dataset_version TEXT NOT NULL,
      state_digest TEXT NOT NULL,
      superadmin_set_digest TEXT NOT NULL,
      payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'available',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      restored_at TIMESTAMPTZ,
      PRIMARY KEY (tenant_id, backup_id)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_smartdesk_gold_seed_backups_expiry
    ON smartdesk_gold_seed_backups (tenant_id, expires_at)
  `);
  await client.query(
    `DELETE FROM smartdesk_gold_seed_backups
     WHERE tenant_id = $1 AND expires_at < NOW()`,
    [tenantId]
  );
}

async function createBackup(client, adapter, collections) {
  await ensureBackupTable(client, adapter.tenantId);
  const backupId = crypto.randomUUID();
  const stateDigest = sha256(stableStringify(collections));
  const superadminDigest = superadminSetDigest(collections.users);
  const revisions = Object.fromEntries(COLLECTION_NAMES.map((name) => [name, Number(adapter.getRevision(name) || 0)]));
  const payload = { collections, revisions };
  await client.query(
    `INSERT INTO smartdesk_gold_seed_backups (
       tenant_id, backup_id, dataset_version, state_digest,
       superadmin_set_digest, payload, status, expires_at
     ) VALUES ($1, $2::uuid, $3, $4, $5, $6::jsonb, 'available', NOW() + INTERVAL '14 days')`,
    [
      adapter.tenantId,
      backupId,
      DATASET_VERSION,
      stateDigest,
      superadminDigest,
      JSON.stringify(payload)
    ]
  );
  return {
    backupId,
    stateDigest,
    superadminDigest,
    collections
  };
}

async function loadBackup(client, adapter, backupId) {
  const result = await client.query(
    `SELECT backup_id::text, state_digest, superadmin_set_digest, payload, status, expires_at
     FROM smartdesk_gold_seed_backups
     WHERE tenant_id = $1 AND backup_id = $2::uuid
     LIMIT 1`,
    [adapter.tenantId, backupId]
  );
  const row = result.rows[0];
  assertInvariantForJob(Boolean(row), "Backup non trovato", "gold_seed_backup_not_found");
  assertInvariantForJob(new Date(row.expires_at).getTime() > Date.now(), "Backup scaduto", "gold_seed_backup_expired");
  const collections = row.payload?.collections;
  assertInvariantForJob(Boolean(collections && typeof collections === "object"), "Backup non valido", "gold_seed_backup_invalid");
  assertInvariantForJob(COLLECTION_NAMES.every((name) => Object.prototype.hasOwnProperty.call(collections, name)), "Backup incompleto", "gold_seed_backup_invalid");
  assertInvariantForJob(sha256(stableStringify(collections)) === row.state_digest, "Digest backup non valido", "gold_seed_backup_digest_mismatch");
  assertInvariantForJob(superadminSetDigest(collections.users) === row.superadmin_set_digest, "Digest superadmin backup non valido", "gold_seed_backup_digest_mismatch");
  return {
    backupId: row.backup_id,
    stateDigest: row.state_digest,
    superadminDigest: row.superadmin_set_digest,
    status: row.status,
    collections
  };
}

async function markBackup(client, adapter, backupId, status) {
  await client.query(
    `UPDATE smartdesk_gold_seed_backups
     SET status = $3,
         restored_at = CASE WHEN $3 = 'restored' THEN NOW() ELSE restored_at END
     WHERE tenant_id = $1 AND backup_id = $2::uuid`,
    [adapter.tenantId, backupId, status]
  );
}

async function restoreBackup(service, adapter, client, backup) {
  await assertLockAlive(client);
  await commitCollections(service, backup.collections, COLLECTION_NAMES);
  const restored = collectionsForService(service);
  assertInvariantForJob(
    sha256(stableStringify(restored)) === backup.stateDigest,
    "Rollback non riconciliato con il digest del backup",
    "gold_seed_rollback_mismatch"
  );
  assertInvariantForJob(
    superadminSetDigest(restored.users) === backup.superadminDigest,
    "Superadmin non riconciliato dopo rollback",
    "gold_seed_rollback_mismatch"
  );
  await markBackup(client, adapter, backup.backupId, "restored");
}

async function runAudit(args) {
  const { collections } = await readCollectionsReadonly();
  const audit = auditCollections(collections);
  if (!audit.superadminCount) {
    const error = new Error("Nessun superadmin rilevato: operazione bloccata.");
    error.code = "gold_seed_superadmin_missing";
    throw error;
  }
  if (!audit.tenantCenterCount) {
    const error = new Error("Nessun tenant esistente da conservare.");
    error.code = "gold_seed_no_tenant";
    throw error;
  }
  const bindingArgsPresent = ["keep-center-id", "keep-user-id", "center-name"]
    .filter((key) => String(args[key] || "").trim()).length;
  assertInvariantForJob(bindingArgsPresent === 0 || bindingArgsPresent === 3, "Per l'audit vincolato servono center, user e nome insieme", "gold_seed_incomplete_binding");
  const bound = bindingArgsPresent === 3
    ? {
        centerId: resolveTargetCenter(audit, args),
        userId: "",
        centerName: assertSafeTargetCenterName(args["center-name"])
      }
    : null;
  if (bound) bound.userId = resolveTargetUser(audit, bound.centerId, args);
  console.log(JSON.stringify({
    success: true,
    mode: "audit",
    readOnly: true,
    sqlTransaction: "repeatable_read_read_only",
    ...sanitizedAudit(audit),
    boundApply: bound ? {
      centerId: bound.centerId,
      userId: bound.userId,
      centerName: bound.centerName,
      applyDigest: buildApplyDigest(audit, bound)
    } : null
  }, null, 2));
}

async function runVerify(args) {
  const { collections } = await readCollectionsReadonly();
  const audit = auditCollections(collections);
  const centerId = resolveTargetCenter(audit, args);
  const userId = resolveTargetUser(audit, centerId, args);
  const centerName = assertSafeTargetCenterName(args["center-name"] || DATASET_CENTER_NAME);
  const dataset = buildGold18mDataset({ centerId, centerName });
  const expectedSuperadminDigest = String(args["expected-superadmin-digest"] || "").trim();
  const expectedTenantAuthDigest = String(args["expected-tenant-auth-digest"] || "").trim();
  assertInvariantForJob(/^[a-f0-9]{64}$/.test(expectedSuperadminDigest), "--expected-superadmin-digest obbligatorio", "gold_seed_superadmin_digest_required");
  assertInvariantForJob(/^[a-f0-9]{64}$/.test(expectedTenantAuthDigest), "--expected-tenant-auth-digest obbligatorio", "gold_seed_tenant_auth_digest_required");
  const verification = verifyGold18mCollections(
    collections,
    centerId,
    dataset,
    expectedSuperadminDigest,
    expectedTenantAuthDigest
  );
  const target = (name) => (Array.isArray(collections[name]) ? collections[name] : [])
    .filter((item) => String(item.centerId || "") === centerId);
  const settings = collections.settings?.[centerId] || {};
  const profitability = computeCenterProfitabilitySnapshot({
    appointments: target("appointments"),
    services: target("services"),
    staff: target("staff"),
    payments: target("payments"),
    inventory: target("inventory"),
    resources: target("resources"),
    fixedCostProfile: settings.goldFixedCostProfile || {}
  });
  console.log(JSON.stringify({
    success: verification.ok,
    mode: "verify",
    readOnly: true,
    sqlTransaction: "repeatable_read_read_only",
    requiresServiceRestart: false,
    targetBinding: { centerId, userId, centerName, tenantAuthDigest: expectedTenantAuthDigest },
    verification,
    runtime: {
      profitabilityRevenueCents: Number(profitability.totals?.revenueCents || 0),
      profitabilityExecutions: Number(profitability.totals?.executions || 0),
      payrollMonthlyCents: Number(profitability.operatingCostMinuteProfile?.staffMonthlyCents || 0),
      technologyMonthlyCents: Number(profitability.operatingCostMinuteProfile?.technologyMonthlyCents || 0)
    }
  }, null, 2));
  if (!verification.ok) process.exitCode = 2;
}

async function runApplyAll(args) {
  assertWriteFreeze();
  let adapter;
  let service;
  let lockClient;
  let backup;
  let mutationStarted = false;
  try {
    ({ adapter, service, lockClient } = await openLockedService());
    const beforeCollections = collectionsForService(service);
    const audit = auditCollections(beforeCollections);
    const centerId = resolveTargetCenter(audit, args);
    const userId = resolveTargetUser(audit, centerId, args);
    const centerName = assertSafeTargetCenterName(args["center-name"]);
    assertPreview(audit, args, centerId, userId, centerName);
    const expectedTenantAuthDigest = tenantAuthDigest(beforeCollections.users, userId);
    assertInvariantForJob(/^[a-f0-9]{64}$/.test(expectedTenantAuthDigest), "Digest autenticazione tenant non disponibile", "gold_seed_tenant_auth_digest_missing");
    const dataset = buildGold18mDataset({ centerId, centerName });
    const waveDelayMs = Math.max(250, Math.min(5000, Number(args["wave-delay-ms"] || 1500)));
    backup = await createBackup(lockClient, adapter, beforeCollections);
    console.log(JSON.stringify({
      event: "gold18m_backup_created",
      datasetVersion: DATASET_VERSION,
      centerId,
      backupId: backup.backupId,
      stateDigest: backup.stateDigest,
      superadminSetDigest: backup.superadminDigest,
      retentionDays: 14,
      mutationStarted: false
    }));
    const assertSuperadminsUnchanged = () => assertInvariantForJob(
      superadminSetDigest(collectionsForService(service).users) === backup.superadminDigest,
      "Superadmin modificato durante il caricamento",
      "gold_seed_superadmin_changed"
    );
    const assertTenantAuthUnchanged = () => assertInvariantForJob(
      tenantAuthDigest(collectionsForService(service).users, userId) === expectedTenantAuthDigest,
      "Identita o credenziali tenant modificate durante il caricamento",
      "gold_seed_tenant_auth_changed"
    );

    const structured = planStructureCollections(beforeCollections, centerId, dataset, userId);
    mutationStarted = true;
    await commitCollections(service, structured, COLLECTION_NAMES);
    await assertLockAlive(lockClient);
    assertSuperadminsUnchanged();
    assertTenantAuthUnchanged();
    console.log(JSON.stringify({
      event: "gold18m_phase_complete",
      phase: "structure_and_exact_prune",
      centerId,
      datasetVersion: DATASET_VERSION,
      preservedSuperadmins: audit.superadminCount,
      remainingTenantAccounts: 1
    }));
    await delay(waveDelayMs);

    for (let wave = 1; wave <= 3; wave += 1) {
      await assertLockAlive(lockClient);
      const current = collectionsForService(service);
      const planned = planWaveCollections(current, centerId, dataset, wave);
      const changedNames = [
        "clients",
        "appointments",
        "payments",
        "shifts",
        "treatments",
        "inventory_movements",
        "cash_closures",
        "ai_marketing_actions",
        "gold_action_outcomes",
        "gold_imports"
      ];
      await commitCollections(service, planned, changedNames);
      assertSuperadminsUnchanged();
      assertTenantAuthUnchanged();
      const currentAfterWave = collectionsForService(service);
      const partialPayments = currentAfterWave.payments.filter((item) => String(item.centerId || "") === centerId);
      console.log(JSON.stringify({
        event: "gold18m_wave_complete",
        wave,
        monthsLoaded: wave * 6,
        paymentsLoaded: partialPayments.length,
        revenueCentsLoaded: partialPayments.reduce((sum, item) => sum + Number(item.amountCents || 0), 0)
      }));
      await delay(waveDelayMs);
    }

    const adminSession = {
      username: "render_internal_gold18m_admin_job",
      role: "superadmin",
      centerId: "center_admin",
      centerName: "SkinHarmony Admin",
      subscriptionPlan: "enterprise",
      accessState: "active"
    };
    const rebuild = service.rebuildGoldStateForTenant({ centerId }, adminSession);
    await flushLegacyWritesAndVerify(service, adapter);
    await assertLockAlive(lockClient);
    assertSuperadminsUnchanged();
    assertTenantAuthUnchanged();
    if (!rebuild.success || !rebuild.valid) {
      const error = new Error("Gold State rebuild non valido.");
      error.code = "gold_seed_rebuild_invalid";
      throw error;
    }

    const runtime = runtimeGoldSummary(service, centerId, dataset.centerName);
    await flushLegacyWritesAndVerify(service, adapter);
    assertInvariantForJob(
      Number(runtime.summary.profitabilityRevenueCents || 0) === TOTAL_REVENUE_CENTS,
      "Redditivita runtime non riconciliata con gli incassi",
      "gold_seed_profitability_mismatch"
    );
    const preliminaryVerification = verifyGold18mCollections(
      collectionsForService(service),
      centerId,
      dataset,
      backup.superadminDigest,
      expectedTenantAuthDigest,
      { requireCompleteImportManifest: false }
    );
    const snapshots = dashboardSnapshotsForDataset(service, runtime.session, dataset);
    const finalized = planFinalizeCollections(
      collectionsForService(service),
      centerId,
      dataset,
      snapshots,
      preliminaryVerification
    );
    await commitCollections(service, finalized, ["dashboard_snapshots", "gold_imports"]);
    await assertLockAlive(lockClient);
    assertSuperadminsUnchanged();
    assertTenantAuthUnchanged();
    const verification = verifyGold18mCollections(
      collectionsForService(service),
      centerId,
      dataset,
      backup.superadminDigest,
      expectedTenantAuthDigest
    );
    if (!verification.ok) {
      const error = new Error(`Verifica finale fallita: ${verification.checks.filter((item) => !item.ok).map((item) => item.name).join(", ")}`);
      error.code = "gold_seed_final_verification_failed";
      error.verification = verification;
      throw error;
    }
    await markBackup(lockClient, adapter, backup.backupId, "applied");

    console.log(JSON.stringify({
      success: true,
      mode: "apply-all",
      datasetVersion: DATASET_VERSION,
      datasetDigest: dataset.manifest.datasetDigest,
      centerId,
      userId,
      tenantAuthDigest: expectedTenantAuthDigest,
      centerName: dataset.centerName,
      backup: {
        backupId: backup.backupId,
        stateDigest: backup.stateDigest,
        superadminSetDigest: backup.superadminDigest,
        retentionDays: 14
      },
      destructiveScope: {
        originalTenantCenters: audit.tenantCenterCount,
        originalTenantAccounts: audit.tenantAccountCount,
        remainingTenantCenters: 1,
        remainingTenantAccounts: 1,
        superadminsPreserved: audit.superadminCount
      },
      waves: [
        { wave: 1, months: 6 },
        { wave: 2, months: 12 },
        { wave: 3, months: 18 }
      ],
      verification,
      runtime: runtime.summary,
      serviceRestartRequired: true,
      note: "Riavviare il web service una sola volta per riallineare la cache in-memory, poi eseguire --mode=verify."
    }, null, 2));
  } catch (error) {
    if (backup && mutationStarted && lockClient) {
      try {
        await restoreBackup(service, adapter, lockClient, backup);
        error.rollbackStatus = "restored";
        error.backupId = backup.backupId;
      } catch (rollbackError) {
        error.rollbackStatus = "failed";
        error.backupId = backup.backupId;
        error.rollbackErrorCode = String(rollbackError.code || "gold_seed_rollback_failed");
      }
    }
    throw error;
  } finally {
    try {
      await releaseApplyLock(lockClient, adapter);
    } finally {
      await adapter?.pool?.end?.();
    }
  }
}

async function runRollback(args) {
  assertWriteFreeze();
  const backupId = String(args["backup-id"] || "").trim();
  const confirmDigest = String(args["confirm-backup-digest"] || "").trim();
  assertInvariantForJob(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(backupId), "--backup-id UUID obbligatorio", "gold_seed_backup_id_required");
  assertInvariantForJob(/^[a-f0-9]{64}$/.test(confirmDigest), "--confirm-backup-digest obbligatorio", "gold_seed_backup_digest_required");
  let adapter;
  let service;
  let lockClient;
  try {
    ({ adapter, service, lockClient } = await openLockedService());
    await ensureBackupTable(lockClient, adapter.tenantId);
    const backup = await loadBackup(lockClient, adapter, backupId);
    assertInvariantForJob(confirmDigest === backup.stateDigest, "Conferma digest backup non coincidente", "gold_seed_backup_digest_mismatch");
    const currentDigest = sha256(stableStringify(collectionsForService(service)));
    if (currentDigest !== backup.stateDigest) {
      await restoreBackup(service, adapter, lockClient, backup);
    } else {
      await markBackup(lockClient, adapter, backup.backupId, "restored");
    }
    console.log(JSON.stringify({
      success: true,
      mode: "rollback",
      backupId: backup.backupId,
      restoredStateDigest: backup.stateDigest,
      superadminSetDigest: backup.superadminDigest,
      serviceRestartRequired: true
    }, null, 2));
  } finally {
    try {
      await releaseApplyLock(lockClient, adapter);
    } finally {
      await adapter?.pool?.end?.();
    }
  }
}

async function main() {
  const args = parseArgs();
  const mode = String(args.mode || "audit").toLowerCase();
  if (mode === "audit") return runAudit(args);
  if (mode === "verify") return runVerify(args);
  if (mode === "apply-all") return runApplyAll(args);
  if (mode === "rollback") return runRollback(args);
  const error = new Error("Mode supportate: audit, apply-all, verify, rollback.");
  error.code = "gold_seed_invalid_mode";
  throw error;
}

function reportFailure(error) {
  const payload = {
    success: false,
    error: String(error.code || "gold_seed_failed"),
    message: String(error.message || "Gold seed fallito")
  };
  if (error.verification) payload.verification = error.verification;
  if (error.rollbackStatus) payload.rollbackStatus = error.rollbackStatus;
  if (error.backupId) payload.backupId = error.backupId;
  if (error.rollbackErrorCode) payload.rollbackErrorCode = error.rollbackErrorCode;
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
}

if (require.main === module) {
  main().catch(reportFailure);
}

module.exports = {
  parseArgs,
  sanitizedAudit,
  readCollectionsReadonly,
  acquireApplyLock,
  releaseApplyLock,
  openLockedService,
  assertWriteFreeze,
  resolveTargetCenter,
  assertSafeTargetUserId,
  resolveTargetUser,
  ensureBackupTable,
  createBackup,
  loadBackup,
  restoreBackup,
  runAudit,
  runVerify,
  runApplyAll,
  runRollback,
  main
};
