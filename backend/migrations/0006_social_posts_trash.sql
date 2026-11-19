CREATE TABLE IF NOT EXISTS social_posts (
  id TEXT PRIMARY KEY,
  author_uid TEXT NOT NULL,
  body TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'friends')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deletion_status TEXT NOT NULL DEFAULT 'active' CHECK (deletion_status IN ('active', 'trashed')),
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS social_posts_author ON social_posts(author_uid, created_at);
CREATE INDEX IF NOT EXISTS social_posts_visibility ON social_posts(visibility, created_at);
