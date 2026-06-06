-- Add human-readable project name to project_shares so recipients
-- see a meaningful label in their "Shared with me" list instead of raw PIDs.
alter table public.project_shares add column if not exists name text;
