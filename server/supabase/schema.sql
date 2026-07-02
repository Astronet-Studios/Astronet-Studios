create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text,
  company_name text,
  role text not null default 'client' check (role in ('client', 'admin')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.client_accounts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  website_url text,
  website_status text not null default 'active' check (website_status in ('active', 'maintenance', 'offline')),
  subscription_plan text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.client_accounts (id) on delete cascade,
  invoice_number text not null unique,
  description text,
  site_type text,
  extra_pages_count integer not null default 0,
  extra_pages_type text,
  extra_features_count integer not null default 0,
  extra_features_type text,
  line_items jsonb not null default '[]'::jsonb,
  subtotal_dollars numeric(10,2),
  tax_dollars numeric(10,2) not null default 0,
  total_dollars numeric(10,2),
  amount_dollars numeric(10,2) not null check (amount_dollars > 0),
  currency text not null default 'USD',
  status text not null default 'unpaid' check (status in ('draft', 'unpaid', 'paid', 'overdue')),
  due_date date,
  square_payment_link_id text,
  square_payment_link_url text,
  issued_at timestamptz not null default timezone('utc', now()),
  paid_at timestamptz
);

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.client_accounts (id) on delete cascade,
  contract_number text not null unique,
  project_title text not null,
  site_type text,
  timeline text,
  total_cost_dollars numeric(10,2) not null check (total_cost_dollars > 0),
  deductible_percent numeric(5,2) not null default 25,
  deductible_due_dollars numeric(10,2) not null check (deductible_due_dollars >= 0),
  remaining_balance_dollars numeric(10,2) not null check (remaining_balance_dollars >= 0),
  terms_text text,
  status text not null default 'sent' check (status in ('draft', 'sent', 'signed', 'cancelled')),
  esign_provider text,
  esign_signature_request_id text unique,
  esign_status text,
  esign_signed_file_url text,
  esign_last_event_at timestamptz,
  signed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.invoices add column if not exists site_type text;
alter table public.invoices add column if not exists extra_pages_count integer not null default 0;
alter table public.invoices add column if not exists extra_pages_type text;
alter table public.invoices add column if not exists extra_features_count integer not null default 0;
alter table public.invoices add column if not exists extra_features_type text;
alter table public.invoices add column if not exists line_items jsonb not null default '[]'::jsonb;
alter table public.invoices add column if not exists subtotal_dollars numeric(10,2);
alter table public.invoices add column if not exists tax_dollars numeric(10,2) not null default 0;
alter table public.invoices add column if not exists total_dollars numeric(10,2);
alter table public.contracts add column if not exists esign_provider text;
alter table public.contracts add column if not exists esign_signature_request_id text;
alter table public.contracts add column if not exists esign_status text;
alter table public.contracts add column if not exists esign_signed_file_url text;
alter table public.contracts add column if not exists esign_last_event_at timestamptz;
create unique index if not exists contracts_esign_signature_request_id_idx
on public.contracts (esign_signature_request_id)
where esign_signature_request_id is not null;

create table if not exists public.change_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.client_accounts (id) on delete cascade,
  title text not null,
  description text not null,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status text not null default 'submitted' check (status in ('submitted', 'reviewing', 'in_progress', 'completed')),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.support_questions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.client_accounts (id) on delete cascade,
  subject text not null,
  message text not null,
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.subscription_change_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.client_accounts (id) on delete cascade,
  current_plan text,
  requested_plan text not null,
  notes text,
  status text not null default 'submitted' check (status in ('submitted', 'reviewing', 'approved', 'declined')),
  created_at timestamptz not null default timezone('utc', now())
);

create or replace function public.set_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_profiles_timestamp on public.profiles;
create trigger set_profiles_timestamp
before update on public.profiles
for each row
execute procedure public.set_timestamp();

drop trigger if exists set_client_accounts_timestamp on public.client_accounts;
create trigger set_client_accounts_timestamp
before update on public.client_accounts
for each row
execute procedure public.set_timestamp();

alter table public.profiles enable row level security;
alter table public.client_accounts enable row level security;
alter table public.invoices enable row level security;
alter table public.contracts enable row level security;
alter table public.change_requests enable row level security;
alter table public.support_questions enable row level security;
alter table public.subscription_change_requests enable row level security;

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
on public.profiles
for select
using (auth.uid() = id);

drop policy if exists "Users can view own account" on public.client_accounts;
create policy "Users can view own account"
on public.client_accounts
for select
using (auth.uid() = profile_id);

drop policy if exists "Users can view own invoices" on public.invoices;
create policy "Users can view own invoices"
on public.invoices
for select
using (
  exists (
    select 1
    from public.client_accounts
    where client_accounts.id = invoices.client_id
      and client_accounts.profile_id = auth.uid()
  )
);

drop policy if exists "Users can view own contracts" on public.contracts;
create policy "Users can view own contracts"
on public.contracts
for select
using (
  exists (
    select 1
    from public.client_accounts
    where client_accounts.id = contracts.client_id
      and client_accounts.profile_id = auth.uid()
  )
);