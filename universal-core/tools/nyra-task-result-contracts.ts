export type NyraTaskBase = {
  success: boolean;
  error?: string;
  timestamp: number;
};

export type MailTaskResult = NyraTaskBase & {
  delivered: boolean;
  recipient_count: number;
  message_id?: string;
  provider?: "smtp" | "api" | "unknown";
};

export type RuntimeBatchTaskResult = NyraTaskBase & {
  success_rate: number;
  error_rate: number;
  avg_latency: number;
  total_jobs: number;
  failed_jobs: number;
};

export type MacActionTaskResult = NyraTaskBase & {
  executed: boolean;
  confirmed: boolean;
  action_type: "file" | "system" | "network" | "other";
  destructive: boolean;
  system_level: boolean;
};

export type RenderCheckTaskResult = NyraTaskBase & {
  status: "ok" | "degraded" | "down";
  response_time: number;
  region?: string;
  endpoint?: string;
};

export type WordpressWorkflowTaskResult = NyraTaskBase & {
  step: "draft" | "publish" | "deploy";
  success: boolean;
  retries: number;
  post_id?: string;
  url?: string;
};
