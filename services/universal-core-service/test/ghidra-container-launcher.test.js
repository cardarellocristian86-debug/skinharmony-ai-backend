import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildContainerArguments } from "../workers/ghidra/ghidra-container-launcher.mjs";

const image = "registry.example/usi-ghidra@sha256:" + "a".repeat(64);
const cwd = path.resolve("/tmp/usi-job");
const arguments_ = (overrides = []) => [
  "--input", path.join(cwd, "input.bin"),
  "--output", path.join(cwd, "evidence.json"),
  "--network", "none",
  "--cpu-seconds", "12",
  "--memory-megabytes", "512",
  "--wall-time-seconds", "30",
  "--output-bytes", "1048576",
  ...overrides,
];

test("container launch is immutable, rootless-compatible, networkless and resource bounded", () => {
  const result = buildContainerArguments(arguments_(), cwd, { image });
  for (const required of ["--network", "none", "--read-only", "--cap-drop", "ALL", "no-new-privileges:true", "--pids-limit", "--memory", "512m", "--cpus", "1.0", "--ulimit", "cpu=12:12", image]) assert(result.includes(required));
  assert(result.includes("type=bind,src=/tmp/usi-job,dst=/work"));
  assert(result.includes("/work/input.bin"));
  assert(result.includes("/work/evidence.json"));
});

test("container launch fails closed for mutable images, network access and paths outside the job", () => {
  assert.throws(() => buildContainerArguments(arguments_(), cwd, { image: "registry.example/usi-ghidra:latest" }), /image_digest_required/);
  const networked = arguments_(); networked[networked.indexOf("--network") + 1] = "bridge";
  assert.throws(() => buildContainerArguments(networked, cwd, { image }), /network_denied/);
  const outside = arguments_(); outside[outside.indexOf("--input") + 1] = "/tmp/outside.bin";
  assert.throws(() => buildContainerArguments(outside, cwd, { image }), /path_outside_job/);
  const oversized = arguments_(); oversized[oversized.indexOf("--memory-megabytes") + 1] = "4096";
  assert.throws(() => buildContainerArguments(oversized, cwd, { image }), /resource_limit_invalid/);
});

test("container build arguments are global and upstream archive is hash pinned", () => {
  const source = fs.readFileSync(new URL("../workers/ghidra/Containerfile", import.meta.url), "utf8");
  const firstFrom = source.indexOf("FROM ");
  assert(firstFrom > source.indexOf("ARG BUILDER_IMAGE"));
  assert(firstFrom > source.indexOf("ARG RUNTIME_IMAGE"));
  assert.match(source, /ghidra_12\.1_PUBLIC_20260513\.zip/);
  assert.match(source, /aa5cbcbbf48f41ca185fce900e19592f1ade4cd5994eb6e0ede468dac8a6f302/);
});
