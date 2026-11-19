ALTER TABLE registered_users ADD COLUMN pip_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE registered_users ADD COLUMN notes_status TEXT NOT NULL DEFAULT 'pending';
CREATE INDEX IF NOT EXISTS registered_users_application_status
  ON registered_users(pip_status, notes_status);
UPDATE registered_users
SET pip_status = 'active',
    notes_status = 'active'
WHERE status = 'active';
