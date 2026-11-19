CREATE TABLE IF NOT EXISTS profile_photos (
  uid TEXT PRIMARY KEY NOT NULL REFERENCES registered_users(uid) ON DELETE CASCADE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  image_data BLOB NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0 AND size <= 262144),
  updated_at INTEGER NOT NULL
);
