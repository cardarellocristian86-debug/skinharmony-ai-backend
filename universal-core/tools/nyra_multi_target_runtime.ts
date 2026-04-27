import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";

export type NyraRuntimeEngine = "rust_full" | "rust_digest" | "rust_v7" | "rust_v7_selector" | "rust_owner_rich" | "rust_owner_fast";

export type PersistentRustJobResult = {
  decisions_per_second?: number;
  completed_decisions?: number;
  elapsed_ms?: number;
  threads_used?: number;
};

const ROOT = join(process.cwd(), "..");
const RUST_BINARY = join(ROOT, "universal-core", "native", "rust-core", "target", "release", "universal-core-rust-bench");

export class PersistentRustRunner {
  private child?: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, { resolve: (value: PersistentRustJobResult) => void; reject: (error: Error) => void }>();
  private buffer = "";
  private readonly jobPrefix: string;

  constructor(jobPrefix = "nyra-runtime") {
    this.jobPrefix = jobPrefix;
  }

  start(): void {
    if (this.child) return;
    this.child = spawn(RUST_BINARY, ["service-batch"], { stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.on("data", (chunk) => this.onStdout(chunk.toString()));
    this.child.on("close", () => {
      for (const pending of this.pending.values()) pending.reject(new Error("persistent_runner_closed"));
      this.pending.clear();
      this.child = undefined;
    });
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) {
        const parsed = JSON.parse(line) as { job_id?: string; report?: PersistentRustJobResult; error?: string };
        const jobId = parsed.job_id;
        if (jobId && this.pending.has(jobId)) {
          const handlers = this.pending.get(jobId)!;
          this.pending.delete(jobId);
          if (parsed.error) handlers.reject(new Error(parsed.error));
          else handlers.resolve(parsed.report ?? {});
        }
      }
      newlineIndex = this.buffer.indexOf("\n");
    }
  }

  async runJob(engine: NyraRuntimeEngine, limit: number, threads: number): Promise<PersistentRustJobResult> {
    this.start();
    const child = this.child;
    if (!child) throw new Error("persistent_runner_missing");
    const jobId = `${this.jobPrefix}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const line = `${jobId}\t${engine}\t${limit}\t${threads}\t${engine === "rust_v7" || engine === "rust_v7_selector" ? 1 : 0}\n`;
    return await new Promise<PersistentRustJobResult>((resolve, reject) => {
      this.pending.set(jobId, { resolve, reject });
      child.stdin.write(line, "utf8", (error) => {
        if (error) {
          this.pending.delete(jobId);
          reject(error);
        }
      });
    });
  }

  shutdown(): void {
    if (!this.child) return;
    this.child.stdin.write("shutdown\n");
    this.child.stdin.end();
    this.child.kill();
    this.child = undefined;
  }
}

export class PersistentRustRunnerPool {
  private readonly runners: PersistentRustRunner[];

  constructor(size: number, jobPrefix = "nyra-runtime") {
    this.runners = Array.from({ length: Math.max(1, size) }, (_, index) => new PersistentRustRunner(`${jobPrefix}:${index}`));
  }

  async runBatch<TJob, TResult>(
    batch: TJob[],
    runOne: (runner: PersistentRustRunner, job: TJob, runnerIndex: number) => Promise<TResult>,
  ): Promise<TResult[]> {
    return await Promise.all(
      batch.map(async (job, batchIndex) => {
        const runnerIndex = batchIndex % this.runners.length;
        const runner = this.runners[runnerIndex]!;
        return await runOne(runner, job, runnerIndex);
      }),
    );
  }

  shutdown(): void {
    for (const runner of this.runners) runner.shutdown();
  }
}
