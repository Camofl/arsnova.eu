-- Distinguish Q&A forum assignments from session learning objectives.
-- Existing rows stay LEARNING_OBJECTIVE; no heuristic backfill from SESSION_MANUAL.

CREATE TYPE "LearningObjectivePurpose" AS ENUM (
  'LEARNING_OBJECTIVE',
  'FORUM_ASSIGNMENT'
);

ALTER TABLE "SessionLearningObjective"
  ADD COLUMN "purpose" "LearningObjectivePurpose" NOT NULL DEFAULT 'LEARNING_OBJECTIVE';

ALTER TABLE "SessionLearningObjective"
  ADD CONSTRAINT "SessionLearningObjective_purpose_check"
  CHECK (
    "purpose" <> 'FORUM_ASSIGNMENT'
    OR (
      "origin" = 'MANUAL'
      AND "scope" = 'SESSION'
      AND "projection" = 'SESSION_MANUAL'
    )
  );

CREATE INDEX "SessionLearningObjective_sessionId_purpose_idx"
  ON "SessionLearningObjective"("sessionId", "purpose");
