-- Cleanup script to remove old "insufficient data" annotations
-- This can be run manually to clean up existing annotations

DELETE FROM public.annotations 
WHERE annotation_text LIKE '%insufficient data%' 
   OR (statistics->'trend'->>'type') = 'insufficient_data';


