CREATE INDEX IF NOT EXISTS pal_invites_sender_recent ON pal_invitations(inviter_uid, created_at);
CREATE INDEX IF NOT EXISTS pip_messages_sender_recent ON pip_messages(sender_uid, created_at);
