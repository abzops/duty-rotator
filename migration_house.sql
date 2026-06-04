-- SQL Migration to support Individual Duties (Single-Member Pairs) for House Mode
-- Copy and run this in your Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)

-- 1. Make member2_id nullable so a "pair" can consist of just 1 person
ALTER TABLE public.pairs ALTER COLUMN member2_id DROP NOT NULL;

-- 2. Drop the old check constraint
ALTER TABLE public.pairs DROP CONSTRAINT IF EXISTS members_different;

-- 3. Re-add check constraint that allows member2_id to be NULL, but requires them to be different if both are set
ALTER TABLE public.pairs
  ADD CONSTRAINT members_different CHECK (member2_id IS NULL OR member1_id <> member2_id);
