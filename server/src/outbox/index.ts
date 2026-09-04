/**
 * The outbox lane's public surface, and the one function that assembles a working worker.
 *
 * A caller outside this directory should need exactly two things: `enqueue(tx, event)` on the
 * write path, and `createOutboxWorker(db)` on the read path. Everything else — the claim SQL,
 * the lease, the backoff curve, the dead-letter transition, the adapters — is an implementation
 * detail of this lane and is free to change behind these two names.
 *
 * `createOutboxWorker` is composition, not policy: it wires the log-only Teams/email adapters
 * (CLAUDE.md — Microsoft 365 is an integration surface, never a runtime dependency) and a
 * composite alert sink that writes a durable `operational_alert` row AND logs. Swapping in a
 * Graph adapter is one argument, and nothing else in the server changes.
 */
export { ensureOutboxSchema, OUTBOX_SCHEMA_SQL } from "./schema";
export {
  enqueue,
  envelopeFromRow,
  getEvent,
  listEventsForAggregate,
  transactionAcceptedEvent,
  type OutboxRow,
} from "./enqueue";
export type {
  CalibrationCertificateMissingPayload,
  NotificationPayload,
  OutboxAggregateType,
  OutboxEnvelope,
  OutboxEventInput,
  OutboxEventType,
  OutboxPayload,
  ReconciliationRequestedPayload,
  ReturnOverduePayload,
  TransactionAcceptedPayload,
} from "./types";
export {
  boundMessage,
  FailingNotificationAdapter,
  LogNotificationAdapter,
  NOTIFICATION_LIMITS,
  resolveOfficeRecipients,
  type NotificationAdapter,
  type NotificationChannel,
  type NotificationMessage,
} from "./notifications";
export {
  alertOwner,
  checkOutboxBacklog,
  CompositeAlertSink,
  DatabaseAlertSink,
  DEFAULT_BACKLOG_THRESHOLD_MS,
  listOpenAlerts,
  LoggingAlertSink,
  raiseBacklogAlertIfBreached,
  RecordingAlertSink,
  type AlertSink,
  type BacklogStatus,
  type OperationalAlert,
} from "./alerts";
export { OutboxWorker, type OutboxHandler, type OutboxHandlerContext, type TickResult, type WorkerLog } from "./worker";
export { defaultHandlers, type HandlerDependencies } from "./handlers";
export {
  CADENCE,
  claimNotificationSlot,
  clearSuppression,
  readSuppression,
  type SuppressionState,
} from "./suppression";
export {
  JobScheduler,
  type ReconciliationProbe,
  type SchedulerOptions,
  type SchedulerTick,
} from "./scheduler";
export {
  findCertificateGaps,
  findOverdueReturns,
  publishReconciliationResult,
  runCertificateGapJob,
  runOverdueReturnJob,
  type JobResult,
  type ReconciliationCounts,
} from "./jobs";

import type { Database } from "../db/database";
import { CompositeAlertSink, DatabaseAlertSink, LoggingAlertSink, type AlertSink } from "./alerts";
import { defaultHandlers, type HandlerDependencies } from "./handlers";
import { LogNotificationAdapter, type NotificationAdapter } from "./notifications";
import { OutboxWorker, type OutboxHandler, type OutboxWorkerOptions, type WorkerLog } from "./worker";

export interface CreateWorkerOptions extends Omit<OutboxWorkerOptions, "handlers" | "alerts"> {
  teams?: NotificationAdapter;
  email?: NotificationAdapter;
  alerts?: AlertSink;
  /** Extra consumers, registered alongside the defaults; a matching key replaces a default. */
  handlers?: Record<string, OutboxHandler>;
}

export function createOutboxWorker(db: Database, options: CreateWorkerOptions = {}): OutboxWorker {
  const log: WorkerLog = options.log ?? (() => {});
  const alerts =
    options.alerts ?? new CompositeAlertSink([new DatabaseAlertSink(db), new LoggingAlertSink((p, m) => log(p, m))]);
  const deps: HandlerDependencies = {
    teams: options.teams ?? new LogNotificationAdapter(log),
    email: options.email ?? new LogNotificationAdapter(log),
    alerts,
  };
  return new OutboxWorker(db, {
    ...options,
    alerts,
    log,
    handlers: { ...defaultHandlers(deps), ...(options.handlers ?? {}) },
  });
}
