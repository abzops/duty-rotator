-- Supabase Schema for Waste Duty Rotator App

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. PROFILES TABLE
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  name text not null,
  phone text unique not null,
  workspace_association text not null check (workspace_association in ('office', 'house', 'both')),
  is_admin boolean default false not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS on profiles
alter table public.profiles enable row level security;

-- 2. PAIRS TABLE
create table public.pairs (
  id uuid default gen_random_uuid() primary key,
  workspace text not null check (workspace in ('office', 'house')),
  member1_id uuid references public.profiles(id) on delete cascade not null,
  member2_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint unique_workspace_members unique (workspace, member1_id, member2_id),
  constraint members_different check (member1_id <> member2_id)
);

-- Enable RLS on pairs
alter table public.pairs enable row level security;

-- 3. DUTIES TABLE
create table public.duties (
  id uuid default gen_random_uuid() primary key,
  workspace text not null check (workspace in ('office', 'house')),
  date date not null,
  duty_type text not null check (duty_type in ('food', 'plastic')),
  pair_id uuid references public.pairs(id) on delete set null,
  completed boolean default false not null,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_by_names text, -- Static text to preserve names if user/pair is deleted
  override_pair_id uuid references public.pairs(id) on delete set null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint unique_workspace_date_type unique (workspace, date, duty_type)
);

-- Enable RLS on duties
alter table public.duties enable row level security;

-- RLS POLICIES

-- Profiles Policies
create policy "Allow public read of profiles"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Allow users to insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

create policy "Allow users to update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Allow admins to update any profile"
  on public.profiles for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_admin = true
    )
  );

create policy "Allow users to delete their own profile"
  on public.profiles for delete
  to authenticated
  using (auth.uid() = id);

-- Pairs Policies
create policy "Allow read of pairs"
  on public.pairs for select
  to authenticated
  using (true);

create policy "Allow admins to manage pairs"
  on public.pairs for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_admin = true
    )
  );

-- Duties Policies
create policy "Allow read of duties"
  on public.duties for select
  to authenticated
  using (true);

create policy "Allow users to update completion status"
  on public.duties for update
  to authenticated
  using (true)
  with check (
    -- Allow modifying completion fields
    (completed is not null or completed_by is not null or completed_by_names is not null)
  );

create policy "Allow admins to manage all duties"
  on public.duties for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_admin = true
    )
  );

-- TRIGGER TO CREATE PROFILE ON AUTH SIGNUP (Optional safety net, but we handle it in frontend onboarding)
-- We will handle signup directly in Javascript to allow choosing name & workspace.
