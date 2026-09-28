-- /try: one row per visitor session and scene, so a scene is never run twice (refresh-safe).
CREATE TABLE IF NOT EXISTS demo_sessions (
  session TEXT NOT NULL,
  scene TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session, scene)
);
