import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = join(process.cwd(), "..");
const VAULT_PATH = join(ROOT, "universal-core", "runtime", "owner-private-entity", "nyra_owner_identity_private.json");
const SERVICE = "nyra_owner_identity_private_v1";
const ACCOUNT = "cristian_primary";

function main(): void {
  if (!existsSync(VAULT_PATH)) {
    throw new Error(`missing_vault:${VAULT_PATH}`);
  }

  const secret = readFileSync(VAULT_PATH, "utf8");

  try {
    execFileSync(
      "/usr/bin/security",
      ["delete-generic-password", "-a", ACCOUNT, "-s", SERVICE],
      { stdio: "ignore" },
    );
  } catch {
    // ignore missing previous entry
  }

  execFileSync(
    "/usr/bin/security",
    ["add-generic-password", "-a", ACCOUNT, "-s", SERVICE, "-w", secret, "-U"],
    { stdio: "inherit" },
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        service: SERVICE,
        account: ACCOUNT,
        seeded_from: VAULT_PATH,
      },
      null,
      2,
    ),
  );
}

main();
