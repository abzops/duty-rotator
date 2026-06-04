-- SQL Migration: Add 6-digit pin code support
-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pin_code text;
