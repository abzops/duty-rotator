-- SQL Migration to adapt Supabase schema for Firebase Auth
-- Copy and run this in your Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)

-- 1. Drop Row Level Security policies first (so we can alter column types)
DROP POLICY IF EXISTS "Allow public read of profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow users to insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Allow users to update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Allow admins to update any profile" ON public.profiles;
DROP POLICY IF EXISTS "Allow users to delete their own profile" ON public.profiles;

DROP POLICY IF EXISTS "Allow read of pairs" ON public.pairs;
DROP POLICY IF EXISTS "Allow admins to manage pairs" ON public.pairs;

DROP POLICY IF EXISTS "Allow read of duties" ON public.duties;
DROP POLICY IF EXISTS "Allow users to update completion status" ON public.duties;
DROP POLICY IF EXISTS "Allow admins to manage all duties" ON public.duties;

-- 2. Drop dependent check constraints on pairs table
ALTER TABLE public.pairs DROP CONSTRAINT IF EXISTS members_different;

-- 3. Drop foreign key constraints on dependent tables
ALTER TABLE public.pairs DROP CONSTRAINT IF EXISTS pairs_member1_id_fkey;
ALTER TABLE public.pairs DROP CONSTRAINT IF EXISTS pairs_member2_id_fkey;
ALTER TABLE public.duties DROP CONSTRAINT IF EXISTS duties_completed_by_fkey;

-- 4. Drop the profiles table's foreign key constraint to auth.users
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- 5. Change types of id columns from UUID to TEXT to accept Firebase UIDs
ALTER TABLE public.profiles ALTER COLUMN id TYPE text;
ALTER TABLE public.pairs ALTER COLUMN member1_id TYPE text;
ALTER TABLE public.pairs ALTER COLUMN member2_id TYPE text;
ALTER TABLE public.duties ALTER COLUMN completed_by TYPE text;

-- 6. Re-add foreign key constraints using the new text columns
ALTER TABLE public.pairs
  ADD CONSTRAINT pairs_member1_id_fkey FOREIGN KEY (member1_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.pairs
  ADD CONSTRAINT pairs_member2_id_fkey FOREIGN KEY (member2_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.duties
  ADD CONSTRAINT duties_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 7. Re-add check constraint on pairs table
ALTER TABLE public.pairs
  ADD CONSTRAINT members_different CHECK (member1_id <> member2_id);

-- 8. Disable Row Level Security (RLS) since Firebase handles auth now
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.pairs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.duties DISABLE ROW LEVEL SECURITY;
