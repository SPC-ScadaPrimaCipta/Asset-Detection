-- Migration 009: runtime tuning knobs stored in settings.
--
-- Additive only, idempotent, no data deleted.
--
-- Rationale: every operational value (thresholds, timeouts, retry policy, region
-- grid, generation parameters) must be changeable without editing code. Rather
-- than add ~40 columns, tuning overrides live in one JSONB document on the
-- existing single-row `settings` table.
--
-- Precedence, implemented in lib/tuning.ts:
--     settings.tuning (DB)  >  .env.local  >  literal fallback in code
--
-- `{}` means "no override" and is equivalent to the row not existing, so an
-- untouched deployment behaves exactly as before.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='settings' AND column_name='tuning'
  ) THEN
    ALTER TABLE settings
      ADD COLUMN tuning JSONB NOT NULL DEFAULT '{}'::jsonb;
    RAISE NOTICE 'Added settings.tuning';
  END IF;
END $$;

-- Documented key space. Kept in the DB as documentation only — validation and
-- merging live in lib/tuning.ts so a bad or unknown key can never reach code.
COMMENT ON COLUMN settings.tuning IS
  'Runtime tuning overrides. JSON object, partial. Precedence: DB > .env > code fallback. '
  'Keys mirror lib/tuning.ts: generation{}, regions{}, detection{}, validator{}, '
  'fusion{}, performance{}, crop{}, legend{}, embedding{}, model{}.';
