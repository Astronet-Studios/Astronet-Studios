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
  amount_dollars numeric(10,2) not null check (amount_dollars > 0),
  currency text not null default 'USD',
  status text not null default 'unpaid' check (status in ('draft', 'unpaid', 'paid', 'overdue')),
  due_date date,
  square_payment_link_id text,
  square_payment_link_url text,
  issued_at timestamptz not null default timezone('utc', now()),
  paid_at timestamptz
);

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