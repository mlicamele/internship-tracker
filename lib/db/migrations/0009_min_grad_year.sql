-- Migration 0009: add min_grad_year alongside max_grad_year
--
-- max_grad_year alone confuses two distinct constraints:
--   - "Graduating Dec 2027 or later" → minimum bound (excludes already-graduated)
--   - "Graduating by Spring 2028"      → maximum bound (excludes too-early-in-degree)
--   - "Class of 2028 or 2029 only"     → both bounds
--
-- User is eligible iff (min IS NULL OR user.grad_year >= min)
--                   AND (max IS NULL OR user.grad_year <= max)

ALTER TABLE roles ADD COLUMN min_grad_year INTEGER;
