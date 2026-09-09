import { randomUUID } from "node:crypto";

export type LogLevel = "INFO" | "WARN" | "ERROR";

export interface LogContext {
  readonly requestId?: string;
  readonly workerId?: string;
  readonly gatewayId?: string;
  readonly commandId?: string;
  readonly taskId?: string;
  readonly updateId?: string;
  readonly outcome?: string;
  readonly statusCode?: number;
  readonly durationMs?: number;
  readonly error?: string;
  readonly [key: string]: unknown;
}

export interface StructuredLogRecord {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly service: string;
  readonly event: string;
  readonly [key: string]: unknown;
}

export type LogSink = (record: StructuredLogRecord) => void;

export interface Logger {
  info(event: string, context?: LogContext): void;
  warn(event: string, context?: LogContext): void;
  error(event: string, context?: LogContext): void;
}

const sensitiveKey = /(?:authorization|bearer|password|secret|token|private.?key)/i;

function safeValue(key: string, value: unknown): unknown {
  if (sensitiveKey.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((entry) => safeValue(key, entry));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      safeValue(childKey, childValue),
    ]),
  );
}

export function createLogger(
  service = "computercraft-agents-control-plane",
  sink: LogSink = (record) => {
    const line = JSON.stringify(record);
    if (record.level === "ERROR" || record.level === "WARN") console.error(line);
    else console.log(line);
  },
): Logger {
  const write = (level: LogLevel, event: string, context: LogContext = {}): void => {
    const record = {
      timestamp: new Date().toISOString(),
      level,
      service,
      event,
      ...Object.fromEntries(
        Object.entries(context).map(([key, value]) => [key, safeValue(key, value)]),
      ),
    } satisfies StructuredLogRecord;
    sink(record);
  };

  return {
    info: (event, context) => write("INFO", event, context),
    warn: (event, context) => write("WARN", event, context),
    error: (event, context) => write("ERROR", event, context),
  };
}

export function requestIdFromHeader(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate)) return candidate;
  return randomUUID();
}
