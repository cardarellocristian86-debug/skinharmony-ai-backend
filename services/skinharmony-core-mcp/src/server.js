import { createCoreMcpApp } from "./app.js";

const port = Number(process.env.PORT || 8790);
const host = String(process.env.HOST || "0.0.0.0");
const app = createCoreMcpApp({ host });

const server = app.listen(port, host, () => {
  console.log(`[SkinHarmonyCoreMCP] listening on ${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
