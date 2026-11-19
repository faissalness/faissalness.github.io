CREATE TABLE IF NOT EXISTS registered_users (
  uid TEXT PRIMARY KEY,
  registered_at INTEGER NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'scheduled')),
  deletion_at INTEGER
);

CREATE TABLE IF NOT EXISTS pal_invitations (
  id TEXT PRIMARY KEY,
  email_digest TEXT NOT NULL,
  inviter_uid TEXT NOT NULL,
  inviter_name TEXT NOT NULL DEFAULT '',
  recipient_uid TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pal_invites_recipient ON pal_invitations(email_digest, status);
CREATE INDEX IF NOT EXISTS pal_invites_sender ON pal_invitations(inviter_uid, status);
CREATE INDEX IF NOT EXISTS pal_invites_sender_recent ON pal_invitations(inviter_uid, created_at);

CREATE TABLE IF NOT EXISTS pals (
  uid_low TEXT NOT NULL,
  uid_high TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (uid_low, uid_high),
  CHECK (uid_low < uid_high)
);

CREATE TABLE IF NOT EXISTS pip_messages (
  id TEXT PRIMARY KEY,
  sender_uid TEXT NOT NULL,
  recipient_uid TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS pip_messages_thread ON pip_messages(sender_uid, recipient_uid, created_at);
CREATE INDEX IF NOT EXISTS pip_messages_unread ON pip_messages(recipient_uid, read_at);
CREATE INDEX IF NOT EXISTS pip_messages_sender_recent ON pip_messages(sender_uid, created_at);
