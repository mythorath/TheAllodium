-- Funders are unused by scoring and public routes. Drop rather than ship
-- an empty family with invented provenance. Re-add via a later migration
-- if a funder signal is ever built.
DROP INDEX IF EXISTS idx_oa_funders_name;
DROP INDEX IF EXISTS idx_oa_funders_ror;
DROP TABLE IF EXISTS oa_funders;
