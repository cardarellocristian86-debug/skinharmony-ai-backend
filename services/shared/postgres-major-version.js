export const REQUIRED_POSTGRES_MAJOR = 16;
export const POSTGRES_MAJOR_VERSION_QUERY =
  "SELECT current_setting('server_version_num')::integer AS server_version_num";

function normalizedMajor(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 10_000) return null;
  const major = Math.trunc(parsed / 10_000);
  return major >= 1 && major <= 99 ? major : null;
}

export function normalizePostgresMajorVerification(
  value,
  expectedMajor = REQUIRED_POSTGRES_MAJOR,
) {
  const major = Number.isInteger(value?.major) ? value.major : null;
  return Object.freeze({
    major,
    verified: value?.verified === true && major === expectedMajor,
  });
}

export function createPostgresMajorVersionProbe({
  pool,
  query,
  expectedMajor = REQUIRED_POSTGRES_MAJOR,
  cacheTtlMs = 5_000,
  timeoutMs = 2_000,
  now = () => Date.now(),
} = {}) {
  const runQuery =
    typeof query === "function"
      ? query
      : typeof pool?.query === "function"
        ? (statement) => pool.query(statement)
        : null;
  const ttl = Math.max(0, Math.min(Number(cacheTtlMs) || 0, 60_000));
  const timeout = Math.max(1, Math.min(Number(timeoutMs) || 2_000, 10_000));
  let cached = null;
  let pending = null;

  async function boundedQuery() {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => runQuery(POSTGRES_MAJOR_VERSION_QUERY)),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("postgres_version_probe_timeout")),
            timeout,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function execute() {
    if (!runQuery) {
      return normalizePostgresMajorVerification(null, expectedMajor);
    }
    try {
      const result = await boundedQuery();
      const major = normalizedMajor(result?.rows?.[0]?.server_version_num);
      return normalizePostgresMajorVerification({
        major,
        verified: major === expectedMajor,
      }, expectedMajor);
    } catch {
      return normalizePostgresMajorVerification(null, expectedMajor);
    }
  }

  return Object.freeze({
    async check() {
      const checkedAt = Number(now());
      if (
        cached &&
        Number.isFinite(checkedAt) &&
        checkedAt - cached.checkedAt < ttl
      ) {
        return cached.result;
      }
      if (pending) return pending;
      pending = execute().then((result) => {
        cached = {
          checkedAt: Number.isFinite(Number(now())) ? Number(now()) : checkedAt,
          result,
        };
        return result;
      }).finally(() => {
        pending = null;
      });
      return pending;
    },
  });
}
