import type { PublicBookingOwnerScope } from "./public-booking-publication";

export interface PublishedBookingLink {
  readonly profileId: string;
  readonly eventTypeId: string;
  readonly title: string;
  readonly durationMinutes: number;
  readonly url: string;
  readonly revisionId: string;
  readonly generation: number;
}

/** Guest-safe, committed publication metadata only. Never reads Calendar storage
 * or event/provider data, and never requires a running Calendar surface. */
export async function listPublishedBookingLinks(
  database: D1Database,
  scope: PublicBookingOwnerScope,
): Promise<readonly PublishedBookingLink[]> {
  // Selection revalidation must observe an unpublish committed on another device.
  const result = await database.withSession("first-primary").prepare(`
    SELECT profile.source_profile_id AS profileId,
           page.source_event_type_id AS eventTypeId,
           json_extract(revision.public_snapshot_json, '$.title') AS title,
           json_extract(revision.public_snapshot_json, '$.durationMinutes') AS durationMinutes,
           page.canonical_url AS url, revision.id AS revisionId,
           profile.publication_generation AS generation
      FROM public_booking_profiles AS profile
      JOIN public_booking_pages AS page ON page.profile_id = profile.id
      JOIN public_booking_page_revisions AS revision
        ON revision.id = page.current_revision_id AND revision.page_id = page.id
      JOIN public_booking_profile_slugs AS profile_slug
        ON profile_slug.profile_id = profile.id AND profile_slug.slug = profile.current_slug
       AND profile_slug.active = 1
      JOIN public_booking_page_slugs AS page_slug
        ON page_slug.page_id = page.id AND page_slug.profile_id = profile.id
       AND page_slug.slug = page.current_slug AND page_slug.active = 1
     WHERE profile.workspace_id = ? AND profile.principal_id = ?
       AND profile.owner_kind = 'individual' AND profile.status = 'published'
       AND page.status = 'published' AND page.canonical_url IS NOT NULL
       AND profile.published_at IS NOT NULL AND page.published_at IS NOT NULL
     ORDER BY title COLLATE NOCASE, profileId, eventTypeId
     LIMIT 1000
  `).bind(scope.workspace, scope.principal).all<PublishedBookingLink>();
  return result.results;
}
