CREATE INDEX mail_threads_profile_time_keyset
  ON mail_threads (profile_id, received_at DESC, account_id, thread_id);
