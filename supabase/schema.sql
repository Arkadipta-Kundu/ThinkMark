create table if not exists public.notes (
  code varchar(4) primary key check (code ~ '^[a-z0-9]{4}$'),
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notes enable row level security;

-- No public RLS policies are created.
-- The browser cannot access this table directly.
-- Cloudflare Pages Functions use the Supabase secret key server-side.
