/**
 * Application entry - and, since WS-W6, the offline runtime's boot point.
 *
 * THE ORDER OF THE THREE STATEMENTS BELOW IS LOAD-BEARING.
 *
 *   `guardOfflineQueueBoot()` runs first and synchronously. `api/queue`'s engine hydrates from
 *   localStorage inside its constructor, and the first component that renders can trigger that, so
 *   the check for "does this queue belong to whoever is signed in now" has to have already
 *   happened by the time React starts. It is a few localStorage reads; it costs nothing and it is
 *   the only thing standing between a shared site phone and one technician replaying another's
 *   check-out. See offline/identity.ts.
 *
 *   `render()` runs second, so the first paint is not waiting on IndexedDB.
 *
 *   `startOfflineRuntime()` runs third and unawaited. It opens the partition database, makes the
 *   queued commands durable, installs the replay coordinator and registers the service worker.
 *   None of it can fail the app: it returns a degraded runtime instead of throwing (see its
 *   header), so a browser with storage disabled gets today's online-only behaviour.
 *
 * The worker is not registered under `vite dev`: a service worker holding an app shell fights hot
 * module replacement, and the thing being developed is never the worker. `vite preview` and any
 * real build register it, which is where the cold-start and update behaviour is actually tested.
 */
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { guardOfflineQueueBoot, startOfflineRuntime } from "./offline";

guardOfflineQueueBoot();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

void startOfflineRuntime({ registerWorker: import.meta.env.PROD }).catch((error) => {
  // Belt and braces: startOfflineRuntime already swallows its own failures, so reaching here means
  // something changed. The app keeps running online-only either way.
  console.warn("offline: runtime did not start", error);
});
