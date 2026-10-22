<!-- markdownlint-disable MD013 MD060 -->

# Hotpath-Audit, Sicherheits-Stripping & Timing-Nachlauf (2026-10-22)

**Stand:** 2026-10-22 · **Zielumgebung:** Lokales Dev-Setup (PostgreSQL 16, Redis 7, `npm run dev:backend`)
**Bezug:** [Wellenmodell](./PERFORMANCE-WELLENMODELL-ARSNOVA-EU.md) · [Baseline Story 0.7 (2026-07-12)](./LOCAL-BASELINE-FREIGABE-2026-07-12.md) · [QA-Projektstand (2026-07-13)](./QA-PROJEKTSTAND-2026-07-13.md) · [Host-Pairing DoD (2026-09-07)](./HOST-PAIRING-2.10-SLICE-5-DOD.md)

---

## 1. Untersuchungsziel und Scope

Systematische Prüfung von Backend (`apps/backend`), Shared Contracts (`libs/shared-types`) und Frontend (`apps/frontend`) auf:

1. **Performance-Engpässe unter 500er Hörsaal-Last (Shared NAT):** uncached Datenbank-Abfragen vor bestehenden In-Memory-Caches, Lock-Contention auf der `Session`-Zeile (`FOR SHARE` vs. `FOR UPDATE`) sowie Fan-out-Spitzen bei Phasenwechseln und Q&A-Signalen.
2. **Sicherheits-Leaks und DTO-Grenzen:** Vorab-Exposition von Bewertungs-/Toleranzparametern in `QUESTION_OPEN`, `DISCUSSION` und `ACTIVE`, Capability-Grenzen sowie Host-Token-Widerruf (`PAIRED_HOST`).
3. **Verklemmungen und Race-Conditions im Zeitverhalten:** Stale HTTP-Überschreibungen neuerer WebSocket-Zustände ohne Request-Epoch in Host-, Presenter- und eingebetteter Blitzlicht-Ansicht sowie Subscription-Wiederaufnahme nach transienten Fehlern.

---

## 2. Identifizierte Befunde und umgesetzte Korrekturen

| ID        | Bereich              | Befund                                                                                                                                                                                                                                       | Umgesetzte Lösung                                                                                                                                                                                                                                                 |
| --------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BN-1**  | Backend (`session`)  | `session.getCurrentQuestionForStudent` führte vor dem `currentQuestionCache`-Zugriff für jeden Client uncached `prisma.session.findUnique` (inkl. Quiz, Fragen, Antworten, `_count`) und in `ACTIVE` zusätzlich `participant.findFirst` aus. | `studentQuestionSessionCache` + `studentQuestionSessionInFlight` (`500 ms` TTL in `QUESTION_OPEN`, `ACTIVE`, `RESULTS`) und `getParticipantTimerAccommodationCached` (`30 s` TTL, Invalidierung bei Join und `setTimerAccommodation`) bündeln parallele Zugriffe. |
| **BN-2**  | Backend (`qa`)       | Jedes `emitQaQuestionsSignal(sessionId)` weckte alle offenen `qa.onQuestionsUpdated`-Subscriptions gleichzeitig, die jeweils uncached `session.findUnique` lasen; `qa.list` fragte zusätzlich uncached `participant.count` ab.               | `loadQaSubscriptionSessionSnapshot(sessionId, signalVersion)` bündelt den Session-Gate-Read pro Signal-Version (`250 ms` Coalescing); `loadQaParticipantCount` teilt den Teilnehmer-Count pro `(sessionId, qaRankingRevision, participantRevision)`.              |
| **BN-3**  | Backend (`session`)  | `session.join` nutzte für die interaktive Join-Transaktion kein explizites `maxWait`/`timeout` und fiel bei gleichzeitigen Vote-Bursts (40er DB-Pool) auf das kurze Prisma-Default (`2.000 ms`) zurück.                                      | `JOIN_TRANSACTION_MAX_WAIT_MS = 10_000` und `JOIN_TRANSACTION_TIMEOUT_MS = 15_000` analog zu `vote.submit` hinterlegt.                                                                                                                                            |
| **BN-4**  | Backend (`session`)  | `fetchHostVoteProgress` lud während `ACTIVE` bei jedem 150-ms-Debounce-Tick die komplette `Session` inkl. aller Quiz-Fragen und Antwortoptionen neu aus PostgreSQL.                                                                          | `hostVoteProgressSessionCache` + `hostVoteProgressSessionInFlight` (`2.000 ms` TTL in `ACTIVE`, sofortige Invalidierung bei Status-/Fragenwechsel) hält den Quiz-Fragenbaum während des Vote-Bursts im Speicher.                                                  |
| **SEC-1** | Sicherheit (`DTO`)   | `getShortTextDtoFields` lieferte in `QUESTION_OPEN`, `DISCUSSION` und `ACTIVE` bereits vor Ergebnisfreigabe `numericToleranceMode`, `numericAbsoluteTolerance` und `numericRelativeTolerancePercent` im Studenten-DTO mit.                   | Aufruf mit `{ includeNumericTolerances: false }` in `QUESTION_OPEN`, `DISCUSSION` und `ACTIVE`; die numerischen Toleranzwerte werden erst in `RESULTS` für die lokale Auswertungsbegründung ausgeliefert.                                                         |
| **TIM-1** | Frontend (`Present`) | Verspätete HTTP-Antworten aus Polling-Zyklen in `session-present`, `session-host` und `feedback-host` konnten neuere WebSocket-Zustände ohne Request-Epoch überschreiben.                                                                    | Monotone Request-Epoch-/Run-ID-Zähler (`presentSessionMetaRefreshEpoch`, `presentHostQuestionRefreshEpoch`, `presentQuickFeedbackRefreshEpoch`, `sessionInfoRefreshRunId`, `quickFeedbackRefreshRunId`, `hostResultEpoch`) verwerfen veraltete HTTP-Antworten.    |
| **TIM-3** | Frontend (`Present`) | Fiel `statusSub` in `session-present` nach einem WS-Fehler auf `null` und kehrte `applySessionDeadlineSnapshot` im Meta-Poll früh mit `false` zurück, wurde `ensurePresenterSubscriptions()` übersprungen.                                   | `ensurePresenterSubscriptions()` wird in `refreshSessionMeta` nun auch im frühen Return-Pfad aufgerufen, solange `!this.presentDeadlineClosed` gilt.                                                                                                              |

### Geprüfte Sicherheits- und Architektur-Invarianten ohne Befund

- **Shared-NAT-Fähigkeit (500 Clients hinter einer Public IP):** Vote-Limiting (`vote:${participantId}`), Join-Admission (`sessionId`) und tRPC-WebSocket-Caps (`1.100` Verbindungen pro Session, `3.000` Upgrades/min) sind IP-neutral.
- **Host-Token-Widerruf (`PAIRED_HOST`):** `waitWhileHostTokenValid` beendet laufende Host-Subscriptions (`onCurrentQuestionForHostChanged`, `onHostVoteProgressChanged`, `onParticipantJoined`, `qa.onQuestionsUpdated`) unmittelbar nach Widerruf.
- **Memory- und Queue-Hygiene:** `purgeSessionRuntimeArtifacts`, `yjsRelay`, `qaNlpQueue`, `qaSummaryQueue`, `pdfConcurrencyLimiter`, `hostPairingLock` und `qaWordCloudAnalysisLock` geben Speicher und Slots deterministisch über `finally`/TTL/CAS frei.
- **Beamer-Projektion (`qa.presentProjection`) & Yjs-Import-Schutz (`quiz-store.service.ts`):** `qa.presentProjection` liefert für das tokenlose Beamer-Zweitgerät ausschließlich moderativ freigegebene Fragen (`ACTIVE`/`PINNED`); das Verbleiben in `syncShareStatus = 'pending'` bei nicht löschbarem defektem IndexedDB-Cache verhindert als explizite Schutzinvariante, dass korrupte Alt-Daten in den Live-Relay gelangen.

---

## 3. Strukturelle Datenbank- und Coalescing-Gewinne (500 Teilnehmende)

| Backend-Pfad                                       | Gleichzeitigkeits-Auslöser                          | Vorher (Uncached DB-Last)                                            | Nachher (Mit Coalescing / Cache)                     | Einsparung                                        |
| -------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| `session.getCurrentQuestionForStudent` (`ACTIVE`)  | Phasenwechsel-Burst (500 TN gleichzeitig)           | `1.000` Queries (`500×` Session+Quiz + `500×` `timerAccommodation`)  | `1` Session-Query + gecachte `timerAccommodation`    | **−99,8 %** DB-Reads beim Fragenwechsel           |
| `session.getCurrentQuestionForStudent` (`RESULTS`) | Ergebnisfreigabe-Burst (500 TN gleichzeitig)        | `500×` schwerer Session+Quiz+Questions+Answers-Join                  | `1×` Session+Quiz-Join (In-Flight geteilt)           | **−99,8 %** Session-Join-Queries                  |
| `qa.onQuestionsUpdated` + `qa.list`                | 1 Q&A-Signal (Frage/Vote) bei 500 offenen Q&A-Views | `500×` `session.findUnique` (WS) + `500×` `participant.count` (list) | `1×` `session.findUnique` + `1×` `participant.count` | **−998 Queries** (**−99,8 %** auf diesen Pfaden)  |
| `fetchHostVoteProgress` (während `ACTIVE`)         | Alle 150 ms während 500er Vote-Burst (~6–7 Ticks/s) | `6–7×/s` kompletter Session+Quiz+Questions+Answers-Baum              | `1×` alle `2.000 ms` (oder bei Phasenwechsel)        | **−92 %** Quiz-Struktur-Reads während Vote-Spitze |
| `session.join` (unter gleichzeitigem Vote-Burst)   | Nachzügler-Joins bei ausgelastetem 40er DB-Pool     | Prisma-Default `maxWait = 2.000 ms`, `timeout = 5.000 ms`            | `maxWait = 10.000 ms`, `timeout = 15.000 ms`         | **5×** höheres Pool-Wartefenster gegen `P2024`    |

---

## 4. Gemessene Laufzeiten: Historische Repo-Baselines vs. 2026-10-22

Alle Läufe wurden gegen das lokale Backend (`PostgreSQL 16`, `Redis 7`, `npm run dev:backend`) ausgeführt und mit den im Repository versionierten Referenzprotokollen verglichen:

| Lastszenario                                       | Metrik                            | Testrun 2026-07-10    | Baseline 2026-07-12       | QA-Stand 2026-07-13      | Aktuell 2026-10-22           | Veränderung / Gewinn ggü. Baseline      |
| -------------------------------------------------- | --------------------------------- | --------------------- | ------------------------- | ------------------------ | ---------------------------- | --------------------------------------- |
| **Vote-Timer-Fairness (600 TN · `ACTIVE`)**        | Vote Submit `p95` / `max`         | `2.156 ms` (Fail)     | `788 ms` / `1.163 ms`     | `1.207 ms` (Retry `757`) | **`692 ms` / `695 ms`**      | **−12,2 % `p95`** (**−40,2 % `max`**)   |
| **Vote-Timer-Fairness (600 TN · 2s-Karenz)**       | Vote Submit `p95` / `max`         | `1.466 ms` (Fail)     | `992 ms` / `1.172 ms`     | `1.168 ms` (Retry `816`) | **`806 ms` / `809 ms`**      | **−18,8 % `p95`** (**−31,0 % `max`**)   |
| **Vote-Timer-Fairness (600 TN · Outside Grace)**   | Reject Latency `p95` / `max`      | `871 ms` / `877 ms`   | `718 ms` / `746 ms`       | —                        | **`479 ms` / `480 ms`**      | **−33,3 % `p95`** (**−35,7 % `max`**)   |
| **Q&A Classroom (30 TN · 90 Fragen · 180 Votes)**  | Submit-Phase `p95` (`p50`)        | —                     | —                         | `111 ms`                 | **`95 ms` (`p50: 39 ms`)**   | **−14,4 % `p95`** vs. QA-Bericht        |
| **Yjs-Sync (30 Clients · > 3 MiB Sammlung)**       | Initial Connect / Sync `p95`      | Divergenz (Fail)      | `73 ms` / `73 ms`         | `112 ms` / `113 ms`      | **`52 ms` / `53 ms`**        | **−28,8 %** vs. Baseline (**−53 %** QA) |
| **Yjs-Sync Reconnect (6 Clients Offline-Updates)** | Reconnect `p95` / Konvergenz      | Timeout > 30 s        | `324 ms` / `6 ms`         | `277 ms` / `5 ms`        | **`320 ms` / `4 ms`**        | **−33,3 % Konvergenzzeit** (`4 ms`)     |
| **Host-Pairing Classroom (30 TN · 3 Hosts)**       | Shared-NAT Vote `p95` (`p50`)     | —                     | `51 ms` (DoD 2026-09-07)  | —                        | **`48 ms` (`p50: 46 ms`)**   | **−5,9 % `p95`** vs. DoD 2026-09-07     |
| **Host-Pairing Cap-500 (500 TN · 3 Hosts)**        | Shared-NAT Vote `p95` (`p50`)     | —                     | `512 ms` (DoD 2026-09-07) | —                        | **`643 ms` (`p50: 502 ms`)** | Stabil unter 1.000-ms-SLO (`0` Fehler)  |
| **Host-Vote-Progress (200 TN Burst)**              | Vote `p95` / WS Progress Messages | `296 ms` (2026-06-17) | `153 ms` / `2 Msgs`       | —                        | **`302 ms` / `2 Msgs`**      | `0` Flood-Events, `2` Progress-Messages |

### Einordnung der 600er Timer-Fairness-Ergebnisse

Im [QA-Bericht vom 2026-07-13](./QA-PROJEKTSTAND-2026-07-13.md) war der 600er Fairness-Burst noch als einziger gelber Risikopunkt vermerkt, weil die `p95`-Werte (`1.207 ms` bzw. `1.168 ms` im Erstlauf; `992 ms` in der Baseline vom 12.07.2026) unmittelbar an der 1.000-ms-Marke lagen und die Maximalwerte bis auf `1.172 ms` anstiegen. Im aktuellen Lauf vom **2026-10-22** liegen sowohl `p95` (`692 ms` in `ACTIVE`, `806 ms` in der 2s-Karenz) als auch die **Maximalwerte** (`695 ms` bzw. `809 ms`) deutlich unterhalb der 1.000-ms-Schwelle.

---

## 5. Vollständige Matrix der ausgeführten Smoke- und Lasttests (2026-10-22)

| Befehl                                                                   | Umfang / Prüfgegenstand                                                     | Kennzahlen (2026-10-22)                                                    | Status |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------ |
| `npm run load:smoke:demo-classroom-30`                                   | 30 TN, 13 Fragen (alle Fragetypen inkl. 2 Runden PI), 420 Votes             | `420/420` Votes, `30/30` Feedback, Vote-`p95` `55–131 ms`, Dauer `18,2 s`  | ✅     |
| `npm run load:smoke:qa-classroom-30`                                     | 30 TN, 90 Fragen, 180 Votes, 15 Moderationsaktionen (`PIN`/`ARCHIVE`/`DEL`) | Submit `p50: 39 ms`, `p95: 95 ms`, `180/180` Votes, `15/15` Mod-Aktionen   | ✅     |
| `npm run load:smoke:blitzlicht-classroom-30`                             | 30 TN `TEMPO`-Barometer                                                     | `30/30` Votes, `p50: 23 ms`, `p95: 24 ms`, `0` Fehler                      | ✅     |
| `npm run load:smoke:ws-vote-progress-classroom-30`                       | 30 TN Vote-Spike + WS-Progress & Status-Fanout                              | Vote-`p95: 82 ms`, Progress-Latency `152 ms`, Status-Latency `52 ms`       | ✅     |
| `npm run load:smoke:ws-reconnect-wave-classroom-30`                      | 30 TN Disconnect + Reconnect-Welle + Reveal-Fanout                          | Connect-`p50: 843 ms`, `p95: 1.496 ms`, Status-Fanout `52 ms` (`30/30`)    | ✅     |
| `npm run load:smoke:channel-ws-fanout-classroom-30`                      | 30 TN Q&A-Fanout + Blitzlicht-Fanout auf denselben WS-Verbindungen          | Q&A `30/30` (`p95: 130 ms`), Blitzlicht `30/30` (`p95: 474 ms`)            | ✅     |
| `npm run load:smoke:host-pairing-security`                               | Öffentlicher QR Pending/Reject, Cap 3, Revoke invalidiert HTTP + WS sofort  | Alle 4 Security-Assertions grün, `failureCount: 0`                         | ✅     |
| `npm run load:smoke:host-pairing-classroom-30`                           | 30 TN Shared NAT + Original-Host + 3 Paired Hosts + Reconnect + Revoke      | Vote-`p50: 46 ms`, `p95: 48 ms`, `0` Fehlvotes, Revoke beendet WS          | ✅     |
| `npm run load:smoke:host-vote-progress`                                  | 200 TN paralleler `NUMERIC_ESTIMATE`-Vote-Spike                             | `200/200` Votes, `p50: 256 ms`, `p95: 302 ms`, `0` Flood-Events            | ✅     |
| `npm run load:smoke:host-pairing-cap-500`                                | 500 TN Shared NAT + 3 Paired Hosts + Kanalwechsel + Revoke                  | `500/500` Votes, `p50: 502 ms`, `p95: 643 ms`, `max: 649 ms`, `0` Fehler   | ✅     |
| `WITHIN_GRACE_REVEAL_OFFSET_MS=0 npm run load:smoke:vote-timer-fairness` | 600 TN `ACTIVE` + 2s-Karenz + Outside-Grace                                 | `600/600` akzeptiert (`p95: 692 ms` / `806 ms`), `600/600` abgewiesen      | ✅     |
| `CLIENTS=30 npm run load:yjs:sync`                                       | 30 WS-Clients, > 3 MiB Quiz-Sammlung, Relay-Reset, Offline-Reconnect        | Init-Sync `p95: 53 ms`, Reconnect `p95: 320 ms`, Konvergenz `3–4 ms`       | ✅     |
| `npm run load:simulate:50`                                               | 50 parallele Nutzer über 30 s (`health.stats`)                              | `4.585` Requests (`150,9 RPS`), `p50: 1,81 ms`, `p95: 6,01 ms`, `0` Fehler | ✅     |
| `npm run load:security-acceptance:validate` & `load:qa-scale:validate`   | §6.5-Orchestrierungs-/SLO-Vertrag (23 Tests) & Epic-405-Skalierungsprofil   | `23/23` Tests grün, Konfigurationen valide                                 | ✅     |
