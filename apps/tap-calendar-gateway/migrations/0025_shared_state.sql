CREATE TABLE miniapp_shared_state (
  owner TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK(revision > 0),
  value_json TEXT NOT NULL CHECK(json_valid(value_json))
);
