# F2 — Calibration recorded

**Trigger**: Dataverse row added, table `eng_calibrationrecord`.

**Inputs**: the new calibration record and the asset it references.

**Writes**: `eng_asset.eng_lastcaldate`, `eng_nextcaldue`; if the asset was `InCalibration`, a new
`eng_transaction` (`ReturnFromCalibration`) + line, which F1 then processes like any other
transaction.

**Failure mode**: retries transient failures (exponential ×4); posts to `AMS-Alerts` on terminal
failure. If step 2 fails after step 1 succeeded, the asset's calibration dates are already correct
and only the return-from-lab transaction is missing — F5's reprocessing sweep does not cover this
(it only reprocesses `eng_transactionline`, not missing calibration-triggered transactions), so a
terminal failure here should page a human, not just log quietly. Recorded as a known gap for the
real implementation.

**Equivalent in this build**: `app/src/api/mock/index.ts`'s `recordCalibration()`, tested by
`app/tests/api/mockBackend.test.ts`'s "MockAmsBackend — calibration" suite (prefill-from-interval,
future-date refusal, and the automatic return-from-calibration all pass today).
