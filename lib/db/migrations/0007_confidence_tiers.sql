-- Migration 0007: bucket numeric extraction_confidences into high/medium/low.
--
-- LLMs don't reliably emit calibrated 0..1 numbers — they anchor to the
-- example values in the prompt and cluster at 95/80. We're switching to a
-- 3-tier enum and updating the prompt accordingly. Existing roles need
-- their numeric values bucketed:
--   ≥ 0.85 → high
--   ≥ 0.60 → medium
--   < 0.60 → low

UPDATE roles
SET extraction_confidences = (
  SELECT COALESCE(
    jsonb_object_agg(
      key,
      to_jsonb(
        CASE
          WHEN jsonb_typeof(value) = 'string' THEN value #>> '{}'  -- already a tier string, keep it
          WHEN jsonb_typeof(value) = 'number' AND (value)::text::numeric >= 0.85 THEN 'high'
          WHEN jsonb_typeof(value) = 'number' AND (value)::text::numeric >= 0.60 THEN 'medium'
          ELSE 'low'
        END
      )
    ),
    '{}'::jsonb
  )
  FROM jsonb_each(extraction_confidences)
)
WHERE extraction_confidences != '{}'::jsonb;
