#!/usr/bin/env node

import {
  applyV016StaticMigrations,
  v016MigrationPublicErrorCode,
} from "../src/v016StaticMigrations.js";

try {
  const receipt = await applyV016StaticMigrations({
    connectionString: process.env.GOVERNED_AGENT_DATABASE_URL,
  });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: v016MigrationPublicErrorCode(error),
    secrets_exposed: false,
  })}\n`);
  process.exitCode = 1;
}
