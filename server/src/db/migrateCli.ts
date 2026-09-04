/**
 * `db:migrate` / `db:check` as a command, so migrating is not something that only happens as a
 * side effect of starting the server.
 *
 * CLAUDE.md's target command list names `npm run db:migrate` and `npm run db:check`. Both live
 * here rather than as an inline `tsx -e` in package.json, because a deploy step that a human has
 * to read should be a file with a header, and because `--check` needs to exit non-zero on drift
 * for CI to mean anything.
 *
 *   npx tsx src/db/migrateCli.ts            apply everything pending
 *   npx tsx src/db/migrateCli.ts --check    report only; writes nothing, not even the ledger
 *
 * Exit codes: 0 up to date or applied; 1 drift or pending work under --check; 2 the run failed.
 * `--check` treating PENDING as a failure is deliberate — its job is to answer "is this database
 * what this code expects?", and "no, it is eight migrations behind" is a no.
 *
 * Honours the same AMS_DB / AMS_DATABASE_URL / AMS_DATA_DIR environment as the server, so it acts
 * on whichever database the server would have opened.
 */
import { DB_DIR } from "../config";
import { checkMigrations, migrate } from "./migrate";
import { openDatabase } from "./open";

const checkOnly = process.argv.includes("--check");

const db = await openDatabase({ dir: DB_DIR, migrate: false });
try {
  if (checkOnly) {
    const status = await checkMigrations(db);
    console.log(`driver=${db.driver} initialised=${status.initialised} applied=${status.applied.length} pending=${status.pending.length}`);
    for (const p of status.pending) console.log(`  pending  ${p.filename}`);
    for (const d of status.drift) console.log(`  DRIFT    ${String(d.version).padStart(4, "0")}_${d.name} [${d.kind}] ${d.detail}`);
    if (status.drift.length > 0 || status.pending.length > 0) process.exit(1);
    console.log("up to date");
  } else {
    const result = await migrate(db);
    for (const f of result.applied) console.log(`  applied  ${f}`);
    console.log(result.upToDate ? `up to date (${result.alreadyApplied} already applied)` : `applied ${result.applied.length}`);
  }
} catch (err) {
  console.error((err as Error).message);
  process.exit(2);
} finally {
  await db.close();
}
