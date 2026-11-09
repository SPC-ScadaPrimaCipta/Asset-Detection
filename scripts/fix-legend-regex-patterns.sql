-- Fix regex tag patterns in existing legend symbols
-- Replace complex regex patterns with simple P-### format or NULL

-- Control Valve: ^(CV|FCV|FV|HV|LCV|...) → CV-###
UPDATE legend_symbols
SET tag_pattern = 'CV-###'
WHERE tag_pattern LIKE '^(CV%'
  AND asset_type = 'Control Valve';

-- Instrument (generic): ^(FI|PT|TT|...) → NULL (too many variants)
UPDATE legend_symbols
SET tag_pattern = NULL
WHERE tag_pattern LIKE '^(FI%'
  OR tag_pattern LIKE '^(PI%'
  OR tag_pattern LIKE '^(PT%'
  OR tag_pattern LIKE '^(TT%'
  AND asset_type = 'Instrument';

-- Filter: ^(FI|FT|FILTER) → FI-###
UPDATE legend_symbols
SET tag_pattern = 'FI-###'
WHERE tag_pattern LIKE '^(FI%'
  AND asset_type = 'Filter';

-- Generic cleanup: any pattern with regex chars → NULL
UPDATE legend_symbols
SET tag_pattern = NULL
WHERE tag_pattern ~ '[\^\$\(\)\|\\\[\]]'
  AND tag_pattern IS NOT NULL;

-- Show results
SELECT asset_type, symbol_name, tag_pattern, COUNT(*) as cnt
FROM legend_symbols
WHERE legend_id IN (
  SELECT id FROM legends WHERE status = 'ACTIVE'
)
GROUP BY asset_type, symbol_name, tag_pattern
ORDER BY asset_type, symbol_name;
