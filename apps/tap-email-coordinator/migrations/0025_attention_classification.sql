-- Tighten the stored Critical and Needs response flags to match
-- classifyThreadAttention in src/mailbox.ts. Bulk Gmail categories no longer
-- count as attention, and IMPORTANT only counts while the thread is unread.
-- Starred threads stay critical. The sender-based "automated" check needs
-- message headers, so it applies when a thread is next synced.
UPDATE mail_threads
   SET needs_response = 0
 WHERE needs_response = 1
   AND EXISTS (
     SELECT 1 FROM json_each(mail_threads.label_ids_json) AS label
      WHERE label.value IN (
        'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS'
      )
   );

UPDATE mail_threads
   SET important = 0
 WHERE important = 1
   AND starred = 0
   AND (
     unread = 0
     OR EXISTS (
       SELECT 1 FROM json_each(mail_threads.label_ids_json) AS label
        WHERE label.value IN (
          'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS'
        )
     )
   );
