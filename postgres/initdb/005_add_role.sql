-- Add role column to users table
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS role varchar(50) DEFAULT 'student';
