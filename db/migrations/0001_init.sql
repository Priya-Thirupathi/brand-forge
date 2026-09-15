-- Stage 1 schema. See TRD.md §4 for the full data model and rationale.
-- Conventions: RLS enabled with no policies on every table (server connects with the
-- superuser-equivalent DATABASE_URL, so RLS here is a deliberate second gate against a
-- future public/anon key on Supabase, not a functional access-control layer yet);
-- uuid pk via gen_random_uuid() (built into Postgres 16, no extension needed);
-- created_at defaults now().

create table categories (
  slug text primary key,
  display_name text not null,
  keywords text[] not null,
  sort_order smallint not null
);
alter table categories enable row level security;

create table feasibility_options (
  id uuid primary key default gen_random_uuid(),
  category text not null references categories (slug),
  material text not null,
  material_terms text[] not null,
  cost_low numeric(10, 2) not null,
  cost_high numeric(10, 2) not null,
  currency char(3) not null default 'USD',
  moq int not null,
  lead_time_days_low int not null,
  lead_time_days_high int not null,
  assumptions text not null,
  is_default bool not null default false,
  constraint feasibility_options_cost_range check (cost_low <= cost_high),
  constraint feasibility_options_moq_positive check (moq > 0),
  constraint feasibility_options_lead_time_range check (lead_time_days_low <= lead_time_days_high),
  constraint feasibility_options_category_material_unique unique (category, material)
);
create unique index feasibility_options_one_default_per_category
  on feasibility_options (category) where is_default;
alter table feasibility_options enable row level security;

create table brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tone_notes jsonb not null,
  source text not null,
  hidden bool not null default false,
  created_at timestamptz not null default now(),
  constraint brands_source_check check (source in ('user', 'seed', 'eval'))
);
alter table brands enable row level security;

create table runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  idea text not null,
  category text references categories (slug),
  feasibility_option_id uuid references feasibility_options (id),
  status text not null,
  failure jsonb,
  name_candidates jsonb,
  prompt_versions jsonb not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  thinking_tokens int not null default 0,
  quality_retries int not null default 0,
  transport_retries int not null default 0,
  latency_ms int,
  first_event_ms int,
  client_ip_hash text not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint runs_source_check check (source in ('user', 'eval')),
  constraint runs_status_check check (status in ('running', 'succeeded', 'rejected', 'error'))
);
create index runs_client_ip_hash_created_at_idx on runs (client_ip_hash, created_at);
create index runs_source_created_at_idx on runs (source, created_at);
alter table runs enable row level security;

create table products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id) on delete cascade,
  run_id uuid unique references runs (id),
  category text references categories (slug),
  feasibility_option_id uuid references feasibility_options (id),
  feasibility_snapshot jsonb not null,
  idea text not null,
  tagline text not null,
  description text not null,
  packaging jsonb not null,
  source text not null,
  hidden bool not null default false,
  created_at timestamptz not null default now(),
  constraint products_source_check check (source in ('user', 'seed', 'eval'))
);
create index products_gallery_idx on products (source, hidden, category, created_at desc);
alter table products enable row level security;

create table run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs (id) on delete cascade,
  step text not null,
  attempt smallint not null,
  model text not null,
  prompt_version text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  thinking_tokens int not null default 0,
  transport_retries int not null default 0,
  latency_ms int not null,
  raw_output jsonb,
  violations jsonb not null default '[]',
  error text,
  created_at timestamptz not null default now()
);
alter table run_steps enable row level security;
