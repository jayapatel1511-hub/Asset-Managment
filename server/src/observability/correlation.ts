/**
 * Request-scoped correlation IDs (FR-046 / health-and-read + error-codes contracts).
 *
 * Fastify already mints `req.id`. This module is the policy for *which* id: honour a caller-supplied
 * `x-correlation-id` / `x-request-id` or a W3C `traceparent` trace-id when they look like tokens,
 * otherwise a UUID. The value is a log/trace join key, never a security claim.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const CORRELATION_HEADER = "x-correlation-id";

const SAFE_TOKEN = /^[\w.:-]{8,128}$/;
const TRACEPARENT = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/i;

function headerValue(headers: IncomingMessage["headers"], name: string): string | undefined {
  const raw = headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

export function correlationIdFromHeaders(headers: IncomingMessage["headers"]): string {
  const incoming = headerValue(headers, CORRELATION_HEADER) ?? headerValue(headers, "x-request-id");
  if (incoming && SAFE_TOKEN.test(incoming)) return incoming;
  const traceparent = headerValue(headers, "traceparent");
  const match = traceparent?.match(TRACEPARENT);
  if (match) return match[1];
  return randomUUID();
}
