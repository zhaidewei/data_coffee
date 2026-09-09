-- Version all existing legacy activity aggregates. A malformed JSON document
-- makes the migration fail; an explicit unsupported version remains untouched
-- and will be rejected by the application decoder.
UPDATE activities
SET document = json_set(document, '$.schemaVersion', 1)
WHERE json_type(document) = 'object'
  AND (json_type(document, '$.schemaVersion') IS NULL
    OR (json_type(document, '$.schemaVersion') IN ('integer', 'real')
      AND json_extract(document, '$.schemaVersion') = 0));
