-- Migration: Add SUPERADMIN role and ensure index
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check 
  CHECK (role IN ('SUPERADMIN', 'ADMIN', 'USER'));

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
