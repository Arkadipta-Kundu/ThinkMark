alter table public.notes
add column if not exists tags jsonb not null default '[]'::jsonb;
