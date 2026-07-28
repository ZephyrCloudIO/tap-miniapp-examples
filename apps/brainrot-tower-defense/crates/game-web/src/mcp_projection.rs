//! Compact, versioned game-state projection consumed by the package-runtime MCP server.

use game_content::levels;
use game_protocol::{
    DefenderState, EnemyState, Member, MemberRole, RecentAction, SessionSnapshot, SessionStatus,
    TargetPolicy,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tap_bridge::BridgeError;

pub(crate) const MCP_STORAGE_NAMESPACE: &str = "brainrot-td";
pub(crate) const MCP_PROJECTION_MAX_BYTES: usize = 256 * 1024;
const MCP_PROJECTION_SCHEMA: &str = "brainrot-td.mcp.current";
const MCP_PROJECTION_VERSION: u16 = 1;
const MCP_OUTPUT_SCHEMA_VERSION: u16 = 1;
const MCP_PROJECTION_SOURCE: &str = "tap-channel-projection";
const MAX_CAS_ATTEMPTS: usize = 6;
const MAX_STORAGE_KEY_CHARS: usize = 512;

const MAX_CHANNEL_ID_BYTES: usize = 1_024;
const MAX_SESSION_ID_BYTES: usize = 512;
const MAX_GAME_NAME_BYTES: usize = 320;
const MAX_PLAYER_ID_BYTES: usize = 1_024;
const MAX_DISPLAY_NAME_BYTES: usize = 160;
const MAX_ENTITY_ID_BYTES: usize = 512;
const MAX_ENTITY_KIND_BYTES: usize = 256;
const MAX_UPGRADE_PATH_BYTES: usize = 320;
const MAX_ACTION_ACTOR_BYTES: usize = 160;
const MAX_ACTION_LABEL_BYTES: usize = 640;

pub(crate) const MAX_PROJECTED_MEMBERS: usize = 64;
pub(crate) const MAX_PROJECTED_DEFENDERS: usize = 128;
pub(crate) const MAX_PROJECTED_ENEMIES: usize = 256;
pub(crate) const MAX_PROJECTED_RECENT_ACTIONS: usize = 12;
const MEMBER_LIST_BYTE_BUDGET: usize = 40 * 1024;
const DEFENDER_LIST_BYTE_BUDGET: usize = 56 * 1024;
const ENEMY_LIST_BYTE_BUDGET: usize = 112 * 1024;
const RECENT_ACTION_LIST_BYTE_BUDGET: usize = 16 * 1024;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct McpGameStateProjection {
    projection_schema: String,
    projection_version: u16,
    projection_truncated: bool,
    schema_version: u16,
    source: String,
    session_id: String,
    channel_id: String,
    name: String,
    level: u8,
    level_name: String,
    wave: u8,
    total_waves: u32,
    status: SessionStatus,
    base_health: u16,
    score: u32,
    tick: u64,
    sequence: u64,
    active_player_count: u32,
    spectator_count: u32,
    live_presence_count: u32,
    defeated_enemies: u32,
    leaked_enemies: u16,
    pending_enemy_count: u32,
    total_member_count: u32,
    total_defender_count: u32,
    total_enemy_count: u32,
    total_recent_action_count: u32,
    members: Vec<McpMember>,
    defenders: Vec<McpDefender>,
    enemies: Vec<McpEnemy>,
    recent_actions: Vec<McpRecentAction>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct McpMember {
    player_id: String,
    display_name: String,
    role: MemberRole,
    slot: Option<u8>,
    ready: bool,
    resources: u32,
    contribution: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct McpDefender {
    id: String,
    owner_id: String,
    kind: String,
    x: u16,
    y: u16,
    level: u8,
    path: String,
    target_policy: TargetPolicy,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct McpEnemy {
    id: String,
    kind: String,
    path: u8,
    progress: u16,
    health: i32,
    max_health: i32,
    slowed_ticks: u16,
    armor: u8,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct McpRecentAction {
    sequence: u64,
    actor: String,
    label: String,
}

fn bounded_utf8(value: &str, maximum_bytes: usize) -> (String, bool) {
    if value.len() <= maximum_bytes {
        return (value.to_owned(), false);
    }
    let mut end = maximum_bytes.min(value.len());
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    (value[..end].to_owned(), true)
}

fn count_u32(value: usize) -> (u32, bool) {
    match u32::try_from(value) {
        Ok(value) => (value, false),
        Err(_) => (u32::MAX, true),
    }
}

fn collect_bounded<Source, Item, Project>(
    source: &[Source],
    maximum_items: usize,
    maximum_bytes: usize,
    mut project: Project,
) -> (Vec<Item>, bool)
where
    Item: Serialize,
    Project: FnMut(&Source) -> (Item, bool),
{
    let mut items = Vec::with_capacity(source.len().min(maximum_items));
    let mut encoded_bytes = 0_usize;
    let mut truncated = source.len() > maximum_items;
    for source_item in source.iter().take(maximum_items) {
        let (item, item_truncated) = project(source_item);
        let item_bytes = serde_json::to_vec(&item).map_or(usize::MAX, |encoded| encoded.len());
        let separator_bytes = usize::from(!items.is_empty());
        if encoded_bytes
            .checked_add(item_bytes)
            .and_then(|bytes| bytes.checked_add(separator_bytes))
            .is_none_or(|bytes| bytes > maximum_bytes)
        {
            truncated = true;
            break;
        }
        encoded_bytes += item_bytes + separator_bytes;
        truncated |= item_truncated;
        items.push(item);
    }
    truncated |= items.len() < source.len();
    (items, truncated)
}

fn project_member(member: &Member) -> (McpMember, bool) {
    let (player_id, player_id_truncated) = bounded_utf8(&member.player_id.0, MAX_PLAYER_ID_BYTES);
    let (display_name, display_name_truncated) =
        bounded_utf8(&member.display_name, MAX_DISPLAY_NAME_BYTES);
    (
        McpMember {
            player_id,
            display_name,
            role: member.role,
            slot: member.slot,
            ready: member.ready,
            resources: member.resources,
            contribution: member.contribution,
        },
        player_id_truncated || display_name_truncated,
    )
}

fn project_defender(defender: &DefenderState) -> (McpDefender, bool) {
    let (id, id_truncated) = bounded_utf8(&defender.id.0, MAX_ENTITY_ID_BYTES);
    let (owner_id, owner_id_truncated) = bounded_utf8(&defender.owner.0, MAX_PLAYER_ID_BYTES);
    let (kind, kind_truncated) = bounded_utf8(&defender.kind, MAX_ENTITY_KIND_BYTES);
    let (path, path_truncated) = bounded_utf8(&defender.path, MAX_UPGRADE_PATH_BYTES);
    (
        McpDefender {
            id,
            owner_id,
            kind,
            x: defender.x,
            y: defender.y,
            level: defender.level,
            path,
            target_policy: defender.target_policy,
        },
        id_truncated || owner_id_truncated || kind_truncated || path_truncated,
    )
}

fn project_enemy(enemy: &EnemyState) -> (McpEnemy, bool) {
    let (id, id_truncated) = bounded_utf8(&enemy.id.0, MAX_ENTITY_ID_BYTES);
    let (kind, kind_truncated) = bounded_utf8(&enemy.kind, MAX_ENTITY_KIND_BYTES);
    (
        McpEnemy {
            id,
            kind,
            path: enemy.path,
            progress: enemy.progress,
            health: enemy.health,
            max_health: enemy.max_health,
            slowed_ticks: enemy.slowed_ticks,
            armor: enemy.armor,
        },
        id_truncated || kind_truncated,
    )
}

fn project_recent_action(action: &RecentAction) -> (McpRecentAction, bool) {
    let (actor, actor_truncated) = bounded_utf8(&action.actor, MAX_ACTION_ACTOR_BYTES);
    let (label, label_truncated) = bounded_utf8(&action.label, MAX_ACTION_LABEL_BYTES);
    (
        McpRecentAction {
            sequence: action.sequence,
            actor,
            label,
        },
        actor_truncated || label_truncated,
    )
}

fn serialized_len(projection: &McpGameStateProjection) -> usize {
    serde_json::to_vec(projection).map_or(usize::MAX, |encoded| encoded.len())
}

fn fit_projection_to_row_budget(projection: &mut McpGameStateProjection) {
    while serialized_len(projection) > MCP_PROJECTION_MAX_BYTES {
        projection.projection_truncated = true;
        if projection.enemies.pop().is_some()
            || projection.defenders.pop().is_some()
            || projection.recent_actions.pop().is_some()
            || (projection.members.len() > 1 && projection.members.pop().is_some())
        {
            continue;
        }
        break;
    }
}

pub(crate) fn project_game_state(
    snapshot: &SessionSnapshot,
    live_presence_count: usize,
) -> McpGameStateProjection {
    // Keep the authoritative host in every bounded view even if a migrated
    // snapshot placed it after hundreds of retained spectators.
    let ordered_members: Vec<_> = snapshot
        .members
        .iter()
        .filter(|member| member.player_id == snapshot.host)
        .chain(
            snapshot
                .members
                .iter()
                .filter(|member| member.player_id != snapshot.host),
        )
        .collect();
    let (members, members_truncated) = collect_bounded(
        &ordered_members,
        MAX_PROJECTED_MEMBERS,
        MEMBER_LIST_BYTE_BUDGET,
        |member| project_member(member),
    );
    let (defenders, defenders_truncated) = collect_bounded(
        &snapshot.defenders,
        MAX_PROJECTED_DEFENDERS,
        DEFENDER_LIST_BYTE_BUDGET,
        project_defender,
    );
    let (enemies, enemies_truncated) = collect_bounded(
        &snapshot.enemies,
        MAX_PROJECTED_ENEMIES,
        ENEMY_LIST_BYTE_BUDGET,
        project_enemy,
    );
    let (recent_actions, recent_actions_truncated) = collect_bounded(
        &snapshot.recent_actions,
        MAX_PROJECTED_RECENT_ACTIONS,
        RECENT_ACTION_LIST_BYTE_BUDGET,
        project_recent_action,
    );

    let (channel_id, channel_id_truncated) =
        bounded_utf8(&snapshot.channel_id, MAX_CHANNEL_ID_BYTES);
    let (session_id, session_id_truncated) =
        bounded_utf8(&snapshot.session_id.0, MAX_SESSION_ID_BYTES);
    let (name, name_truncated) = bounded_utf8(&snapshot.name, MAX_GAME_NAME_BYTES);
    let (total_member_count, member_count_truncated) = count_u32(snapshot.members.len());
    let (total_defender_count, defender_count_truncated) = count_u32(snapshot.defenders.len());
    let (total_enemy_count, enemy_count_truncated) = count_u32(snapshot.enemies.len());
    let (total_recent_action_count, recent_action_count_truncated) =
        count_u32(snapshot.recent_actions.len());
    let (pending_enemy_count, pending_count_truncated) = count_u32(snapshot.pending_spawns.len());
    let (active_player_count, active_count_truncated) = count_u32(
        snapshot
            .members
            .iter()
            .filter(|member| matches!(member.role, MemberRole::Host | MemberRole::Player))
            .count(),
    );
    let (spectator_count, spectator_count_truncated) = count_u32(
        snapshot
            .members
            .iter()
            .filter(|member| member.role == MemberRole::Spectator)
            .count(),
    );
    let (live_presence_count, presence_count_truncated) = count_u32(live_presence_count);
    let level = levels()
        .into_iter()
        .find(|level| level.id == snapshot.level);
    let (level_name, total_waves) = level.as_ref().map_or_else(
        || ("Unknown level".to_owned(), 0),
        |level| {
            (
                level.name.to_owned(),
                u32::try_from(level.waves.len()).unwrap_or(u32::MAX),
            )
        },
    );

    let mut projection = McpGameStateProjection {
        projection_schema: MCP_PROJECTION_SCHEMA.to_owned(),
        projection_version: MCP_PROJECTION_VERSION,
        projection_truncated: members_truncated
            || defenders_truncated
            || enemies_truncated
            || recent_actions_truncated
            || channel_id_truncated
            || session_id_truncated
            || name_truncated
            || member_count_truncated
            || defender_count_truncated
            || enemy_count_truncated
            || recent_action_count_truncated
            || pending_count_truncated
            || active_count_truncated
            || spectator_count_truncated
            || presence_count_truncated,
        schema_version: MCP_OUTPUT_SCHEMA_VERSION,
        source: MCP_PROJECTION_SOURCE.to_owned(),
        session_id,
        channel_id,
        name,
        level: snapshot.level,
        level_name,
        wave: snapshot.wave,
        total_waves,
        status: snapshot.status,
        base_health: snapshot.base_health,
        score: snapshot.score,
        tick: snapshot.tick,
        sequence: snapshot.last_sequence,
        active_player_count,
        spectator_count,
        live_presence_count,
        defeated_enemies: snapshot.defeated_enemies,
        leaked_enemies: snapshot.leaked_enemies,
        pending_enemy_count,
        total_member_count,
        total_defender_count,
        total_enemy_count,
        total_recent_action_count,
        members,
        defenders,
        enemies,
        recent_actions,
    };
    fit_projection_to_row_budget(&mut projection);
    projection
}

fn valid_projection_for_channel(
    value: &Value,
    expected_channel_id: &str,
) -> Option<McpGameStateProjection> {
    let current = serde_json::from_value::<McpGameStateProjection>(value.clone()).ok()?;
    (current.projection_schema == MCP_PROJECTION_SCHEMA
        && current.projection_version == MCP_PROJECTION_VERSION
        && current.schema_version == MCP_OUTPUT_SCHEMA_VERSION
        && current.source == MCP_PROJECTION_SOURCE
        && current.channel_id == expected_channel_id
        && serialized_len(&current) <= MCP_PROJECTION_MAX_BYTES)
        .then_some(current)
}

fn should_replace_projection(current: Option<&Value>, candidate: &McpGameStateProjection) -> bool {
    let Some(current) =
        current.and_then(|value| valid_projection_for_channel(value, &candidate.channel_id))
    else {
        // Missing, malformed, or older envelopes are migrated by replacing them
        // under the revision observed by the caller.
        return true;
    };
    if current.session_id != candidate.session_id {
        return true;
    }
    let current_position = (current.sequence, current.tick);
    let candidate_position = (candidate.sequence, candidate.tick);
    candidate_position > current_position
        || (candidate_position == current_position && current != *candidate)
}

fn should_delete_projection(
    current: &Value,
    channel_id: &str,
    expected_session_id: Option<&str>,
) -> bool {
    let Some(expected_session_id) = expected_session_id else {
        return true;
    };
    valid_projection_for_channel(current, channel_id)
        .is_none_or(|projection| projection.session_id == expected_session_id)
}

fn validate_storage_segment(value: &str, label: &str) -> Result<(), BridgeError> {
    if value.is_empty()
        || value.trim() != value
        || value.chars().count() > 256
        || value.chars().any(char::is_control)
        || value.contains(['/', '\\'])
    {
        return Err(BridgeError::Invalid(format!(
            "invalid {label} for MCP projection storage"
        )));
    }
    Ok(())
}

pub(crate) fn projection_storage_key(
    user_id: &str,
    channel_id: &str,
) -> Result<String, BridgeError> {
    validate_storage_segment(user_id, "user")?;
    validate_storage_segment(channel_id, "channel")?;
    let key = format!("mcp/users/{user_id}/channels/{channel_id}/current");
    if key.chars().count() > MAX_STORAGE_KEY_CHARS {
        return Err(BridgeError::Invalid(
            "MCP projection storage key exceeds 512 characters".into(),
        ));
    }
    Ok(key)
}

/// Saves one user's current active session projection with optimistic concurrency.
///
/// Same-session candidates older than the stored `(sequence, tick)` are ignored.
/// Malformed and older projection envelopes are replaced under compare-and-set,
/// so the first successful write migrates the row without touching gameplay storage.
pub(crate) async fn save_current_projection(
    user_id: &str,
    snapshot: &SessionSnapshot,
    live_presence_count: usize,
) -> Result<(), BridgeError> {
    let key = projection_storage_key(user_id, &snapshot.channel_id)?;
    let candidate = project_game_state(snapshot, live_presence_count);
    if serialized_len(&candidate) > MCP_PROJECTION_MAX_BYTES {
        return Err(BridgeError::Invalid(
            "MCP projection exceeds its bounded storage budget".into(),
        ));
    }

    for _ in 0..MAX_CAS_ATTEMPTS {
        let stored = tap_bridge::get::<Value>(MCP_STORAGE_NAMESPACE, &key).await?;
        if !should_replace_projection(stored.value.as_ref(), &candidate) {
            return Ok(());
        }
        match tap_bridge::set(MCP_STORAGE_NAMESPACE, &key, &candidate, stored.revision).await {
            Ok(_) => return Ok(()),
            Err(BridgeError::Conflict) => {}
            Err(error) => return Err(error),
        }
    }
    Err(BridgeError::Conflict)
}

/// Deletes a no-longer-active projection under compare-and-set.
///
/// When `expected_session_id` is present, a concurrently published projection
/// for another active session is retained.
pub(crate) async fn clear_current_projection(
    user_id: &str,
    channel_id: &str,
    expected_session_id: Option<&str>,
) -> Result<(), BridgeError> {
    let key = projection_storage_key(user_id, channel_id)?;
    for _ in 0..MAX_CAS_ATTEMPTS {
        let stored = tap_bridge::get::<Value>(MCP_STORAGE_NAMESPACE, &key).await?;
        let Some(current) = stored.value.as_ref() else {
            return Ok(());
        };
        if !should_delete_projection(current, channel_id, expected_session_id) {
            return Ok(());
        }
        let revision = stored.revision.ok_or_else(|| {
            BridgeError::Invalid("MCP projection storage row has no revision".into())
        })?;
        match tap_bridge::delete(MCP_STORAGE_NAMESPACE, &key, revision).await {
            Ok(()) => return Ok(()),
            Err(BridgeError::Conflict) => {}
            Err(error) => return Err(error),
        }
    }
    Err(BridgeError::Conflict)
}

#[cfg(test)]
mod tests {
    use super::*;
    use game_core::Simulation;
    use game_protocol::{EntityId, PlayerId, SessionId};

    fn fixture() -> SessionSnapshot {
        let player = PlayerId("player-1".into());
        let mut snapshot = Simulation::create(
            "channel-1".into(),
            "Defense".into(),
            player.clone(),
            "Player One".into(),
            7,
        )
        .state;
        snapshot.session_id = SessionId("session-1".into());
        snapshot.status = SessionStatus::Running;
        snapshot.wave = 2;
        snapshot.tick = 42;
        snapshot.last_sequence = 9;
        snapshot.defenders.push(DefenderState {
            id: EntityId("defender-1".into()),
            owner: player,
            kind: "zip_zapper".into(),
            x: 120,
            y: 220,
            level: 2,
            path: "Overclock".into(),
            cooldown_ticks: 0,
            target_policy: TargetPolicy::Strong,
        });
        snapshot.enemies.push(EnemyState {
            id: EntityId("enemy-1".into()),
            kind: "basic".into(),
            path: 0,
            progress: 240,
            health: 35,
            max_health: 60,
            slowed_ticks: 2,
            control_resistance_ticks: 0,
            armor: 1,
            reward: 5,
            leak_damage: 1,
        });
        snapshot.recent_actions.push(RecentAction {
            sequence: 9,
            actor: "Player One".into(),
            label: "placed Zip Zapper".into(),
        });
        snapshot
    }

    #[test]
    fn projection_serializes_with_explicit_versions_and_camel_case_output_fields() {
        let projection = project_game_state(&fixture(), 3);
        let encoded = serde_json::to_vec(&projection).expect("serialize projection");
        let value: Value = serde_json::from_slice(&encoded).expect("parse projection");

        assert_eq!(value["projectionSchema"], MCP_PROJECTION_SCHEMA);
        assert_eq!(value["projectionVersion"], MCP_PROJECTION_VERSION);
        assert_eq!(value["schemaVersion"], MCP_OUTPUT_SCHEMA_VERSION);
        assert_eq!(value["source"], MCP_PROJECTION_SOURCE);
        assert_eq!(value["sessionId"], "session-1");
        assert_eq!(value["channelId"], "channel-1");
        assert_eq!(value["sequence"], 9);
        assert_eq!(value["livePresenceCount"], 3);
        assert_eq!(value["defenders"][0]["ownerId"], "player-1");
        assert_eq!(value["defenders"][0]["targetPolicy"], "strong");
        assert_eq!(value["enemies"][0]["maxHealth"], 60);
        assert_eq!(value["totalMemberCount"], 1);
        assert_eq!(value["totalDefenderCount"], 1);
        assert_eq!(value["totalEnemyCount"], 1);
        assert_eq!(value["totalRecentActionCount"], 1);
        assert!(!value["projectionTruncated"].as_bool().unwrap_or(true));
        assert!(encoded.len() <= MCP_PROJECTION_MAX_BYTES);
        assert_eq!(
            serde_json::from_slice::<McpGameStateProjection>(&encoded)
                .expect("round-trip projection"),
            projection
        );
    }

    #[test]
    fn projection_is_deterministic_and_bounded_for_oversized_gameplay_collections() {
        let mut snapshot = fixture();
        let oversized_id = "🧠".repeat(400);
        for index in 0..600 {
            snapshot.members.push(Member {
                player_id: PlayerId(format!("{oversized_id}-{index:04}")),
                display_name: "Spectator".repeat(40),
                role: MemberRole::Spectator,
                slot: None,
                ready: false,
                resources: u32::MAX,
                contribution: u32::MAX,
            });
            snapshot.defenders.push(DefenderState {
                id: EntityId(format!("{oversized_id}-defender-{index:04}")),
                owner: PlayerId(format!("{oversized_id}-owner-{index:04}")),
                kind: "kind".repeat(100),
                x: u16::MAX,
                y: u16::MAX,
                level: u8::MAX,
                path: "path".repeat(100),
                cooldown_ticks: 0,
                target_policy: TargetPolicy::Fast,
            });
            snapshot.enemies.push(EnemyState {
                id: EntityId(format!("{oversized_id}-enemy-{index:04}")),
                kind: "enemy".repeat(100),
                path: u8::MAX,
                progress: u16::MAX,
                health: i32::MIN,
                max_health: i32::MAX,
                slowed_ticks: u16::MAX,
                control_resistance_ticks: 0,
                armor: u8::MAX,
                reward: u32::MAX,
                leak_damage: u16::MAX,
            });
            snapshot.recent_actions.push(RecentAction {
                sequence: 9,
                actor: "actor".repeat(100),
                label: "label".repeat(200),
            });
        }

        let first = project_game_state(&snapshot, usize::MAX);
        let second = project_game_state(&snapshot, usize::MAX);
        let first_bytes = serde_json::to_vec(&first).expect("serialize first projection");
        let second_bytes = serde_json::to_vec(&second).expect("serialize second projection");

        assert_eq!(first_bytes, second_bytes);
        assert!(first.projection_truncated);
        assert_eq!(first.total_member_count, 601);
        assert_eq!(first.total_defender_count, 601);
        assert_eq!(first.total_enemy_count, 601);
        assert_eq!(first.total_recent_action_count, 601);
        assert!(first.members.len() <= MAX_PROJECTED_MEMBERS);
        assert!(first.defenders.len() <= MAX_PROJECTED_DEFENDERS);
        assert!(first.enemies.len() <= MAX_PROJECTED_ENEMIES);
        assert!(first.recent_actions.len() <= MAX_PROJECTED_RECENT_ACTIONS);
        assert!(first_bytes.len() <= MCP_PROJECTION_MAX_BYTES);
        assert_eq!(first.live_presence_count, u32::MAX);
    }

    #[test]
    fn bounded_member_projection_always_retains_the_authoritative_host() {
        let mut snapshot = fixture();
        let host = snapshot.members.remove(0);
        for index in 0..100 {
            snapshot.members.push(Member {
                player_id: PlayerId(format!("spectator-{index:03}")),
                display_name: format!("Spectator {index}"),
                role: MemberRole::Spectator,
                slot: None,
                ready: false,
                resources: 0,
                contribution: 0,
            });
        }
        snapshot.members.push(host);

        let projection = project_game_state(&snapshot, 0);

        assert!(projection.projection_truncated);
        assert_eq!(projection.total_member_count, 101);
        assert_eq!(projection.members.len(), MAX_PROJECTED_MEMBERS);
        assert_eq!(projection.members[0].role, MemberRole::Host);
        assert_eq!(projection.members[0].player_id, snapshot.host.0);
        assert_eq!(
            projection
                .members
                .iter()
                .filter(|member| member.role == MemberRole::Host)
                .count(),
            1
        );
    }

    #[test]
    fn projection_replacement_migrates_old_or_malformed_rows_and_rejects_stale_writes() {
        let mut snapshot = fixture();
        let candidate = project_game_state(&snapshot, 1);
        let legacy = serde_json::json!({
            "projectionSchema": MCP_PROJECTION_SCHEMA,
            "projectionVersion": 0,
            "sessionId": "session-1",
            "sequence": 99,
            "tick": 99
        });
        assert!(should_replace_projection(Some(&legacy), &candidate));
        assert!(should_replace_projection(
            Some(&serde_json::json!({"not": "a projection"})),
            &candidate
        ));

        let current = serde_json::to_value(&candidate).expect("encode current");
        assert!(!should_replace_projection(Some(&current), &candidate));

        snapshot.tick += 1;
        let newer = project_game_state(&snapshot, 1);
        assert!(should_replace_projection(Some(&current), &newer));
        assert!(!should_replace_projection(
            Some(&serde_json::to_value(&newer).expect("encode newer")),
            &candidate
        ));

        snapshot.session_id = SessionId("session-2".into());
        let different_active_session = project_game_state(&snapshot, 1);
        assert!(should_replace_projection(
            Some(&current),
            &different_active_session
        ));
    }

    #[test]
    fn projection_storage_key_is_user_and_channel_scoped_and_path_safe() {
        assert_eq!(
            projection_storage_key("user-1", "channel-1").expect("valid key"),
            "mcp/users/user-1/channels/channel-1/current"
        );
        assert!(projection_storage_key("user/escape", "channel-1").is_err());
        assert!(projection_storage_key("user-1", "channel/escape").is_err());
        assert!(projection_storage_key(" user-1 ", "channel-1").is_err());
        assert!(projection_storage_key("user-1", "").is_err());
        assert!(projection_storage_key(&"u".repeat(256), &"c".repeat(256)).is_err());
    }

    #[test]
    fn cleanup_deletes_only_the_expected_stale_session_projection() {
        let mut snapshot = fixture();
        let current = serde_json::to_value(project_game_state(&snapshot, 0))
            .expect("encode current projection");

        assert!(should_delete_projection(
            &current,
            "channel-1",
            Some("session-1")
        ));
        assert!(!should_delete_projection(
            &current,
            "channel-1",
            Some("session-2")
        ));
        assert!(should_delete_projection(&current, "channel-1", None));

        snapshot.channel_id = "channel-2".into();
        let other_channel = serde_json::to_value(project_game_state(&snapshot, 0))
            .expect("encode other-channel projection");
        assert!(should_delete_projection(
            &other_channel,
            "channel-1",
            Some("session-1")
        ));
        assert!(should_delete_projection(
            &serde_json::json!({"projectionVersion": 0}),
            "channel-1",
            Some("session-1")
        ));
    }
}
