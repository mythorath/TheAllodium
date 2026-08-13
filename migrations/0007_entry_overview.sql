-- Contract v1.2: LLM-generated plain-language overview on public entries.
-- Migrations are append-only: 0001–0006 already applied to real
-- staging/production D1 stay untouched.
--
-- `overview` is a machine paraphrase written offline in ACT
-- (scripts/generate_overviews.py). Verbatim abstracts remain forbidden
-- and are never written to this column.

ALTER TABLE entries ADD COLUMN overview TEXT;
