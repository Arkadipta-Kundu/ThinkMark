create table if not exists public.notes (
  code varchar(5) primary key,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notes enable row level security;

-- No public RLS policies are created.
-- The browser cannot access this table directly.
-- Cloudflare Pages Functions use the Supabase secret key server-side.
