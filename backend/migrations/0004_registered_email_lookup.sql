ALTER TABLE registered_users ADD COLUMN email_digest TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS registered_users_email_digest
  ON registered_users(email_digest) WHERE email_digest IS NOT NULL;
