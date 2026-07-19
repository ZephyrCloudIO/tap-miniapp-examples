//! Deterministic fixed-timestep cooperative tower-defense simulation.
use game_content::{
    Defender, EnemyKind, LevelUnlock, MAX_DEFENDER_LEVEL, PATH_POSITION_SCALE, Point,
    UpgradeGrowth, UpgradeMechanic, WAVE_CLEAR_BONUS, build_pads, defenders,
    enemy as enemy_definition, legacy_progress_to_arc_progress,
    legacy_school_v0_segment_position_precise, legacy_school_v1_arc_position_precise, level_scale,
    levels, nearest_route_progress, next_upgrade_tier, path_position, path_position_precise,
    scaled_build_pads, upgrade_path,
};
use game_protocol::{
    CommandAck, CommandKind, CompletionCursor, CompletionReceipt, DefenderState, EnemyState,
    EntityId, Member, MemberRole, PendingSpawn, PlayerCommand, PlayerId, ProcessedCommandReceipt,
    Progress, RecentAction, SessionId, SessionSnapshot, SessionStatus, TargetPolicy,
};
use std::collections::HashSet;
use thiserror::Error;

const SCHEMA_VERSION: u16 = 1;
const MAX_REPLAY_IDS: usize = 256;
const MAX_SESSION_MEMBERS: usize = 512;
const MAX_DISPLAY_NAME_CHARS: usize = 40;
const MOVEMENT_VERSION: u8 = 2;
const KNOCKBACK_RESISTANCE_TICKS: u16 = 90;
const BOSS_KNOCKBACK_RESISTANCE_TICKS: u16 = 120;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum GameError {
    #[error("unsupported command schema version")]
    UnsupportedSchema,
    #[error("command was already processed")]
    Duplicate,
    #[error("state changed; reload and retry")]
    Conflict,
    #[error("only the host can do that")]
    HostOnly,
    #[error("player does not occupy an active slot")]
    NotMember,
    #[error("operation is unavailable in the current state")]
    InvalidState,
    #[error("all four player slots are occupied")]
    LobbyFull,
    #[error("level or defender is locked")]
    Locked,
    #[error("choose an open build pad")]
    Placement,
    #[error("insufficient resources")]
    Resources,
    #[error("defender not found or not owned by player")]
    DefenderOwnership,
    #[error("unknown defender, upgrade, target policy, or level")]
    UnknownContent,
    #[error("defender is already fully upgraded")]
    MaxUpgrade,
    #[error("choose one upgrade path; this defender is already committed to the other path")]
    UpgradeBranch,
    #[error("display name must be 1-40 characters and cannot contain control characters")]
    InvalidDisplayName,
    #[error("session reached its spectator storage-safety limit")]
    SessionMemberLimit,
    #[error("every authored level is already complete")]
    CampaignComplete,
    #[error("this lobby reached its supported run limit; create a new game")]
    SessionRunLimit,
    #[error("this lobby reached its participant-history safety limit; create a new game")]
    SessionParticipantLimit,
}

fn completion_run_id(session_id: &SessionId, attempt: u32) -> SessionId {
    if attempt == 0 {
        session_id.clone()
    } else {
        SessionId(format!("{}#{attempt}", session_id.0))
    }
}

fn normalized_display_name(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    (!trimmed.is_empty()
        && trimmed.chars().count() <= MAX_DISPLAY_NAME_CHARS
        && trimmed.chars().all(|character| !character.is_control()))
    .then_some(trimmed)
}

fn upgrade_investment(defender: &DefenderState) -> u32 {
    let purchased_tiers = usize::from(defender.level.saturating_sub(1));
    upgrade_path(&defender.kind, &defender.path).map_or(0, |path| {
        path.tiers
            .iter()
            .take(purchased_tiers)
            .fold(0_u32, |total, tier| total.saturating_add(tier.cost))
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct EffectiveDefender {
    damage: i32,
    cooldown: u16,
    range: u16,
    splash: u16,
    slow_ticks: u16,
    armor_pierce: u8,
    income: u32,
    mechanic: Option<UpgradeMechanic>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct AttackTarget {
    index: usize,
    damage_percent: u8,
}

fn effective_defender(definition: &Defender, state: &DefenderState) -> EffectiveDefender {
    let purchased_tiers = usize::from(state.level.saturating_sub(1));
    let upgrade = (purchased_tiers > 0)
        .then(|| upgrade_path(definition.id, &state.path))
        .flatten();
    let growth = upgrade.map_or_else(UpgradeGrowth::default, |path| {
        path.tiers
            .iter()
            .take(purchased_tiers)
            .fold(UpgradeGrowth::default(), |total, tier| {
                total.saturating_add(tier.growth)
            })
    });
    let damage_percent = 100_u32.saturating_add(u32::from(growth.damage_percent));
    let scaled_damage = u32::from(definition.damage).saturating_mul(damage_percent) / 100;
    let damage = i32::try_from(scaled_damage.saturating_add(u32::from(growth.flat_damage)))
        .unwrap_or(i32::MAX);
    EffectiveDefender {
        damage,
        cooldown: definition
            .cooldown
            .saturating_sub(growth.cooldown_reduction)
            .max(2),
        range: definition.range.saturating_add(growth.range),
        splash: definition.splash.saturating_add(growth.splash),
        slow_ticks: definition.slow_ticks.saturating_add(growth.slow_ticks),
        armor_pierce: definition
            .armor_pierce
            .saturating_add(growth.armor_pierce)
            .min(100),
        income: u32::from(definition.income).saturating_add(u32::from(growth.income)),
        mechanic: upgrade
            .and_then(|path| {
                path.mechanics
                    .get(purchased_tiers.saturating_sub(1))
                    .copied()
            })
            .filter(|mechanic| *mechanic != UpgradeMechanic::None),
    }
}

fn mix_seed(mut value: u64) -> u64 {
    value = value.wrapping_add(0x9e37_79b9_7f4a_7c15);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

fn spawn_variation(seed: u64, level: u8, wave: u8, group: usize, offset: u32) -> u64 {
    mix_seed(
        seed ^ u64::from(level).wrapping_mul(0x9e37_79b9)
            ^ u64::from(wave).wrapping_mul(0x85eb_ca6b)
            ^ u64::try_from(group).unwrap_or(0).wrapping_mul(0xc2b2_ae35)
            ^ u64::from(offset).wrapping_mul(0x27d4_eb2f),
    )
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ValidationError {
    #[error("unsupported schema version")]
    UnsupportedSchema,
    #[error("record belongs to a different channel or player")]
    Scope,
    #[error("record contains an invalid level or content identifier")]
    Content,
    #[error("record contains invalid or duplicate members")]
    Members,
    #[error("record contains invalid or duplicate entities")]
    Entities,
    #[error("record exceeds supported bounds")]
    Bounds,
}

const LEGACY_BACKYARD_PADS: [Point; 9] = [
    Point { x: 450, y: 66 },
    Point { x: 470, y: 150 },
    Point { x: 252, y: 191 },
    Point { x: 627, y: 244 },
    Point { x: 212, y: 300 },
    Point { x: 384, y: 377 },
    Point { x: 529, y: 376 },
    Point { x: 680, y: 359 },
    Point { x: 605, y: 446 },
];

fn migrate_enemy_progress(level: u8, lane: u8, progress: u16, movement_version: u8) -> u16 {
    if progress >= 1000 {
        return 1000;
    }
    if level != 2 {
        return if movement_version == 0 {
            legacy_progress_to_arc_progress(level, lane, progress)
        } else {
            progress
        };
    }

    let legacy_position = match movement_version {
        0 => legacy_school_v0_segment_position_precise(lane, progress),
        1 => legacy_school_v1_arc_position_precise(lane, progress),
        _ => None,
    };
    legacy_position
        .and_then(|position| nearest_route_progress(level, lane, position))
        .map_or(progress, |(projected, _)| projected)
}

/// Migrates retired authored geometry and movement metrics before validation.
///
/// The migration is deterministic and idempotent. Active enemies retain their
/// former physical route position when segment-index progress becomes
/// arc-length progress or authored route geometry changes.
pub fn migrate_snapshot_content(snapshot: &mut SessionSnapshot) -> bool {
    if snapshot.schema_version != SCHEMA_VERSION {
        return false;
    }
    let mut changed = false;

    if snapshot.level == 1 {
        let current_pads = build_pads(1);
        for defender in &mut snapshot.defenders {
            if let Some(index) = LEGACY_BACKYARD_PADS
                .iter()
                .position(|pad| defender.x == pad.x && defender.y == pad.y)
                && let Some(current) = current_pads.get(index)
            {
                defender.x = current.x;
                defender.y = current.y;
                changed = true;
            }
        }
        for enemy in &mut snapshot.enemies {
            if enemy.path == 1 {
                enemy.path = 0;
                changed = true;
            }
        }
        for spawn in &mut snapshot.pending_spawns {
            if spawn.path == 1 {
                spawn.path = 0;
                changed = true;
            }
        }
    }

    if matches!(snapshot.movement_version, 0 | 1) {
        let movement_version = snapshot.movement_version;
        for enemy in &mut snapshot.enemies {
            enemy.progress = migrate_enemy_progress(
                snapshot.level,
                enemy.path,
                enemy.progress,
                movement_version,
            );
        }
        snapshot.movement_version = MOVEMENT_VERSION;
        changed = true;
    }
    for player_id in snapshot
        .members
        .iter()
        .filter(|member| member.slot.is_some())
        .map(|member| member.player_id.clone())
        .collect::<Vec<_>>()
    {
        if !snapshot.participant_history.contains(&player_id) {
            snapshot.participant_history.push(player_id);
            changed = true;
        }
    }
    if snapshot.status == SessionStatus::Victory {
        let run_id = completion_run_id(&snapshot.session_id, snapshot.attempt);
        if !snapshot
            .completion_receipts
            .iter()
            .any(|receipt| receipt.run_id == run_id)
        {
            snapshot.completion_receipts.push(CompletionReceipt {
                run_id,
                attempt: snapshot.attempt,
                level: snapshot.level,
                base_health: snapshot.base_health,
                score: snapshot.score,
                participants: snapshot
                    .members
                    .iter()
                    .filter(|member| member.slot.is_some())
                    .map(|member| member.player_id.clone())
                    .collect(),
            });
            if snapshot.completion_receipts.len() > MAX_REPLAY_IDS {
                snapshot.completion_receipts.remove(0);
            }
            changed = true;
        }
    }
    changed
}

/// Validates a persisted channel snapshot before it crosses into the simulation.
pub fn validate_snapshot(
    snapshot: &SessionSnapshot,
    expected_channel: &str,
) -> Result<(), ValidationError> {
    if snapshot.schema_version != SCHEMA_VERSION {
        return Err(ValidationError::UnsupportedSchema);
    }
    if snapshot.movement_version != MOVEMENT_VERSION {
        return Err(ValidationError::Content);
    }
    if expected_channel.is_empty()
        || snapshot.channel_id != expected_channel
        || snapshot.session_id.0.trim().is_empty()
    {
        return Err(ValidationError::Scope);
    }
    let level = levels()
        .into_iter()
        .find(|level| level.id == snapshot.level)
        .ok_or(ValidationError::Content)?;
    if snapshot.name.trim().is_empty()
        || snapshot.name.chars().count() > 80
        || snapshot.members.is_empty()
        || snapshot.members.len() > MAX_SESSION_MEMBERS
        || snapshot.processed_commands.len() > MAX_REPLAY_IDS
        || snapshot.processed_command_receipts.len() > MAX_REPLAY_IDS
        || snapshot.pending_events.len() > 32
        || snapshot.recent_actions.len() > 12
        || snapshot.completion_receipts.len() > MAX_REPLAY_IDS
        || snapshot.participant_history.len() > MAX_SESSION_MEMBERS
    {
        return Err(ValidationError::Bounds);
    }
    let participant_history: HashSet<_> = snapshot
        .participant_history
        .iter()
        .map(|player| player.0.as_str())
        .collect();
    if participant_history.len() != snapshot.participant_history.len()
        || participant_history
            .iter()
            .any(|player| player.trim().is_empty() || player.chars().any(char::is_control))
    {
        return Err(ValidationError::Members);
    }
    let mut players = HashSet::new();
    let mut slots = HashSet::new();
    for member in &snapshot.members {
        if member.player_id.0.trim().is_empty()
            || normalized_display_name(&member.display_name).is_none()
            || !players.insert(member.player_id.0.as_str())
            || member
                .slot
                .is_some_and(|slot| slot > 3 || !slots.insert(slot))
            || (member.slot.is_some() && !participant_history.contains(member.player_id.0.as_str()))
        {
            return Err(ValidationError::Members);
        }
        let role_is_valid = match member.role {
            MemberRole::Host => member.player_id == snapshot.host && member.slot.is_some(),
            MemberRole::Player => member.player_id != snapshot.host && member.slot.is_some(),
            MemberRole::Spectator => member.slot.is_none(),
            MemberRole::Disconnected => member.slot.is_some(),
        };
        if !role_is_valid {
            return Err(ValidationError::Members);
        }
    }
    if snapshot
        .members
        .iter()
        .filter(|member| member.role == MemberRole::Host)
        .count()
        != 1
    {
        return Err(ValidationError::Members);
    }
    let mut receipt_ids = HashSet::new();
    let mut previous_receipt_attempt = None;
    let current_participants: HashSet<_> = snapshot
        .members
        .iter()
        .filter(|member| member.slot.is_some())
        .map(|member| member.player_id.0.as_str())
        .collect();
    let mut has_current_victory_receipt = false;
    for receipt in &snapshot.completion_receipts {
        let Some(receipt_level) = levels()
            .into_iter()
            .find(|candidate| candidate.id == receipt.level)
        else {
            return Err(ValidationError::Content);
        };
        let participant_ids: HashSet<_> = receipt
            .participants
            .iter()
            .map(|player| player.0.as_str())
            .collect();
        if receipt.run_id != completion_run_id(&snapshot.session_id, receipt.attempt)
            || receipt.attempt > snapshot.attempt
            || !receipt_ids.insert(receipt.run_id.0.as_str())
            || previous_receipt_attempt.is_some_and(|previous| receipt.attempt <= previous)
            || receipt.base_health == 0
            || receipt.base_health > receipt_level.base_health
            || receipt.participants.is_empty()
            || receipt.participants.len() > 4
            || participant_ids.len() != receipt.participants.len()
            || participant_ids
                .iter()
                .any(|player| player.trim().is_empty())
            || participant_ids
                .iter()
                .any(|player| !participant_history.contains(player))
        {
            return Err(ValidationError::Entities);
        }
        if receipt.attempt == snapshot.attempt {
            if !matches!(
                snapshot.status,
                SessionStatus::Victory | SessionStatus::Abandoned
            ) || receipt.level != snapshot.level
                || receipt.base_health != snapshot.base_health
                || receipt.score != snapshot.score
                || current_participants
                    .iter()
                    .any(|player| !participant_ids.contains(player))
            {
                return Err(ValidationError::Entities);
            }
            has_current_victory_receipt = true;
        }
        previous_receipt_attempt = Some(receipt.attempt);
    }
    if snapshot.status == SessionStatus::Victory && !has_current_victory_receipt {
        return Err(ValidationError::Entities);
    }
    let defender_ids: HashSet<_> = defenders().into_iter().map(|item| item.id).collect();
    let enemy_ids: HashSet<_> = [
        EnemyKind::Basic,
        EnemyKind::Fast,
        EnemyKind::Armored,
        EnemyKind::Swarm,
        EnemyKind::Disruption,
        EnemyKind::Boss,
    ]
    .into_iter()
    .map(EnemyKind::id)
    .collect();
    let mut entity_ids = HashSet::new();
    let mut occupied = HashSet::new();
    for defender in &snapshot.defenders {
        let path_is_valid = if defender.level == 1 {
            defender.path == "base"
        } else {
            upgrade_path(&defender.kind, &defender.path).is_some()
        };
        if defender.id.0.trim().is_empty()
            || !entity_ids.insert(defender.id.0.as_str())
            || !players.contains(defender.owner.0.as_str())
            || !defender_ids.contains(defender.kind.as_str())
            || !level.available_defenders.contains(&defender.kind.as_str())
            || !(1..=MAX_DEFENDER_LEVEL).contains(&defender.level)
            || !path_is_valid
            || !scaled_build_pads(snapshot.level, usize::from(snapshot.scale_players)).contains(
                &Point {
                    x: defender.x,
                    y: defender.y,
                },
            )
            || !occupied.insert((defender.x, defender.y))
        {
            return Err(ValidationError::Entities);
        }
    }
    if !(1..=4).contains(&snapshot.scale_players) {
        return Err(ValidationError::Bounds);
    }
    let path_count = level.scales[usize::from(snapshot.scale_players - 1)].paths;
    for enemy in &snapshot.enemies {
        if enemy.id.0.trim().is_empty()
            || !entity_ids.insert(enemy.id.0.as_str())
            || !enemy_ids.contains(enemy.kind.as_str())
            || enemy.path >= path_count
            || enemy.max_health <= 0
            || enemy.health > enemy.max_health
            || enemy.progress > 1000
            || enemy.control_resistance_ticks > BOSS_KNOCKBACK_RESISTANCE_TICKS
        {
            return Err(ValidationError::Entities);
        }
    }
    if snapshot
        .pending_spawns
        .iter()
        .any(|spawn| !enemy_ids.contains(spawn.kind.as_str()) || spawn.path >= path_count)
    {
        return Err(ValidationError::Entities);
    }
    let replay_ids: HashSet<_> = snapshot
        .processed_commands
        .iter()
        .map(|command| command.0.as_str())
        .collect();
    if replay_ids.len() != snapshot.processed_commands.len() {
        return Err(ValidationError::Entities);
    }
    let receipt_ids: HashSet<_> = snapshot
        .processed_command_receipts
        .iter()
        .map(|receipt| receipt.command_id.0.as_str())
        .collect();
    if receipt_ids.len() != snapshot.processed_command_receipts.len()
        || snapshot.processed_command_receipts.iter().any(|receipt| {
            !replay_ids.contains(receipt.command_id.0.as_str())
                || receipt.command_fingerprint.is_empty()
                || receipt.command_fingerprint.chars().count() > 1_024
                || receipt.sequence == 0
                || receipt.sequence > snapshot.last_sequence
        })
    {
        return Err(ValidationError::Entities);
    }
    let event_ids: HashSet<_> = snapshot
        .pending_events
        .iter()
        .map(|event| event.id.as_str())
        .collect();
    let allowed_events = [
        "lobby.created",
        "player.joined",
        "spectator.joined",
        "level.started",
        "wave.started",
        "level.completed",
        "level.defeated",
        "level.unlocked",
        "checkpoint.created",
    ];
    if event_ids.len() != snapshot.pending_events.len()
        || snapshot.pending_events.iter().any(|event| {
            event.id.trim().is_empty()
                || event.id.chars().count() > 256
                || !allowed_events.contains(&event.name.as_str())
        })
    {
        return Err(ValidationError::Entities);
    }
    if snapshot.recent_actions.iter().any(|action| {
        action.sequence == 0
            || action.sequence > snapshot.last_sequence
            || normalized_display_name(&action.actor).is_none()
            || action.label.trim().is_empty()
            || action.label.chars().count() > 100
            || action.label.chars().any(char::is_control)
    }) {
        return Err(ValidationError::Entities);
    }
    Ok(())
}

/// Validates user-scoped progression before it is accepted from TAP storage.
pub fn validate_progress(
    progress: &Progress,
    expected_player: &PlayerId,
) -> Result<(), ValidationError> {
    if progress.schema_version != SCHEMA_VERSION {
        return Err(ValidationError::UnsupportedSchema);
    }
    if &progress.player_id != expected_player || expected_player.0.trim().is_empty() {
        return Err(ValidationError::Scope);
    }
    if !(1..=5).contains(&progress.unlocked_level)
        || progress.best_stars.iter().any(|stars| *stars > 3)
        || progress.completed_sessions.len() > MAX_REPLAY_IDS
        || progress.completed_cooperative_runs.len() > MAX_REPLAY_IDS
        || progress.completion_cursors.len() > MAX_REPLAY_IDS
    {
        return Err(ValidationError::Bounds);
    }
    let definitions: HashSet<_> = defenders().into_iter().map(|item| item.id).collect();
    let unlocked: HashSet<_> = progress
        .unlocked_defenders
        .iter()
        .map(String::as_str)
        .collect();
    if unlocked.len() != progress.unlocked_defenders.len()
        || unlocked.iter().any(|id| !definitions.contains(id))
    {
        return Err(ValidationError::Content);
    }
    let completions: HashSet<_> = progress
        .completed_sessions
        .iter()
        .map(|session| session.0.as_str())
        .collect();
    if completions.len() != progress.completed_sessions.len()
        || completions.iter().any(|session| session.trim().is_empty())
    {
        return Err(ValidationError::Entities);
    }
    let cooperative: HashSet<_> = progress
        .completed_cooperative_runs
        .iter()
        .map(|session| session.0.as_str())
        .collect();
    if cooperative.len() != progress.completed_cooperative_runs.len()
        || cooperative.iter().any(|session| session.trim().is_empty())
        || cooperative
            .iter()
            .any(|session| !completions.contains(session))
    {
        return Err(ValidationError::Entities);
    }
    let cursors: HashSet<_> = progress
        .completion_cursors
        .iter()
        .map(|cursor| cursor.session_id.0.as_str())
        .collect();
    if cursors.len() != progress.completion_cursors.len()
        || cursors
            .iter()
            .any(|session| session.trim().is_empty() || session.chars().any(char::is_control))
    {
        return Err(ValidationError::Entities);
    }
    Ok(())
}

#[derive(Clone, Debug)]
pub struct Simulation {
    pub state: SessionSnapshot,
}

impl Simulation {
    #[must_use]
    pub fn create(
        channel_id: String,
        name: String,
        host: PlayerId,
        display_name: String,
        seed: u64,
    ) -> Self {
        let resource = levels()[0].scales[0].resource_per_player;
        Self {
            state: SessionSnapshot {
                schema_version: SCHEMA_VERSION,
                movement_version: MOVEMENT_VERSION,
                session_id: SessionId::new(),
                channel_id,
                name,
                level: 1,
                status: SessionStatus::Lobby,
                attempt: 0,
                host: host.clone(),
                members: vec![Member {
                    player_id: host.clone(),
                    display_name,
                    role: MemberRole::Host,
                    slot: Some(0),
                    ready: false,
                    resources: resource,
                    contribution: 0,
                }],
                participant_history: vec![host],
                scale_players: 1,
                defenders: vec![],
                enemies: vec![],
                pending_spawns: vec![],
                pending_events: vec![],
                recent_actions: vec![],
                completion_receipts: vec![],
                wave: 0,
                base_health: 20,
                tick: 0,
                seed,
                last_sequence: 0,
                processed_commands: vec![],
                processed_command_receipts: vec![],
                next_enemy: 0,
                score: 0,
                defeated_enemies: 0,
                leaked_enemies: 0,
            },
        }
    }

    #[must_use]
    pub const fn from_snapshot(state: SessionSnapshot) -> Self {
        Self { state }
    }

    pub fn apply(
        &mut self,
        command: &PlayerCommand,
        progress: &Progress,
    ) -> Result<CommandAck, GameError> {
        if command.schema_version != SCHEMA_VERSION {
            return Err(GameError::UnsupportedSchema);
        }
        if self.state.processed_commands.contains(&command.id) {
            return Err(GameError::Duplicate);
        }
        if command.expected_sequence != self.state.last_sequence {
            return Err(GameError::Conflict);
        }
        let actor = self
            .state
            .members
            .iter()
            .find(|member| member.player_id == command.player_id)
            .map(|member| member.display_name.clone())
            .or_else(|| match &command.kind {
                CommandKind::Join { display_name, .. } => {
                    normalized_display_name(display_name).map(str::to_string)
                }
                _ => None,
            })
            .unwrap_or_else(|| "Player".into());
        let action_label = command_action_label(&command.kind);
        self.authorize_and_apply(command, progress)?;
        self.state.last_sequence += 1;
        self.state.processed_commands.push(command.id.clone());
        self.state
            .processed_command_receipts
            .push(ProcessedCommandReceipt {
                command_id: command.id.clone(),
                command_fingerprint: command.fingerprint(),
                sequence: self.state.last_sequence,
            });
        if self.state.processed_commands.len() > MAX_REPLAY_IDS {
            let removed = self.state.processed_commands.remove(0);
            self.state
                .processed_command_receipts
                .retain(|receipt| receipt.command_id != removed);
        }
        self.state.recent_actions.push(RecentAction {
            sequence: self.state.last_sequence,
            actor,
            label: action_label,
        });
        if self.state.recent_actions.len() > 12 {
            self.state.recent_actions.remove(0);
        }
        Ok(CommandAck {
            command_id: command.id.clone(),
            sequence: self.state.last_sequence,
            accepted: true,
            reason: None,
            command_fingerprint: Some(command.fingerprint()),
        })
    }

    fn member_index(&self, id: &PlayerId) -> Result<usize, GameError> {
        self.state
            .members
            .iter()
            .position(|member| &member.player_id == id)
            .ok_or(GameError::NotMember)
    }

    fn active_member_index(&self, id: &PlayerId) -> Result<usize, GameError> {
        let index = self.member_index(id)?;
        if self.state.members[index].slot.is_some()
            && matches!(
                self.state.members[index].role,
                MemberRole::Host | MemberRole::Player
            )
        {
            Ok(index)
        } else {
            Err(GameError::NotMember)
        }
    }

    fn require_host(&self, id: &PlayerId) -> Result<(), GameError> {
        if &self.state.host == id {
            Ok(())
        } else {
            Err(GameError::HostOnly)
        }
    }

    fn active_players(&self) -> usize {
        self.state
            .members
            .iter()
            .filter(|member| member.slot.is_some())
            .count()
            .clamp(1, 4)
    }

    fn scaling_players(&self) -> usize {
        usize::from(self.state.scale_players.clamp(1, 4))
    }

    fn register_participant(&mut self, player_id: &PlayerId) -> Result<(), GameError> {
        if self.state.participant_history.contains(player_id) {
            return Ok(());
        }
        if self.state.participant_history.len() >= MAX_SESSION_MEMBERS {
            return Err(GameError::SessionParticipantLimit);
        }
        self.state.participant_history.push(player_id.clone());
        Ok(())
    }

    fn pad_is_open(&self, x: u16, y: u16, moving: Option<&EntityId>) -> bool {
        scaled_build_pads(self.state.level, self.scaling_players()).contains(&Point { x, y })
            && !self
                .state
                .defenders
                .iter()
                .any(|defender| moving != Some(&defender.id) && defender.x == x && defender.y == y)
    }

    fn capture_completion_receipt(&mut self) {
        if self.state.status != SessionStatus::Victory {
            return;
        }
        let run_id = completion_run_id(&self.state.session_id, self.state.attempt);
        if self
            .state
            .completion_receipts
            .iter()
            .any(|receipt| receipt.run_id == run_id)
        {
            return;
        }
        let participants = self
            .state
            .members
            .iter()
            .filter(|member| member.slot.is_some())
            .map(|member| member.player_id.clone())
            .collect();
        self.state.completion_receipts.push(CompletionReceipt {
            run_id,
            attempt: self.state.attempt,
            level: self.state.level,
            base_health: self.state.base_health,
            score: self.state.score,
            participants,
        });
        if self.state.completion_receipts.len() > MAX_REPLAY_IDS {
            self.state.completion_receipts.remove(0);
        }
    }

    fn reset_for_level(&mut self, level_id: u8) -> Result<(), GameError> {
        let level = levels()
            .into_iter()
            .find(|candidate| candidate.id == level_id)
            .ok_or(GameError::UnknownContent)?;
        let player_index = self.scaling_players() - 1;
        let resources = level.scales[player_index].resource_per_player;
        let next_attempt = self
            .state
            .attempt
            .checked_add(1)
            .ok_or(GameError::SessionRunLimit)?;
        self.state.level = level_id;
        self.state.status = SessionStatus::Lobby;
        self.state.attempt = next_attempt;
        self.state.base_health = level.base_health;
        self.state.defenders.clear();
        self.state.enemies.clear();
        self.state.pending_spawns.clear();
        self.state.wave = 0;
        self.state.tick = 0;
        self.state.seed = self.state.seed.wrapping_add(1);
        self.state.next_enemy = 0;
        self.state.score = 0;
        self.state.defeated_enemies = 0;
        self.state.leaked_enemies = 0;
        for member in self
            .state
            .members
            .iter_mut()
            .filter(|member| member.slot.is_some())
        {
            member.ready = false;
            member.resources = resources;
            member.contribution = 0;
        }
        Ok(())
    }

    fn authorize_and_apply(
        &mut self,
        command: &PlayerCommand,
        progress: &Progress,
    ) -> Result<(), GameError> {
        match &command.kind {
            CommandKind::Join {
                as_spectator,
                display_name,
            } => {
                let display_name =
                    normalized_display_name(display_name).ok_or(GameError::InvalidDisplayName)?;
                let active = self.active_players();
                if !as_spectator
                    && !matches!(
                        self.state.status,
                        SessionStatus::Lobby | SessionStatus::BetweenWaves
                    )
                {
                    return Err(GameError::InvalidState);
                }
                if let Some(index) = self
                    .state
                    .members
                    .iter()
                    .position(|member| member.player_id == command.player_id)
                {
                    self.state.members[index].display_name = display_name.into();
                    if *as_spectator || self.state.members[index].slot.is_some() {
                        return Ok(());
                    }
                    if active >= 4 {
                        return Err(GameError::LobbyFull);
                    }
                    let slot = (0..4).find(|candidate| {
                        !self
                            .state
                            .members
                            .iter()
                            .any(|member| member.slot == Some(*candidate))
                    });
                    let Some(slot) = slot else {
                        return Err(GameError::LobbyFull);
                    };
                    self.register_participant(&command.player_id)?;
                    self.state.members[index].slot = Some(slot);
                    self.state.members[index].role = MemberRole::Player;
                    self.state.members[index].ready = self.state.status != SessionStatus::Lobby;
                    let scale_players = if self.state.status == SessionStatus::Lobby {
                        active + 1
                    } else {
                        usize::from(self.state.scale_players)
                    };
                    let scale = levels()[usize::from(self.state.level - 1)].scales
                        [scale_players.saturating_sub(1).min(3)];
                    self.state.members[index].resources = scale.resource_per_player;
                    if self.state.status == SessionStatus::Lobby {
                        self.state.scale_players = u8::try_from(scale_players).unwrap_or(4);
                        for member in self
                            .state
                            .members
                            .iter_mut()
                            .filter(|member| member.slot.is_some())
                        {
                            member.resources = scale.resource_per_player;
                        }
                    }
                    return Ok(());
                }
                if self.state.members.len() >= MAX_SESSION_MEMBERS {
                    return Err(GameError::SessionMemberLimit);
                }
                if !as_spectator && active >= 4 {
                    return Err(GameError::LobbyFull);
                }
                let slot = if *as_spectator {
                    None
                } else {
                    (0..4).find(|candidate| {
                        !self
                            .state
                            .members
                            .iter()
                            .any(|member| member.slot == Some(*candidate))
                    })
                };
                if !as_spectator {
                    self.register_participant(&command.player_id)?;
                }
                let scale_players = if self.state.status == SessionStatus::Lobby {
                    active + usize::from(!as_spectator)
                } else {
                    usize::from(self.state.scale_players)
                };
                let scale = levels()[usize::from(self.state.level - 1)].scales
                    [scale_players.saturating_sub(1).min(3)];
                self.state.members.push(Member {
                    player_id: command.player_id.clone(),
                    display_name: display_name.into(),
                    role: if *as_spectator {
                        MemberRole::Spectator
                    } else {
                        MemberRole::Player
                    },
                    slot,
                    ready: false,
                    resources: scale.resource_per_player,
                    contribution: 0,
                });
                if !as_spectator && self.state.status == SessionStatus::Lobby {
                    self.state.scale_players = u8::try_from(scale_players).unwrap_or(4);
                    for member in self
                        .state
                        .members
                        .iter_mut()
                        .filter(|member| member.slot.is_some())
                    {
                        member.resources = scale.resource_per_player;
                    }
                }
            }
            CommandKind::Leave => {
                let was_lobby = self.state.status == SessionStatus::Lobby;
                let index = self.member_index(&command.player_id)?;
                self.state.members.remove(index);
                self.state
                    .defenders
                    .retain(|defender| defender.owner != command.player_id);
                let next_active = self
                    .state
                    .members
                    .iter()
                    .find(|member| member.slot.is_some())
                    .map(|member| member.player_id.clone());
                if next_active.is_none() {
                    self.state.status = SessionStatus::Abandoned;
                } else if self.state.host == command.player_id {
                    let Some(next) = next_active else {
                        return Err(GameError::InvalidState);
                    };
                    self.state.host = next.clone();
                    if let Some(member) = self
                        .state
                        .members
                        .iter_mut()
                        .find(|member| member.player_id == next)
                    {
                        member.role = MemberRole::Host;
                    }
                }
                if was_lobby {
                    self.state.scale_players = u8::try_from(
                        self.state
                            .members
                            .iter()
                            .filter(|member| member.slot.is_some())
                            .count()
                            .clamp(1, 4),
                    )
                    .unwrap_or(4);
                    let scale = &levels()[usize::from(self.state.level - 1)].scales
                        [usize::from(self.state.scale_players.saturating_sub(1))];
                    for member in self
                        .state
                        .members
                        .iter_mut()
                        .filter(|member| member.slot.is_some())
                    {
                        member.resources = scale.resource_per_player;
                    }
                }
            }
            CommandKind::Ready { ready } => {
                let index = self.active_member_index(&command.player_id)?;
                if self.state.status != SessionStatus::Lobby {
                    return Err(GameError::InvalidState);
                }
                self.state.members[index].ready = *ready;
            }
            CommandKind::SelectLevel { level } => {
                self.require_host(&command.player_id)?;
                if self.state.status != SessionStatus::Lobby {
                    return Err(GameError::InvalidState);
                }
                if *level > progress.unlocked_level {
                    return Err(GameError::Locked);
                }
                let content = levels()
                    .into_iter()
                    .find(|candidate| candidate.id == *level)
                    .ok_or(GameError::UnknownContent)?;
                self.state.level = *level;
                self.state.base_health = content.base_health;
                let player_index = self.scaling_players() - 1;
                let resources = content.scales[player_index].resource_per_player;
                for member in self
                    .state
                    .members
                    .iter_mut()
                    .filter(|member| member.slot.is_some())
                {
                    member.resources = resources;
                }
            }
            CommandKind::Start => {
                self.require_host(&command.player_id)?;
                if self.state.status != SessionStatus::Lobby
                    || self
                        .state
                        .members
                        .iter()
                        .filter(|member| member.slot.is_some())
                        .any(|member| !member.ready)
                {
                    return Err(GameError::InvalidState);
                }
                self.state.status = SessionStatus::BetweenWaves;
            }
            CommandKind::StartWave => {
                self.require_host(&command.player_id)?;
                if self.state.status != SessionStatus::BetweenWaves {
                    return Err(GameError::InvalidState);
                }
                self.start_wave()?;
            }
            CommandKind::Place { defender, x, y } => {
                let member_index = self.active_member_index(&command.player_id)?;
                if !matches!(
                    self.state.status,
                    SessionStatus::BetweenWaves | SessionStatus::Running
                ) {
                    return Err(GameError::InvalidState);
                }
                if !self.pad_is_open(*x, *y, None) {
                    return Err(GameError::Placement);
                }
                let definition = defenders()
                    .into_iter()
                    .find(|candidate| candidate.id == defender)
                    .ok_or(GameError::UnknownContent)?;
                let level = levels()
                    .into_iter()
                    .find(|candidate| candidate.id == self.state.level)
                    .ok_or(GameError::UnknownContent)?;
                if !level.available_defenders.contains(&definition.id)
                    || !progress
                        .unlocked_defenders
                        .iter()
                        .any(|unlocked| unlocked == defender)
                {
                    return Err(GameError::Locked);
                }
                if self.state.members[member_index].resources < definition.cost {
                    return Err(GameError::Resources);
                }
                self.state.members[member_index].resources -= definition.cost;
                self.state.defenders.push(DefenderState {
                    id: EntityId(format!("defender-{}", self.state.last_sequence + 1)),
                    owner: command.player_id.clone(),
                    kind: defender.clone(),
                    x: *x,
                    y: *y,
                    level: 1,
                    path: "base".into(),
                    cooldown_ticks: 0,
                    target_policy: TargetPolicy::First,
                });
            }
            CommandKind::Upgrade { entity_id, path } => {
                let member_index = self.active_member_index(&command.player_id)?;
                if !matches!(
                    self.state.status,
                    SessionStatus::BetweenWaves | SessionStatus::Running
                ) {
                    return Err(GameError::InvalidState);
                }
                let defender = self
                    .state
                    .defenders
                    .iter_mut()
                    .find(|defender| {
                        defender.id == *entity_id && defender.owner == command.player_id
                    })
                    .ok_or(GameError::DefenderOwnership)?;
                let definition = defenders()
                    .into_iter()
                    .find(|candidate| candidate.id == defender.kind)
                    .ok_or(GameError::UnknownContent)?;
                if !definition.upgrade_paths.contains(&path.as_str()) {
                    return Err(GameError::UnknownContent);
                }
                if defender.level >= MAX_DEFENDER_LEVEL {
                    return Err(GameError::MaxUpgrade);
                }
                if (defender.level == 1 && defender.path != "base")
                    || (defender.level > 1 && defender.path != *path)
                {
                    return Err(GameError::UpgradeBranch);
                }
                let cost = next_upgrade_tier(definition.id, path, defender.level)
                    .ok_or(GameError::MaxUpgrade)?
                    .cost;
                if self.state.members[member_index].resources < cost {
                    return Err(GameError::Resources);
                }
                self.state.members[member_index].resources -= cost;
                defender.level += 1;
                defender.path = path.clone();
            }
            CommandKind::SetTarget { entity_id, policy } => {
                self.active_member_index(&command.player_id)?;
                if !matches!(
                    self.state.status,
                    SessionStatus::BetweenWaves | SessionStatus::Running
                ) {
                    return Err(GameError::InvalidState);
                }
                let defender = self
                    .state
                    .defenders
                    .iter_mut()
                    .find(|defender| {
                        defender.id == *entity_id && defender.owner == command.player_id
                    })
                    .ok_or(GameError::DefenderOwnership)?;
                defender.target_policy = *policy;
            }
            CommandKind::Sell { entity_id } => {
                let member_index = self.active_member_index(&command.player_id)?;
                if !matches!(
                    self.state.status,
                    SessionStatus::BetweenWaves | SessionStatus::Running
                ) {
                    return Err(GameError::InvalidState);
                }
                let position = self
                    .state
                    .defenders
                    .iter()
                    .position(|defender| {
                        defender.id == *entity_id && defender.owner == command.player_id
                    })
                    .ok_or(GameError::DefenderOwnership)?;
                let defender = self.state.defenders.remove(position);
                let base = defenders()
                    .into_iter()
                    .find(|candidate| candidate.id == defender.kind)
                    .ok_or(GameError::UnknownContent)?;
                let upgrade_value = upgrade_investment(&defender);
                let refund = base.cost.saturating_add(upgrade_value) / 2;
                self.state.members[member_index].resources = self.state.members[member_index]
                    .resources
                    .saturating_add(refund);
            }
            CommandKind::Move { entity_id, x, y } => {
                self.active_member_index(&command.player_id)?;
                if !matches!(
                    self.state.status,
                    SessionStatus::BetweenWaves | SessionStatus::Running
                ) || !self.pad_is_open(*x, *y, Some(entity_id))
                {
                    return Err(GameError::Placement);
                }
                let defender = self
                    .state
                    .defenders
                    .iter_mut()
                    .find(|defender| {
                        defender.id == *entity_id && defender.owner == command.player_id
                    })
                    .ok_or(GameError::DefenderOwnership)?;
                defender.x = *x;
                defender.y = *y;
            }
            CommandKind::Pause => {
                self.require_host(&command.player_id)?;
                if self.state.status != SessionStatus::Running {
                    return Err(GameError::InvalidState);
                }
                self.state.status = SessionStatus::Paused;
            }
            CommandKind::Resume => {
                self.require_host(&command.player_id)?;
                if self.state.status != SessionStatus::Paused {
                    return Err(GameError::InvalidState);
                }
                self.state.status = SessionStatus::Running;
            }
            CommandKind::Restart => {
                self.require_host(&command.player_id)?;
                if !matches!(
                    self.state.status,
                    SessionStatus::Victory | SessionStatus::Defeat
                ) {
                    return Err(GameError::InvalidState);
                }
                self.state
                    .attempt
                    .checked_add(1)
                    .ok_or(GameError::SessionRunLimit)?;
                self.capture_completion_receipt();
                self.reset_for_level(self.state.level)?;
            }
            CommandKind::AdvanceLevel => {
                self.require_host(&command.player_id)?;
                if self.state.status != SessionStatus::Victory {
                    return Err(GameError::InvalidState);
                }
                let current_level = self.state.level;
                let Some(next_level) = current_level.checked_add(1).and_then(|next_id| {
                    levels().into_iter().find(|candidate| {
                        candidate.id == next_id
                            && candidate.unlock == LevelUnlock::CompleteLevel(current_level)
                    })
                }) else {
                    return Err(GameError::CampaignComplete);
                };
                self.state
                    .attempt
                    .checked_add(1)
                    .ok_or(GameError::SessionRunLimit)?;
                self.capture_completion_receipt();
                self.reset_for_level(next_level.id)?;
            }
        }
        Ok(())
    }

    fn start_wave(&mut self) -> Result<(), GameError> {
        let level = levels()
            .into_iter()
            .find(|candidate| candidate.id == self.state.level)
            .ok_or(GameError::UnknownContent)?;
        let wave = level
            .waves
            .get(usize::from(self.state.wave))
            .ok_or(GameError::InvalidState)?;
        self.state.pending_spawns.clear();
        for (group_index, group) in wave.spawns.iter().enumerate() {
            let player_index = self.scaling_players() - 1;
            let scale = &level.scales[player_index];
            let scaled_count = (u32::from(group.count) * u32::from(scale.wave_percent))
                .div_ceil(100)
                .max(1);
            let lane = group.path % scale.paths.max(1);
            for offset in 0..scaled_count {
                let variation = spawn_variation(
                    self.state.seed,
                    self.state.level,
                    self.state.wave,
                    group_index,
                    offset,
                );
                let timing_jitter = if offset == 0 { 0 } else { variation % 3 };
                let varied_lane =
                    if offset > 0 && scale.paths > 1 && (variation >> 8).is_multiple_of(5) {
                        let other_lane = 1 + u8::try_from(
                            (variation >> 16) % u64::from(scale.paths.saturating_sub(1)),
                        )
                        .unwrap_or(0);
                        (lane + other_lane) % scale.paths
                    } else {
                        lane
                    };
                self.state.pending_spawns.push(PendingSpawn {
                    at_tick: self.state.tick
                        + u64::from(group.delay)
                        + u64::from(offset)
                            * u64::from(
                                group
                                    .interval
                                    .saturating_sub(u16::try_from(player_index).unwrap_or(0))
                                    .max(3),
                            )
                        + timing_jitter,
                    kind: group.kind.id().into(),
                    path: varied_lane,
                });
            }
        }
        self.state
            .pending_spawns
            .sort_by_key(|pending| (pending.at_tick, pending.path, pending.kind.clone()));
        self.state.wave += 1;
        self.state.status = SessionStatus::Running;
        Ok(())
    }

    fn kind_for_id(id: &str) -> Option<EnemyKind> {
        match id {
            "basic" => Some(EnemyKind::Basic),
            "fast" => Some(EnemyKind::Fast),
            "armored" => Some(EnemyKind::Armored),
            "swarm" => Some(EnemyKind::Swarm),
            "disruption" => Some(EnemyKind::Disruption),
            "boss" => Some(EnemyKind::Boss),
            _ => None,
        }
    }

    fn spawn_due_enemies(&mut self) {
        let Some(scale) = level_scale(self.state.level, self.state.scale_players) else {
            return;
        };
        let due = self
            .state
            .pending_spawns
            .partition_point(|pending| pending.at_tick <= self.state.tick);
        let pending: Vec<_> = self.state.pending_spawns.drain(..due).collect();
        let health_percent = scale.enemy_percent;
        for spawn in pending {
            let Some(kind) = Self::kind_for_id(&spawn.kind) else {
                continue;
            };
            let definition = enemy_definition(kind);
            let health = definition.health * i32::from(health_percent) / 100;
            self.state.next_enemy += 1;
            self.state.enemies.push(EnemyState {
                id: EntityId(format!("enemy-{}", self.state.next_enemy)),
                kind: spawn.kind,
                path: spawn.path,
                progress: 0,
                health,
                max_health: health,
                slowed_ticks: 0,
                control_resistance_ticks: 0,
                armor: definition.armor
                    + if self.state.level == 3 && kind == EnemyKind::Armored {
                        15
                    } else {
                        0
                    },
                reward: definition.reward,
                leak_damage: definition.leak_damage,
            });
        }
    }

    fn move_enemies(&mut self) {
        let Some(scale) = level_scale(self.state.level, self.state.scale_players) else {
            return;
        };
        for enemy in &mut self.state.enemies {
            enemy.control_resistance_ticks = enemy.control_resistance_ticks.saturating_sub(1);
            let Some(kind) = Self::kind_for_id(&enemy.kind) else {
                continue;
            };
            let mut speed = enemy_definition(kind).speed;
            if self.state.level == 2 && kind == EnemyKind::Fast {
                speed += 1;
            }
            let enraged = kind == EnemyKind::Boss && enemy.health * 2 < enemy.max_health;
            if enraged {
                speed += 1;
            }
            if enemy.slowed_ticks > 0 {
                speed = speed.div_ceil(2).max(1);
                enemy.slowed_ticks -= 1;
            }
            let proposed_path = enraged.then(|| {
                u8::try_from(
                    (self.state.tick / u64::from(scale.boss_phase_ticks.max(1)))
                        % u64::from(scale.paths.max(1)),
                )
                .unwrap_or(0)
            });
            enemy.progress = enemy.progress.saturating_add(speed);

            // Algorithm Shift changes lanes only where their authored trails
            // physically meet. Reusing normalized progress on unrelated lanes
            // used to teleport bosses hundreds of pixels in a single tick.
            if let Some(path) = proposed_path.filter(|path| *path != enemy.path) {
                let current = path_position_precise(self.state.level, enemy.path, enemy.progress);
                if let Some((projected_progress, distance_squared)) =
                    nearest_route_progress(self.state.level, path, current)
                {
                    let tolerance = u64::from(PATH_POSITION_SCALE) * 5;
                    if distance_squared <= tolerance * tolerance {
                        enemy.path = path;
                        enemy.progress = projected_progress;
                    }
                }
            }
        }
    }

    fn target_index(&self, defender: &DefenderState, range: u16) -> Option<usize> {
        let range_squared = i64::from(range) * i64::from(range);
        let candidates = self.state.enemies.iter().enumerate().filter(|(_, enemy)| {
            if enemy.health <= 0 {
                return false;
            }
            let point = path_position(self.state.level, enemy.path, enemy.progress);
            let dx = i64::from(defender.x) - i64::from(point.x);
            let dy = i64::from(defender.y) - i64::from(point.y);
            dx * dx + dy * dy <= range_squared
        });
        match defender.target_policy {
            TargetPolicy::First => candidates.max_by_key(|(_, enemy)| enemy.progress),
            TargetPolicy::Last => candidates.min_by_key(|(_, enemy)| enemy.progress),
            TargetPolicy::Strong => candidates.max_by_key(|(_, enemy)| enemy.health),
            TargetPolicy::Fast => candidates.max_by_key(|(_, enemy)| {
                Self::kind_for_id(&enemy.kind)
                    .map(enemy_definition)
                    .map_or(0, |definition| definition.speed)
            }),
        }
        .map(|(index, _)| index)
    }

    fn effective_damage(raw: i32, armor: u8, pierce: u8) -> i32 {
        let remaining_armor = armor.saturating_sub(pierce).min(90);
        (raw * i32::from(100 - remaining_armor) / 100).max(1)
    }

    fn attack_targets(
        &self,
        primary: usize,
        target_point: Point,
        stats: EffectiveDefender,
    ) -> Vec<AttackTarget> {
        if let Some(UpgradeMechanic::Chain {
            radius,
            extra_targets,
            secondary_damage_percent,
        }) = stats.mechanic
        {
            let radius_squared = i64::from(radius) * i64::from(radius);
            let mut nearby = self
                .state
                .enemies
                .iter()
                .enumerate()
                .filter_map(|(index, enemy)| {
                    if index == primary || enemy.health <= 0 {
                        return None;
                    }
                    let point = path_position(self.state.level, enemy.path, enemy.progress);
                    let dx = i64::from(target_point.x) - i64::from(point.x);
                    let dy = i64::from(target_point.y) - i64::from(point.y);
                    let distance = dx * dx + dy * dy;
                    (distance <= radius_squared).then_some((distance, index))
                })
                .collect::<Vec<_>>();
            nearby.sort_unstable_by_key(|(distance, index)| (*distance, *index));
            let extra = usize::from(extra_targets);
            let mut targets = Vec::with_capacity(1 + extra.min(nearby.len()));
            targets.push(AttackTarget {
                index: primary,
                damage_percent: 100,
            });
            targets.extend(
                nearby
                    .into_iter()
                    .take(extra)
                    .map(|(_, index)| AttackTarget {
                        index,
                        damage_percent: secondary_damage_percent,
                    }),
            );
            return targets;
        }
        if stats.splash == 0 {
            return vec![AttackTarget {
                index: primary,
                damage_percent: 100,
            }];
        }
        let radius_squared = i64::from(stats.splash) * i64::from(stats.splash);
        self.state
            .enemies
            .iter()
            .enumerate()
            .filter_map(|(index, enemy)| {
                if enemy.health <= 0 {
                    return None;
                }
                let point = path_position(self.state.level, enemy.path, enemy.progress);
                let dx = i64::from(target_point.x) - i64::from(point.x);
                let dy = i64::from(target_point.y) - i64::from(point.y);
                (dx * dx + dy * dy <= radius_squared).then_some(AttackTarget {
                    index,
                    damage_percent: 100,
                })
            })
            .collect()
    }

    fn pay_income(&mut self, owner: &PlayerId, stats: EffectiveDefender) {
        let mut contribution = 0_u32;
        match stats.mechanic {
            Some(UpgradeMechanic::TeamIncome { teammate_percent }) => {
                for member in self
                    .state
                    .members
                    .iter_mut()
                    .filter(|member| member.slot.is_some())
                {
                    let amount = if &member.player_id == owner {
                        stats.income
                    } else {
                        stats.income * u32::from(teammate_percent) / 100
                    };
                    member.resources = member.resources.saturating_add(amount);
                    contribution = contribution.saturating_add(amount);
                }
            }
            _ => {
                if let Some(member) = self
                    .state
                    .members
                    .iter_mut()
                    .find(|member| &member.player_id == owner)
                {
                    member.resources = member.resources.saturating_add(stats.income);
                    contribution = stats.income;
                }
            }
        }
        if let Some(member) = self
            .state
            .members
            .iter_mut()
            .find(|member| &member.player_id == owner)
        {
            member.contribution = member.contribution.saturating_add(contribution);
        }
    }

    fn upgraded_raw_damage(
        &self,
        defender: &DefenderState,
        enemy: &EnemyState,
        stats: EffectiveDefender,
        damage_percent: u8,
    ) -> (i32, bool) {
        let mut raw = stats.damage * i32::from(damage_percent) / 100;
        let mut execute = false;
        match stats.mechanic {
            Some(UpgradeMechanic::MissingHealth {
                max_bonus_percent,
                execute_percent,
            }) => {
                let missing_percent = i32::from(
                    u8::try_from(
                        i64::from(enemy.max_health.saturating_sub(enemy.health).max(0)) * 100
                            / i64::from(enemy.max_health.max(1)),
                    )
                    .unwrap_or(100),
                );
                let max_bonus = i32::from(max_bonus_percent);
                raw = raw.saturating_add(raw * missing_percent * max_bonus / 10_000);
                let execute_threshold = i32::from(execute_percent);
                execute = enemy.health > 0
                    && enemy.health * 100 <= enemy.max_health.max(1) * execute_threshold;
            }
            Some(UpgradeMechanic::DistanceDamage { max_bonus_percent }) => {
                let point = path_position(self.state.level, enemy.path, enemy.progress);
                let dx = i64::from(defender.x) - i64::from(point.x);
                let dy = i64::from(defender.y) - i64::from(point.y);
                let distance_squared = u64::try_from(dx * dx + dy * dy).unwrap_or(0);
                let range_squared = u64::from(stats.range) * u64::from(stats.range);
                let max_bonus = u64::from(max_bonus_percent);
                let bonus = distance_squared
                    .min(range_squared)
                    .saturating_mul(max_bonus)
                    .checked_div(range_squared)
                    .unwrap_or(0);
                raw = raw.saturating_add(raw * i32::try_from(bonus).unwrap_or(0) / 100);
            }
            Some(UpgradeMechanic::BossDamage { bonus_percent }) if enemy.kind == "boss" => {
                let bonus = i32::from(bonus_percent);
                raw = raw.saturating_add(raw * bonus / 100);
            }
            _ => {}
        }
        (raw.max(1), execute)
    }

    fn run_defenders(&mut self) {
        let outage = self.state.level == 4 && self.state.tick % 300 < 35;
        let disrupted = self
            .state
            .enemies
            .iter()
            .any(|enemy| enemy.kind == "disruption")
            && self.state.tick.is_multiple_of(30);
        for index in 0..self.state.defenders.len() {
            if self.state.defenders[index].cooldown_ticks > 0 {
                if !outage {
                    self.state.defenders[index].cooldown_ticks -= 1;
                }
                continue;
            }
            if outage {
                continue;
            }
            let state = self.state.defenders[index].clone();
            let Some(definition) = defenders()
                .into_iter()
                .find(|candidate| candidate.id == state.kind)
            else {
                continue;
            };
            let stats = effective_defender(&definition, &state);
            let cooldown = stats.cooldown + if disrupted { 3 } else { 0 };
            if stats.income > 0 {
                self.pay_income(&state.owner, stats);
                self.state.defenders[index].cooldown_ticks = cooldown;
                continue;
            }
            let Some(target) = self.target_index(&state, stats.range) else {
                continue;
            };
            let target_point = path_position(
                self.state.level,
                self.state.enemies[target].path,
                self.state.enemies[target].progress,
            );
            let targets = self.attack_targets(target, target_point, stats);
            let mut contribution = 0_u32;
            for attack_target in targets {
                let (raw_damage, execute) = self.upgraded_raw_damage(
                    &state,
                    &self.state.enemies[attack_target.index],
                    stats,
                    attack_target.damage_percent,
                );
                let enemy = &mut self.state.enemies[attack_target.index];
                let health_before = enemy.health.max(0);
                if execute {
                    enemy.health = 0;
                } else {
                    let damage =
                        Self::effective_damage(raw_damage, enemy.armor, stats.armor_pierce);
                    enemy.health -= damage;
                }
                enemy.slowed_ticks = enemy.slowed_ticks.max(stats.slow_ticks);
                match stats.mechanic {
                    Some(UpgradeMechanic::Knockback { progress })
                        if enemy.control_resistance_ticks == 0 =>
                    {
                        enemy.progress = enemy.progress.saturating_sub(progress);
                        enemy.control_resistance_ticks = if enemy.kind == "boss" {
                            BOSS_KNOCKBACK_RESISTANCE_TICKS
                        } else {
                            KNOCKBACK_RESISTANCE_TICKS
                        };
                    }
                    Some(UpgradeMechanic::ArmorShred { armor }) => {
                        enemy.armor = enemy.armor.saturating_sub(armor);
                    }
                    _ => {}
                }
                contribution = contribution.saturating_add(
                    u32::try_from(health_before.saturating_sub(enemy.health.max(0))).unwrap_or(0),
                );
            }
            if let Some(member) = self
                .state
                .members
                .iter_mut()
                .find(|member| member.player_id == state.owner)
            {
                member.contribution = member.contribution.saturating_add(contribution);
            }
            self.state.defenders[index].cooldown_ticks = cooldown;
        }
    }

    fn resolve_enemies(&mut self) {
        let leak_guard = self
            .state
            .defenders
            .iter()
            .filter_map(|state| {
                let definition = defenders()
                    .into_iter()
                    .find(|candidate| candidate.id == state.kind)?;
                let stats = effective_defender(&definition, state);
                match stats.mechanic {
                    Some(UpgradeMechanic::LeakGuard { damage }) => Some(damage),
                    _ => None,
                }
            })
            .fold(0_u16, u16::max);
        let mut reward = 0_u32;
        let mut leak_damage = 0_u16;
        let mut survivors = Vec::with_capacity(self.state.enemies.len());
        for enemy in self.state.enemies.drain(..) {
            if enemy.health <= 0 {
                reward = reward.saturating_add(enemy.reward);
                self.state.defeated_enemies = self.state.defeated_enemies.saturating_add(1);
            } else if enemy.progress >= 1000 {
                let guarded_damage = enemy
                    .leak_damage
                    .saturating_sub(leak_guard.min(enemy.leak_damage.saturating_sub(1)));
                leak_damage = leak_damage.saturating_add(guarded_damage);
                self.state.leaked_enemies = self.state.leaked_enemies.saturating_add(1);
            } else {
                survivors.push(enemy);
            }
        }
        self.state.enemies = survivors;
        if reward > 0 {
            for member in self
                .state
                .members
                .iter_mut()
                .filter(|member| member.slot.is_some())
            {
                member.resources = member.resources.saturating_add(reward);
            }
            self.state.score = self.state.score.saturating_add(reward * 10);
        }
        self.state.base_health = self.state.base_health.saturating_sub(leak_damage);
    }

    pub fn tick(&mut self) {
        if self.state.status != SessionStatus::Running {
            return;
        }
        self.state.tick += 1;
        self.spawn_due_enemies();
        self.move_enemies();
        self.run_defenders();
        self.resolve_enemies();
        if self.state.base_health == 0 {
            self.state.status = SessionStatus::Defeat;
        } else if self.state.pending_spawns.is_empty() && self.state.enemies.is_empty() {
            let level = levels()
                .into_iter()
                .find(|candidate| candidate.id == self.state.level);
            let campaign_complete =
                level.is_some_and(|content| usize::from(self.state.wave) >= content.waves.len());
            self.state.status = if campaign_complete {
                SessionStatus::Victory
            } else {
                for member in self
                    .state
                    .members
                    .iter_mut()
                    .filter(|member| member.slot.is_some())
                {
                    member.resources = member.resources.saturating_add(WAVE_CLEAR_BONUS);
                }
                SessionStatus::BetweenWaves
            };
            self.capture_completion_receipt();
        }
    }
}

fn command_action_label(kind: &CommandKind) -> String {
    match kind {
        CommandKind::Join {
            as_spectator: true, ..
        } => "started watching".into(),
        CommandKind::Join {
            as_spectator: false,
            ..
        } => "claimed a player slot".into(),
        CommandKind::Leave => "left the game".into(),
        CommandKind::Ready { ready: true } => "is ready".into(),
        CommandKind::Ready { ready: false } => "is no longer ready".into(),
        CommandKind::SelectLevel { level } => format!("selected level {level}"),
        CommandKind::Start => "started the defense".into(),
        CommandKind::StartWave => "started the next wave".into(),
        CommandKind::Place { defender, .. } => {
            format!("placed {}", defender.replace('_', " "))
        }
        CommandKind::Upgrade { path, .. } => format!("upgraded a defender via {path}"),
        CommandKind::SetTarget { policy, .. } => {
            format!(
                "changed targeting to {}",
                format!("{policy:?}").to_lowercase()
            )
        }
        CommandKind::Sell { .. } => "sold a defender".into(),
        CommandKind::Move { .. } => "repositioned a defender".into(),
        CommandKind::Pause => "paused the defense".into(),
        CommandKind::Resume => "resumed the defense".into(),
        CommandKind::Restart => "restarted the level".into(),
        CommandKind::AdvanceLevel => "continued to the next level".into(),
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CompletionUpdate {
    pub latest_stars: Option<u8>,
    pub progress_changed: bool,
}

fn update_completion_cursor(progress: &mut Progress, session_id: &SessionId, attempt: u32) -> bool {
    if let Some(cursor) = progress
        .completion_cursors
        .iter_mut()
        .find(|cursor| cursor.session_id == *session_id)
    {
        if attempt > cursor.attempt {
            cursor.attempt = attempt;
            return true;
        }
        return false;
    }
    progress.completion_cursors.push(CompletionCursor {
        session_id: session_id.clone(),
        attempt,
    });
    if progress.completion_cursors.len() > MAX_REPLAY_IDS {
        progress.completion_cursors.remove(0);
    }
    true
}

fn award_completion(
    progress: &mut Progress,
    session_id: &SessionId,
    receipt: &CompletionReceipt,
) -> CompletionUpdate {
    if !receipt
        .participants
        .iter()
        .any(|participant| participant == &progress.player_id)
    {
        return CompletionUpdate::default();
    }
    let exact_replay = progress
        .completed_sessions
        .iter()
        .any(|completed| completed == &receipt.run_id);
    let cursor_replay = progress
        .completion_cursors
        .iter()
        .any(|cursor| cursor.session_id == *session_id && cursor.attempt >= receipt.attempt);
    if exact_replay || cursor_replay {
        return CompletionUpdate {
            latest_stars: None,
            progress_changed: exact_replay
                && update_completion_cursor(progress, session_id, receipt.attempt),
        };
    }
    let Some(level) = levels()
        .into_iter()
        .find(|candidate| candidate.id == receipt.level)
    else {
        return CompletionUpdate::default();
    };
    let health_percent =
        (u32::from(receipt.base_health) * 100 / u32::from(level.base_health.max(1))).min(100);
    let stars = level
        .scoring
        .stars_for_health_percent(u8::try_from(health_percent).unwrap_or(100));
    let index = usize::from(receipt.level.saturating_sub(1));
    progress.best_stars[index] = progress.best_stars[index].max(stars);
    progress.best_scores[index] = progress.best_scores[index].max(receipt.score);
    if let Some(next_level) = levels()
        .into_iter()
        .find(|candidate| candidate.id == receipt.level.saturating_add(1))
        && next_level.unlock == LevelUnlock::CompleteLevel(receipt.level)
    {
        progress.unlocked_level = progress.unlocked_level.max(next_level.id);
    }
    let defender_unlock = match receipt.level {
        1 => Some("deep_scroller"),
        2 => Some("side_hustler"),
        3 => Some("final_form"),
        _ => None,
    };
    if let Some(defender) = defender_unlock
        && !progress
            .unlocked_defenders
            .iter()
            .any(|unlocked| unlocked == defender)
    {
        progress.unlocked_defenders.push(defender.into());
    }
    progress.completed_sessions.push(receipt.run_id.clone());
    if progress.completed_sessions.len() > MAX_REPLAY_IDS {
        let removed = progress.completed_sessions.remove(0);
        progress
            .completed_cooperative_runs
            .retain(|run_id| *run_id != removed);
    }
    if receipt.participants.len() > 1 {
        progress
            .completed_cooperative_runs
            .push(receipt.run_id.clone());
        if progress.completed_cooperative_runs.len() > MAX_REPLAY_IDS {
            progress.completed_cooperative_runs.remove(0);
        }
        progress.cooperative_completions = progress.cooperative_completions.saturating_add(1);
    }
    update_completion_cursor(progress, session_id, receipt.attempt);
    CompletionUpdate {
        latest_stars: Some(stars),
        progress_changed: true,
    }
}

/// Records the current Victory frame into the current player's progression.
/// This compatibility entry point also accepts persisted v1 Victory snapshots
/// created before durable completion receipts were introduced.
pub fn record_completion(progress: &mut Progress, snapshot: &SessionSnapshot) -> Option<u8> {
    if snapshot.status != SessionStatus::Victory {
        return None;
    }
    let run_id = completion_run_id(&snapshot.session_id, snapshot.attempt);
    if let Some(receipt) = snapshot
        .completion_receipts
        .iter()
        .find(|receipt| receipt.run_id == run_id)
    {
        return award_completion(progress, &snapshot.session_id, receipt).latest_stars;
    }
    let receipt = CompletionReceipt {
        run_id,
        attempt: snapshot.attempt,
        level: snapshot.level,
        base_health: snapshot.base_health,
        score: snapshot.score,
        participants: snapshot
            .members
            .iter()
            .filter(|member| member.slot.is_some())
            .map(|member| member.player_id.clone())
            .collect(),
    };
    award_completion(progress, &snapshot.session_id, &receipt).latest_stars
}

/// Consumes every durable completion receipt the player is eligible for.
/// The result distinguishes a newly-awarded victory from replay-cursor
/// migration so callers persist both without announcing a duplicate reward.
pub fn record_completions(progress: &mut Progress, snapshot: &SessionSnapshot) -> CompletionUpdate {
    let mut update = CompletionUpdate::default();
    for receipt in &snapshot.completion_receipts {
        let receipt_update = award_completion(progress, &snapshot.session_id, receipt);
        update.progress_changed |= receipt_update.progress_changed;
        if receipt_update.latest_stars.is_some() {
            update.latest_stars = receipt_update.latest_stars;
        }
    }
    if let Some(stars) = record_completion(progress, snapshot) {
        update.latest_stars = Some(stars);
        update.progress_changed = true;
    }
    update
}

#[cfg(test)]
mod tests {
    use super::*;
    use game_content::build_pads;
    use game_protocol::CommandId;
    use proptest::prelude::*;

    fn progress(player: &PlayerId) -> Progress {
        Progress {
            schema_version: 1,
            player_id: player.clone(),
            unlocked_level: 5,
            unlocked_defenders: defenders()
                .into_iter()
                .map(|defender| defender.id.to_string())
                .collect(),
            best_stars: [0; 5],
            best_scores: [0; 5],
            cooperative_completions: 0,
            completed_sessions: vec![],
            completed_cooperative_runs: vec![],
            completion_cursors: vec![],
        }
    }

    fn command(player: &PlayerId, sequence: u64, kind: CommandKind) -> PlayerCommand {
        PlayerCommand {
            schema_version: 1,
            id: CommandId::new(),
            player_id: player.clone(),
            expected_sequence: sequence,
            kind,
        }
    }

    fn tower(owner: &PlayerId, kind: &str, path: &str, level: u8, x: u16, y: u16) -> DefenderState {
        DefenderState {
            id: EntityId(format!("{kind}-{path}")),
            owner: owner.clone(),
            kind: kind.into(),
            x,
            y,
            level,
            path: path.into(),
            cooldown_ticks: 0,
            target_policy: TargetPolicy::First,
        }
    }

    fn enemy_state(
        id: &str,
        kind: &str,
        path: u8,
        progress: u16,
        health: i32,
        armor: u8,
        leak_damage: u16,
    ) -> EnemyState {
        EnemyState {
            id: EntityId(id.into()),
            kind: kind.into(),
            path,
            progress,
            health,
            max_health: health,
            slowed_ticks: 0,
            control_resistance_ticks: 0,
            armor,
            reward: 0,
            leak_damage,
        }
    }

    fn combat_simulation(player: &PlayerId) -> Simulation {
        let mut simulation =
            Simulation::create("c".into(), "Game".into(), player.clone(), "A".into(), 1);
        simulation.state.status = SessionStatus::Running;
        simulation.state.members[0].resources = 0;
        simulation
    }

    fn complete_run(simulation: &mut Simulation, base_health: u16, score: u32) {
        simulation.state.status = SessionStatus::Victory;
        simulation.state.base_health = base_health;
        simulation.state.score = score;
        simulation.capture_completion_receipt();
    }

    #[test]
    fn starts_empty_and_valid() {
        let player = PlayerId::new();
        let simulation = Simulation::create("c".into(), "Game".into(), player, "A".into(), 1);
        assert!(simulation.state.defenders.is_empty());
        assert!(simulation.state.enemies.is_empty());
        assert!(simulation.state.pending_spawns.is_empty());
    }

    #[test]
    fn rejects_replay_and_conflict() {
        let player = PlayerId::new();
        let mut simulation =
            Simulation::create("c".into(), "Game".into(), player.clone(), "A".into(), 1);
        let ready = command(&player, 0, CommandKind::Ready { ready: true });
        assert!(simulation.apply(&ready, &progress(&player)).is_ok());
        assert_eq!(
            simulation.apply(&ready, &progress(&player)),
            Err(GameError::Duplicate)
        );
        assert_eq!(
            simulation.apply(
                &command(&player, 0, CommandKind::Ready { ready: false }),
                &progress(&player)
            ),
            Err(GameError::Conflict)
        );
        assert_eq!(simulation.state.recent_actions.len(), 1);
        assert_eq!(simulation.state.recent_actions[0].actor, "A");
        assert_eq!(simulation.state.recent_actions[0].label, "is ready");
    }

    #[test]
    fn spectator_cannot_mutate_gameplay() {
        let host = PlayerId::new();
        let spectator = PlayerId::new();
        let mut simulation = Simulation::create("c".into(), "Game".into(), host, "A".into(), 1);
        simulation
            .apply(
                &command(
                    &spectator,
                    0,
                    CommandKind::Join {
                        as_spectator: true,
                        display_name: "Watcher".into(),
                    },
                ),
                &progress(&spectator),
            )
            .expect("spectator join");
        assert_eq!(
            simulation.apply(
                &command(&spectator, 1, CommandKind::Ready { ready: true }),
                &progress(&spectator)
            ),
            Err(GameError::NotMember)
        );
        simulation.state.status = SessionStatus::BetweenWaves;
        let pad = build_pads(1)[0];
        assert_eq!(
            simulation.apply(
                &command(
                    &spectator,
                    1,
                    CommandKind::Place {
                        defender: "zip_zapper".into(),
                        x: pad.x,
                        y: pad.y,
                    },
                ),
                &progress(&spectator),
            ),
            Err(GameError::NotMember)
        );
    }

    #[test]
    fn placement_requires_open_authored_pad_and_unlock() {
        let player = PlayerId::new();
        let mut simulation =
            Simulation::create("c".into(), "Game".into(), player.clone(), "A".into(), 1);
        simulation.state.status = SessionStatus::BetweenWaves;
        assert_eq!(
            simulation.apply(
                &command(
                    &player,
                    0,
                    CommandKind::Place {
                        defender: "zip_zapper".into(),
                        x: 300,
                        y: 300,
                    },
                ),
                &progress(&player),
            ),
            Err(GameError::Placement)
        );
        let pad = build_pads(1)[0];
        assert!(
            simulation
                .apply(
                    &command(
                        &player,
                        0,
                        CommandKind::Place {
                            defender: "zip_zapper".into(),
                            x: pad.x,
                            y: pad.y,
                        },
                    ),
                    &progress(&player),
                )
                .is_ok()
        );
        assert_eq!(simulation.state.defenders[0].id.0, "defender-1");
    }

    #[test]
    fn wave_queue_survives_serialization_and_spawns_over_time() {
        let player = PlayerId::new();
        let mut simulation =
            Simulation::create("c".into(), "Game".into(), player.clone(), "A".into(), 1);
        simulation.state.status = SessionStatus::BetweenWaves;
        simulation.start_wave().expect("wave starts");
        assert_eq!(simulation.state.enemies.len(), 0);
        assert_eq!(simulation.state.pending_spawns.len(), 8);
        let serialized = serde_json::to_string(&simulation.state).expect("serialize snapshot");
        let restored: SessionSnapshot =
            serde_json::from_str(&serialized).expect("restore snapshot");
        let mut restored = Simulation::from_snapshot(restored);
        restored.tick();
        assert_eq!(restored.state.enemies.len(), 1);
        assert_eq!(restored.state.pending_spawns.len(), 7);
        let second_spawn_tick = restored.state.pending_spawns[0].at_tick;
        while restored.state.tick < second_spawn_tick {
            restored.tick();
        }
        assert_eq!(restored.state.enemies.len(), 2);
    }

    #[test]
    fn non_final_wave_clear_bonus_is_active_player_scoped_and_exactly_once() {
        let host = PlayerId::new();
        let teammate = PlayerId::new();
        let spectator = PlayerId::new();
        let mut simulation = Simulation::create("c".into(), "Game".into(), host, "Host".into(), 7);
        let host_resources = simulation.state.members[0].resources;
        simulation.state.members.push(Member {
            player_id: teammate,
            display_name: "Teammate".into(),
            role: MemberRole::Player,
            slot: Some(1),
            ready: true,
            resources: 5,
            contribution: 0,
        });
        simulation.state.members.push(Member {
            player_id: spectator,
            display_name: "Watcher".into(),
            role: MemberRole::Spectator,
            slot: None,
            ready: false,
            resources: 7,
            contribution: 0,
        });
        simulation.state.status = SessionStatus::Running;
        simulation.state.wave = 1;

        simulation.tick();

        assert_eq!(simulation.state.status, SessionStatus::BetweenWaves);
        assert_eq!(
            simulation.state.members[0].resources,
            host_resources + WAVE_CLEAR_BONUS
        );
        assert_eq!(simulation.state.members[1].resources, 5 + WAVE_CLEAR_BONUS);
        assert_eq!(simulation.state.members[2].resources, 7);
        let after_first_clear = simulation.state.members.clone();
        simulation.tick();
        assert_eq!(simulation.state.members, after_first_clear);

        simulation.state.status = SessionStatus::Running;
        simulation.state.wave = 5;
        simulation.tick();
        assert_eq!(simulation.state.status, SessionStatus::Victory);
        assert_eq!(simulation.state.members, after_first_clear);
    }

    #[test]
    fn deterministic_simulation_has_no_hidden_queue_state() {
        let player = PlayerId::new();
        let mut first = Simulation::create("c".into(), "Game".into(), player, "A".into(), 7);
        first.state.status = SessionStatus::BetweenWaves;
        first.start_wave().expect("wave");
        let mut second = first.clone();
        for _ in 0..200 {
            first.tick();
            second.tick();
        }
        assert_eq!(first.state, second.state);
    }

    proptest! {
        #[test]
        fn deterministic_for_arbitrary_runtime_seed_and_tick_count(
            seed in any::<u64>(),
            ticks in 0usize..500,
        ) {
            let player = PlayerId("property-player".into());
            let mut first = Simulation::create(
                "property-channel".into(),
                "Property game".into(),
                player,
                "Property player".into(),
                seed,
            );
            first.state.status = SessionStatus::BetweenWaves;
            first.start_wave().expect("wave starts");
            let mut second = first.clone();
            for _ in 0..ticks {
                first.tick();
                second.tick();
            }
            prop_assert_eq!(first.state, second.state);
        }
    }

    #[test]
    fn every_level_wave_and_player_scale_is_deterministic() {
        for level in levels() {
            for player_count in 1usize..=4 {
                for wave in 1..=level.waves.len() {
                    let host = PlayerId(format!(
                        "host-{level_id}-{player_count}-{wave}",
                        level_id = level.id
                    ));
                    let mut first = Simulation::create(
                        "matrix-channel".into(),
                        "Matrix game".into(),
                        host.clone(),
                        "Host".into(),
                        u64::from(level.id) * 1_000
                            + u64::try_from(player_count * 10 + wave).expect("small matrix"),
                    );
                    for slot in 1..player_count {
                        first.state.members.push(Member {
                            player_id: PlayerId(format!("player-{slot}")),
                            display_name: format!("Player {slot}"),
                            role: MemberRole::Player,
                            slot: Some(u8::try_from(slot).expect("slot")),
                            ready: true,
                            resources: level.scales[player_count - 1].resource_per_player,
                            contribution: 0,
                        });
                    }
                    first.state.level = level.id;
                    first.state.base_health = level.base_health;
                    first.state.scale_players = u8::try_from(player_count).expect("player count");
                    first.state.status = SessionStatus::BetweenWaves;
                    first.state.wave = u8::try_from(wave - 1).expect("wave");
                    first.start_wave().expect("matrix wave starts");
                    let mut second = first.clone();
                    for _ in 0..160 {
                        first.tick();
                        second.tick();
                    }
                    assert_eq!(first.state, second.state);
                }
            }
        }
    }

    #[test]
    fn lobby_scale_rebalances_every_active_players_starting_resources() {
        let host = PlayerId::new();
        let second = PlayerId::new();
        let mut simulation = Simulation::create("c".into(), "Game".into(), host, "Host".into(), 1);
        simulation
            .apply(
                &command(
                    &second,
                    0,
                    CommandKind::Join {
                        as_spectator: false,
                        display_name: "Second".into(),
                    },
                ),
                &progress(&second),
            )
            .expect("second joins");
        let expected = levels()[0].scales[1].resource_per_player;
        assert_eq!(simulation.state.scale_players, 2);
        assert!(
            simulation
                .state
                .members
                .iter()
                .filter(|member| member.slot.is_some())
                .all(|member| member.resources == expected)
        );
    }

    #[test]
    fn in_wave_move_pause_resume_and_restart_are_authoritative_transitions() {
        let player = PlayerId::new();
        let mut simulation = Simulation::create(
            "c".into(),
            "Game".into(),
            player.clone(),
            "Player".into(),
            1,
        );
        simulation.state.status = SessionStatus::BetweenWaves;
        let pads = scaled_build_pads(1, 1);
        simulation
            .apply(
                &command(
                    &player,
                    0,
                    CommandKind::Place {
                        defender: "zip_zapper".into(),
                        x: pads[0].x,
                        y: pads[0].y,
                    },
                ),
                &progress(&player),
            )
            .expect("place");
        let defender = simulation.state.defenders[0].id.clone();
        simulation.state.status = SessionStatus::Running;
        simulation
            .apply(
                &command(
                    &player,
                    1,
                    CommandKind::Move {
                        entity_id: defender,
                        x: pads[1].x,
                        y: pads[1].y,
                    },
                ),
                &progress(&player),
            )
            .expect("move during wave");
        simulation
            .apply(&command(&player, 2, CommandKind::Pause), &progress(&player))
            .expect("pause");
        simulation
            .apply(
                &command(&player, 3, CommandKind::Resume),
                &progress(&player),
            )
            .expect("resume");
        simulation.state.status = SessionStatus::Victory;
        simulation
            .apply(
                &command(&player, 4, CommandKind::Restart),
                &progress(&player),
            )
            .expect("restart");
        assert_eq!(simulation.state.status, SessionStatus::Lobby);
        assert_eq!(simulation.state.attempt, 1);
        assert!(simulation.state.defenders.is_empty());
    }

    #[test]
    fn restarted_victory_can_improve_best_score_without_replaying_same_run() {
        let player = PlayerId::new();
        let mut simulation = Simulation::create(
            "c".into(),
            "Game".into(),
            player.clone(),
            "Player".into(),
            1,
        );
        let mut player_progress = progress(&player);
        simulation.state.status = SessionStatus::Victory;
        simulation.state.score = 100;
        assert!(record_completion(&mut player_progress, &simulation.state).is_some());
        assert!(record_completion(&mut player_progress, &simulation.state).is_none());
        simulation
            .apply(&command(&player, 0, CommandKind::Restart), &player_progress)
            .expect("restart");
        simulation.state.status = SessionStatus::Victory;
        simulation.state.score = 900;
        assert!(record_completion(&mut player_progress, &simulation.state).is_some());
        assert_eq!(player_progress.best_scores[0], 900);
        assert_eq!(player_progress.completed_sessions.len(), 2);
    }

    #[test]
    fn advance_level_is_an_atomic_host_only_victory_transition() {
        let host = PlayerId::new();
        let mut simulation =
            Simulation::create("c".into(), "Game".into(), host.clone(), "Host".into(), 7);
        let pad = scaled_build_pads(1, 1)[0];
        simulation
            .state
            .defenders
            .push(tower(&host, "zip_zapper", "base", 1, pad.x, pad.y));
        simulation
            .state
            .enemies
            .push(enemy_state("enemy", "basic", 0, 250, 50, 0, 1));
        simulation.state.pending_spawns.push(PendingSpawn {
            at_tick: 99,
            kind: "fast".into(),
            path: 0,
        });
        simulation.state.wave = 5;
        simulation.state.tick = 400;
        simulation.state.next_enemy = 12;
        simulation.state.defeated_enemies = 30;
        simulation.state.leaked_enemies = 2;
        simulation.state.members[0].ready = true;
        simulation.state.members[0].contribution = 900;
        complete_run(&mut simulation, 11, 4_200);
        let session_id = simulation.state.session_id.clone();
        let seed = simulation.state.seed;
        let mut stale_progress = progress(&host);
        stale_progress.unlocked_level = 1;

        simulation
            .apply(
                &command(&host, 0, CommandKind::AdvanceLevel),
                &stale_progress,
            )
            .expect("advance from authoritative victory");

        let level_two = levels()
            .into_iter()
            .find(|level| level.id == 2)
            .expect("level two");
        assert_eq!(simulation.state.session_id, session_id);
        assert_eq!(simulation.state.level, 2);
        assert_eq!(simulation.state.status, SessionStatus::Lobby);
        assert_eq!(simulation.state.attempt, 1);
        assert_eq!(simulation.state.base_health, level_two.base_health);
        assert_eq!(
            simulation.state.members[0].resources,
            level_two.scales[0].resource_per_player
        );
        assert!(!simulation.state.members[0].ready);
        assert_eq!(simulation.state.members[0].contribution, 0);
        assert!(simulation.state.defenders.is_empty());
        assert!(simulation.state.enemies.is_empty());
        assert!(simulation.state.pending_spawns.is_empty());
        assert_eq!(simulation.state.wave, 0);
        assert_eq!(simulation.state.tick, 0);
        assert_eq!(simulation.state.seed, seed + 1);
        assert_eq!(simulation.state.next_enemy, 0);
        assert_eq!(simulation.state.score, 0);
        assert_eq!(simulation.state.defeated_enemies, 0);
        assert_eq!(simulation.state.leaked_enemies, 0);
        assert_eq!(simulation.state.completion_receipts.len(), 1);
        assert_eq!(simulation.state.completion_receipts[0].level, 1);
        assert_eq!(simulation.state.completion_receipts[0].score, 4_200);
        assert_eq!(validate_snapshot(&simulation.state, "c"), Ok(()));
        let encoded = serde_json::to_string(&simulation.state).expect("serialize advanced lobby");
        let restored: SessionSnapshot =
            serde_json::from_str(&encoded).expect("restore advanced lobby");
        assert_eq!(restored, simulation.state);
        assert_eq!(validate_snapshot(&restored, "c"), Ok(()));
    }

    #[test]
    fn advance_level_rejects_wrong_role_state_and_final_level_without_mutation() {
        let host = PlayerId::new();
        let player = PlayerId::new();
        let mut simulation =
            Simulation::create("c".into(), "Game".into(), host.clone(), "Host".into(), 1);
        simulation
            .apply(
                &command(
                    &player,
                    0,
                    CommandKind::Join {
                        as_spectator: false,
                        display_name: "Player".into(),
                    },
                ),
                &progress(&player),
            )
            .expect("join");
        complete_run(&mut simulation, 20, 100);
        let before_role_rejection = simulation.state.clone();
        assert_eq!(
            simulation.apply(
                &command(&player, 1, CommandKind::AdvanceLevel),
                &progress(&player)
            ),
            Err(GameError::HostOnly)
        );
        assert_eq!(simulation.state, before_role_rejection);

        simulation.state.status = SessionStatus::Defeat;
        simulation.state.completion_receipts.clear();
        let before_state_rejection = simulation.state.clone();
        assert_eq!(
            simulation.apply(
                &command(&host, 1, CommandKind::AdvanceLevel),
                &progress(&host)
            ),
            Err(GameError::InvalidState)
        );
        assert_eq!(simulation.state, before_state_rejection);

        simulation.state.level = 5;
        simulation.state.base_health = levels()[4].base_health;
        complete_run(&mut simulation, levels()[4].base_health, 500);
        let before_final_rejection = simulation.state.clone();
        assert_eq!(
            simulation.apply(
                &command(&host, 1, CommandKind::AdvanceLevel),
                &progress(&host)
            ),
            Err(GameError::CampaignComplete)
        );
        assert_eq!(simulation.state, before_final_rejection);
    }

    #[test]
    fn advance_replay_and_stale_sequence_do_not_transition_twice() {
        let host = PlayerId::new();
        let mut simulation =
            Simulation::create("c".into(), "Game".into(), host.clone(), "Host".into(), 1);
        complete_run(&mut simulation, 20, 100);
        let advance = command(&host, 0, CommandKind::AdvanceLevel);
        simulation
            .apply(&advance, &progress(&host))
            .expect("first advance");
        let advanced = simulation.state.clone();
        assert_eq!(
            simulation.apply(&advance, &progress(&host)),
            Err(GameError::Duplicate)
        );
        assert_eq!(simulation.state, advanced);
        assert_eq!(
            simulation.apply(
                &command(&host, 0, CommandKind::AdvanceLevel),
                &progress(&host)
            ),
            Err(GameError::Conflict)
        );
        assert_eq!(simulation.state, advanced);
    }

    #[test]
    fn failed_run_limit_restart_does_not_capture_a_receipt() {
        let host = PlayerId::new();
        let mut simulation =
            Simulation::create("c".into(), "Game".into(), host.clone(), "Host".into(), 1);
        simulation.state.attempt = u32::MAX;
        simulation.state.status = SessionStatus::Victory;
        let before = simulation.state.clone();
        assert_eq!(
            simulation.apply(&command(&host, 0, CommandKind::Restart), &progress(&host)),
            Err(GameError::SessionRunLimit)
        );
        assert_eq!(simulation.state, before);
    }

    #[test]
    fn advanced_lobby_awards_a_departed_participant_exactly_once() {
        let host = PlayerId::new();
        let player = PlayerId::new();
        let unrelated = PlayerId::new();
        let mut simulation =
            Simulation::create("c".into(), "Game".into(), host.clone(), "Host".into(), 1);
        simulation
            .apply(
                &command(
                    &player,
                    0,
                    CommandKind::Join {
                        as_spectator: false,
                        display_name: "Player".into(),
                    },
                ),
                &progress(&player),
            )
            .expect("join");
        complete_run(&mut simulation, 14, 2_500);
        simulation
            .apply(
                &command(&host, 1, CommandKind::AdvanceLevel),
                &progress(&host),
            )
            .expect("advance");
        simulation
            .apply(&command(&player, 2, CommandKind::Leave), &progress(&player))
            .expect("depart after victory");
        assert_eq!(validate_snapshot(&simulation.state, "c"), Ok(()));

        let mut player_progress = progress(&player);
        player_progress.unlocked_level = 1;
        let first = record_completions(&mut player_progress, &simulation.state);
        assert!(first.latest_stars.is_some());
        assert!(first.progress_changed);
        assert_eq!(player_progress.unlocked_level, 2);
        assert_eq!(player_progress.cooperative_completions, 1);
        let replay = record_completions(&mut player_progress, &simulation.state);
        assert_eq!(replay.latest_stars, None);
        assert!(!replay.progress_changed);
        assert_eq!(player_progress.cooperative_completions, 1);

        let mut unrelated_progress = progress(&unrelated);
        let denied = record_completions(&mut unrelated_progress, &simulation.state);
        assert_eq!(denied, CompletionUpdate::default());
    }

    #[test]
    fn receipt_validation_and_legacy_migration_enforce_authoritative_completion() {
        let host = PlayerId::new();
        let mut legacy =
            Simulation::create("c".into(), "Game".into(), host.clone(), "Host".into(), 1);
        legacy.state.status = SessionStatus::Victory;
        legacy.state.score = 700;
        assert!(legacy.state.completion_receipts.is_empty());
        assert!(migrate_snapshot_content(&mut legacy.state));
        assert_eq!(legacy.state.completion_receipts.len(), 1);
        assert_eq!(validate_snapshot(&legacy.state, "c"), Ok(()));

        let mut running = legacy.state.clone();
        running.status = SessionStatus::Running;
        assert_eq!(
            validate_snapshot(&running, "c"),
            Err(ValidationError::Entities)
        );

        let mut forged = legacy.state.clone();
        forged.completion_receipts[0].score += 1;
        assert!(!migrate_snapshot_content(&mut forged));
        assert_eq!(
            validate_snapshot(&forged, "c"),
            Err(ValidationError::Entities)
        );

        let mut unknown_participant = legacy.state.clone();
        unknown_participant.completion_receipts[0]
            .participants
            .push(PlayerId("unknown".into()));
        assert_eq!(
            validate_snapshot(&unknown_participant, "c"),
            Err(ValidationError::Entities)
        );
    }

    #[test]
    fn bounded_mixed_completion_history_stays_valid_and_replay_safe() {
        let player = PlayerId::new();
        let teammate = PlayerId::new();
        let mut player_progress = progress(&player);
        let mut earliest = None;
        for session_index in 0_u32..64 {
            let session_id = SessionId(format!("session-{session_index}"));
            for attempt in 0_u32..5 {
                let receipt = CompletionReceipt {
                    run_id: completion_run_id(&session_id, attempt),
                    attempt,
                    level: 1,
                    base_health: 20,
                    score: session_index * 100 + attempt,
                    participants: if attempt.is_multiple_of(2) {
                        vec![player.clone(), teammate.clone()]
                    } else {
                        vec![player.clone()]
                    },
                };
                if earliest.is_none() {
                    earliest = Some((session_id.clone(), receipt.clone()));
                }
                assert!(
                    award_completion(&mut player_progress, &session_id, &receipt)
                        .latest_stars
                        .is_some()
                );
            }
        }
        assert_eq!(player_progress.completed_sessions.len(), MAX_REPLAY_IDS);
        assert!(player_progress.completion_cursors.len() <= 64);
        assert_eq!(validate_progress(&player_progress, &player), Ok(()));
        let cooperative_before = player_progress.cooperative_completions;
        let (session_id, receipt) = earliest.expect("earliest receipt");
        assert_eq!(
            award_completion(&mut player_progress, &session_id, &receipt),
            CompletionUpdate::default()
        );
        assert_eq!(player_progress.cooperative_completions, cooperative_before);
    }

    #[test]
    fn persisted_member_roles_must_match_slots_and_host_identity() {
        let host = PlayerId::new();
        let mut simulation =
            Simulation::create("channel".into(), "Game".into(), host, "Host".into(), 1);
        simulation.state.members[0].role = MemberRole::Spectator;
        assert_eq!(
            validate_snapshot(&simulation.state, "channel"),
            Err(ValidationError::Members)
        );
    }

    #[test]
    fn persisted_enemies_and_pending_spawns_must_use_an_active_lane() {
        let host = PlayerId::new();
        let simulation = Simulation::create("c".into(), "Game".into(), host, "Host".into(), 1);
        assert_eq!(simulation.state.scale_players, 1);
        assert_eq!(level_scale(1, 1).expect("level one scale").paths, 1);

        let mut enemy_snapshot = simulation.state.clone();
        enemy_snapshot
            .enemies
            .push(enemy_state("enemy-invalid-lane", "basic", 1, 0, 64, 0, 1));
        assert_eq!(
            validate_snapshot(&enemy_snapshot, "c"),
            Err(ValidationError::Entities)
        );

        let mut pending_snapshot = simulation.state;
        pending_snapshot.pending_spawns.push(PendingSpawn {
            at_tick: 1,
            kind: "basic".into(),
            path: 1,
        });
        assert_eq!(
            validate_snapshot(&pending_snapshot, "c"),
            Err(ValidationError::Entities)
        );
    }

    #[test]
    fn control_resistance_round_trips_and_rejects_forged_bounds() {
        let host = PlayerId::new();
        let mut simulation = Simulation::create("c".into(), "Game".into(), host, "Host".into(), 1);
        let mut enemy = enemy_state("recovering", "armored", 0, 500, 200, 60, 2);
        enemy.control_resistance_ticks = KNOCKBACK_RESISTANCE_TICKS - 1;
        simulation.state.enemies.push(enemy);

        let encoded = serde_json::to_string(&simulation.state).expect("serialize recovery state");
        let restored: SessionSnapshot =
            serde_json::from_str(&encoded).expect("restore recovery state");
        assert_eq!(
            restored.enemies[0].control_resistance_ticks,
            KNOCKBACK_RESISTANCE_TICKS - 1
        );
        assert_eq!(validate_snapshot(&restored, "c"), Ok(()));

        simulation.state.enemies[0].control_resistance_ticks = BOSS_KNOCKBACK_RESISTANCE_TICKS + 1;
        assert_eq!(
            validate_snapshot(&simulation.state, "c"),
            Err(ValidationError::Entities)
        );
    }

    #[test]
    fn legacy_backyard_pads_and_second_lane_migrate_before_validation() {
        let host = PlayerId::new();
        let mut simulation = Simulation::create(
            "c".into(),
            "Migrated backyard".into(),
            host.clone(),
            "Host".into(),
            1,
        );
        simulation.state.status = SessionStatus::BetweenWaves;
        let first_current_pad = build_pads(1)[0];
        simulation
            .apply(
                &command(
                    &host,
                    0,
                    CommandKind::Place {
                        defender: "zip_zapper".into(),
                        x: first_current_pad.x,
                        y: first_current_pad.y,
                    },
                ),
                &progress(&host),
            )
            .expect("place current defender");
        simulation.state.defenders[0].x = LEGACY_BACKYARD_PADS[0].x;
        simulation.state.defenders[0].y = LEGACY_BACKYARD_PADS[0].y;
        simulation
            .state
            .enemies
            .push(enemy_state("legacy-enemy", "basic", 1, 500, 64, 0, 1));
        simulation.state.movement_version = 0;
        simulation.state.pending_spawns.push(PendingSpawn {
            at_tick: 10,
            kind: "fast".into(),
            path: 1,
        });

        assert_eq!(
            validate_snapshot(&simulation.state, "c"),
            Err(ValidationError::Content)
        );
        assert!(migrate_snapshot_content(&mut simulation.state));
        assert_eq!(
            (
                simulation.state.defenders[0].x,
                simulation.state.defenders[0].y
            ),
            (first_current_pad.x, first_current_pad.y)
        );
        assert_eq!(simulation.state.enemies[0].path, 0);
        assert_eq!(simulation.state.movement_version, MOVEMENT_VERSION);
        assert_eq!(
            simulation.state.enemies[0].progress,
            legacy_progress_to_arc_progress(1, 0, 500)
        );
        assert_eq!(simulation.state.pending_spawns[0].path, 0);
        assert_eq!(validate_snapshot(&simulation.state, "c"), Ok(()));
        assert!(!migrate_snapshot_content(&mut simulation.state));
    }

    #[test]
    fn school_v1_live_enemy_positions_migrate_to_v2_once() {
        let host = PlayerId::new();
        let mut simulation =
            Simulation::create("c".into(), "Migrated school".into(), host, "Host".into(), 2);
        simulation.state.level = 2;
        simulation.state.scale_players = 2;
        simulation.state.status = SessionStatus::Running;
        simulation.state.movement_version = 1;
        simulation.state.enemies = vec![
            enemy_state("school-v1-a", "basic", 0, 500, 64, 0, 1),
            enemy_state("school-v1-b", "fast", 1, 500, 42, 0, 1),
        ];

        let legacy_positions = simulation
            .state
            .enemies
            .iter()
            .map(|enemy| {
                legacy_school_v1_arc_position_precise(enemy.path, enemy.progress)
                    .expect("legacy school lane")
            })
            .collect::<Vec<_>>();
        let expected_progress = simulation
            .state
            .enemies
            .iter()
            .zip(&legacy_positions)
            .map(|(enemy, position)| {
                nearest_route_progress(2, enemy.path, *position)
                    .expect("current school lane")
                    .0
            })
            .collect::<Vec<_>>();

        assert!(migrate_snapshot_content(&mut simulation.state));
        assert_eq!(simulation.state.movement_version, MOVEMENT_VERSION);
        for ((enemy, legacy_position), expected) in simulation
            .state
            .enemies
            .iter()
            .zip(&legacy_positions)
            .zip(expected_progress)
        {
            assert_eq!(enemy.progress, expected);
            assert_ne!(enemy.progress, 500, "redrawn route must remap progress");
            let migrated_position = path_position_precise(2, enemy.path, enemy.progress);
            let dx = i64::from(migrated_position.x) - i64::from(legacy_position.x);
            let dy = i64::from(migrated_position.y) - i64::from(legacy_position.y);
            let tolerance = i64::from(PATH_POSITION_SCALE) * 2;
            assert!(dx * dx + dy * dy <= tolerance * tolerance);
        }
        assert_eq!(validate_snapshot(&simulation.state, "c"), Ok(()));

        let migrated = simulation.state.clone();
        assert!(!migrate_snapshot_content(&mut simulation.state));
        assert_eq!(simulation.state, migrated);
    }

    #[test]
    fn school_v0_segment_progress_migrates_directly_to_v2() {
        let host = PlayerId::new();
        let mut simulation = Simulation::create(
            "c".into(),
            "Migrated old school".into(),
            host,
            "Host".into(),
            3,
        );
        simulation.state.level = 2;
        simulation.state.scale_players = 2;
        simulation.state.status = SessionStatus::Running;
        simulation.state.movement_version = 0;
        simulation.state.enemies = vec![
            enemy_state("school-v0-a", "basic", 0, 500, 64, 0, 1),
            enemy_state("school-v0-b", "fast", 1, 500, 42, 0, 1),
        ];

        let expected = simulation
            .state
            .enemies
            .iter()
            .map(|enemy| {
                let legacy = legacy_school_v0_segment_position_precise(enemy.path, enemy.progress)
                    .expect("legacy segment-index lane");
                let projected = nearest_route_progress(2, enemy.path, legacy)
                    .expect("current school lane")
                    .0;
                (legacy, projected)
            })
            .collect::<Vec<_>>();

        assert!(migrate_snapshot_content(&mut simulation.state));
        assert_eq!(simulation.state.movement_version, MOVEMENT_VERSION);
        for (enemy, (legacy_position, expected_progress)) in
            simulation.state.enemies.iter().zip(expected)
        {
            assert_eq!(enemy.progress, expected_progress);
            let migrated_position = path_position_precise(2, enemy.path, enemy.progress);
            let dx = i64::from(migrated_position.x) - i64::from(legacy_position.x);
            let dy = i64::from(migrated_position.y) - i64::from(legacy_position.y);
            let tolerance = i64::from(PATH_POSITION_SCALE) * 2;
            assert!(dx * dx + dy * dy <= tolerance * tolerance);
        }
        assert_eq!(validate_snapshot(&simulation.state, "c"), Ok(()));
    }

    #[test]
    fn only_host_controls_session_state() {
        let host = PlayerId::new();
        let player = PlayerId::new();
        let mut simulation =
            Simulation::create("c".into(), "Game".into(), host.clone(), "A".into(), 1);
        simulation
            .apply(
                &command(
                    &player,
                    0,
                    CommandKind::Join {
                        as_spectator: false,
                        display_name: "B".into(),
                    },
                ),
                &progress(&player),
            )
            .expect("player joins");
        assert_eq!(
            simulation.apply(
                &command(&player, 1, CommandKind::SelectLevel { level: 2 }),
                &progress(&player)
            ),
            Err(GameError::HostOnly)
        );
    }

    #[test]
    fn victory_updates_progression_and_unlocks_content() {
        let player = PlayerId::new();
        let mut simulation =
            Simulation::create("c".into(), "Game".into(), player.clone(), "A".into(), 1);
        simulation.state.status = SessionStatus::Victory;
        simulation.state.base_health = 18;
        simulation.state.score = 2_400;
        let mut player_progress = Progress {
            schema_version: 1,
            player_id: player,
            unlocked_level: 1,
            unlocked_defenders: vec![
                "zip_zapper".into(),
                "caps_lock".into(),
                "buffer_buddy".into(),
            ],
            best_stars: [0; 5],
            best_scores: [0; 5],
            cooperative_completions: 0,
            completed_sessions: vec![],
            completed_cooperative_runs: vec![],
            completion_cursors: vec![],
        };
        assert_eq!(
            record_completion(&mut player_progress, &simulation.state),
            Some(3)
        );
        assert_eq!(player_progress.unlocked_level, 2);
        assert!(
            player_progress
                .unlocked_defenders
                .contains(&"deep_scroller".into())
        );
        assert_eq!(player_progress.best_scores[0], 2_400);
    }

    #[test]
    fn prior_level_completion_unlocks_next_level_at_any_star_rating() {
        let player = PlayerId::new();
        let mut simulation =
            Simulation::create("c".into(), "Game".into(), player.clone(), "A".into(), 1);
        simulation.state.status = SessionStatus::Victory;
        simulation.state.base_health = 1;
        let mut player_progress = Progress {
            schema_version: 1,
            player_id: player,
            unlocked_level: 1,
            unlocked_defenders: vec![
                "zip_zapper".into(),
                "caps_lock".into(),
                "buffer_buddy".into(),
            ],
            best_stars: [0; 5],
            best_scores: [0; 5],
            cooperative_completions: 0,
            completed_sessions: vec![],
            completed_cooperative_runs: vec![],
            completion_cursors: vec![],
        };

        assert_eq!(
            record_completion(&mut player_progress, &simulation.state),
            Some(1)
        );
        assert_eq!(player_progress.unlocked_level, 2);
        assert_eq!(player_progress.best_stars[0], 1);
    }

    #[test]
    fn level_availability_restricts_defenders_even_when_progress_has_unlocked_them() {
        let player = PlayerId::new();
        let mut simulation =
            Simulation::create("c".into(), "Game".into(), player.clone(), "A".into(), 1);
        simulation.state.status = SessionStatus::BetweenWaves;
        simulation.state.members[0].resources = 10_000;
        let pad = scaled_build_pads(1, 1)[0];
        assert_eq!(
            simulation.apply(
                &command(
                    &player,
                    0,
                    CommandKind::Place {
                        defender: "final_form".into(),
                        x: pad.x,
                        y: pad.y,
                    },
                ),
                &progress(&player),
            ),
            Err(GameError::Locked)
        );
        simulation
            .state
            .defenders
            .push(tower(&player, "final_form", "base", 1, pad.x, pad.y));
        assert_eq!(
            validate_snapshot(&simulation.state, "c"),
            Err(ValidationError::Entities)
        );
    }

    #[test]
    fn upgrade_branch_is_committed_after_the_first_purchase() {
        let player = PlayerId::new();
        let mut simulation =
            Simulation::create("c".into(), "Game".into(), player.clone(), "A".into(), 1);
        simulation.state.status = SessionStatus::BetweenWaves;
        simulation.state.members[0].resources = 10_000;
        let pad = scaled_build_pads(1, 1)[0];
        simulation
            .state
            .defenders
            .push(tower(&player, "zip_zapper", "base", 1, pad.x, pad.y));
        let entity_id = simulation.state.defenders[0].id.clone();
        simulation
            .apply(
                &command(
                    &player,
                    0,
                    CommandKind::Upgrade {
                        entity_id: entity_id.clone(),
                        path: "Overclock".into(),
                    },
                ),
                &progress(&player),
            )
            .expect("first branch purchase");
        assert_eq!(simulation.state.defenders[0].path, "Overclock");
        assert_eq!(simulation.state.defenders[0].level, 2);
        assert_eq!(
            simulation.apply(
                &command(
                    &player,
                    1,
                    CommandKind::Upgrade {
                        entity_id: entity_id.clone(),
                        path: "Chain Ping".into(),
                    },
                ),
                &progress(&player),
            ),
            Err(GameError::UpgradeBranch)
        );
        for (sequence, expected_level) in [(1, 3), (2, 4), (3, 5)] {
            simulation
                .apply(
                    &command(
                        &player,
                        sequence,
                        CommandKind::Upgrade {
                            entity_id: entity_id.clone(),
                            path: "Overclock".into(),
                        },
                    ),
                    &progress(&player),
                )
                .expect("next authored tier on committed branch");
            assert_eq!(simulation.state.defenders[0].level, expected_level);
        }
        assert_eq!(simulation.state.members[0].resources, 10_000 - 740);
        assert_eq!(
            simulation.apply(
                &command(
                    &player,
                    4,
                    CommandKind::Upgrade {
                        entity_id: entity_id.clone(),
                        path: "Overclock".into(),
                    },
                ),
                &progress(&player),
            ),
            Err(GameError::MaxUpgrade)
        );
        let before_sell = simulation.state.members[0].resources;
        simulation
            .apply(
                &command(&player, 4, CommandKind::Sell { entity_id }),
                &progress(&player),
            )
            .expect("fully upgraded defender sells");
        assert_eq!(
            simulation.state.members[0].resources - before_sell,
            (90 + 110 + 155 + 205 + 270) / 2
        );
    }

    #[test]
    fn authored_upgrade_tiers_are_exactly_charged_and_replay_safe() {
        let player = PlayerId::new();
        let mut simulation =
            Simulation::create("c".into(), "Game".into(), player.clone(), "A".into(), 1);
        simulation.state.status = SessionStatus::BetweenWaves;
        simulation.state.members[0].resources = 10_000;
        let pad = scaled_build_pads(1, 1)[0];
        simulation
            .state
            .defenders
            .push(tower(&player, "zip_zapper", "base", 1, pad.x, pad.y));
        let entity_id = simulation.state.defenders[0].id.clone();
        let first = command(
            &player,
            0,
            CommandKind::Upgrade {
                entity_id: entity_id.clone(),
                path: "Overclock".into(),
            },
        );
        let before_first = simulation.state.members[0].resources;
        simulation
            .apply(&first, &progress(&player))
            .expect("first authored tier");
        assert_eq!(before_first - simulation.state.members[0].resources, 110);

        let after_first = simulation.state.clone();
        assert_eq!(
            simulation.apply(&first, &progress(&player)),
            Err(GameError::Duplicate)
        );
        assert_eq!(simulation.state, after_first);
        assert_eq!(
            simulation.apply(
                &command(
                    &player,
                    0,
                    CommandKind::Upgrade {
                        entity_id: entity_id.clone(),
                        path: "Overclock".into(),
                    },
                ),
                &progress(&player),
            ),
            Err(GameError::Conflict)
        );
        assert_eq!(simulation.state, after_first);

        let wrong_branch = simulation.state.clone();
        assert_eq!(
            simulation.apply(
                &command(
                    &player,
                    1,
                    CommandKind::Upgrade {
                        entity_id: entity_id.clone(),
                        path: "Chain Ping".into(),
                    },
                ),
                &progress(&player),
            ),
            Err(GameError::UpgradeBranch)
        );
        assert_eq!(simulation.state, wrong_branch);

        let next_cost = next_upgrade_tier("zip_zapper", "Overclock", 2)
            .expect("second authored tier")
            .cost;
        simulation.state.members[0].resources = next_cost - 1;
        let insufficient = simulation.state.clone();
        assert_eq!(
            simulation.apply(
                &command(
                    &player,
                    1,
                    CommandKind::Upgrade {
                        entity_id: entity_id.clone(),
                        path: "Overclock".into(),
                    },
                ),
                &progress(&player),
            ),
            Err(GameError::Resources)
        );
        assert_eq!(simulation.state, insufficient);
        simulation.state.members[0].resources = 10_000;

        for sequence in 1..=3 {
            let level = simulation.state.defenders[0].level;
            let cost = next_upgrade_tier("zip_zapper", "Overclock", level)
                .expect("remaining authored tier")
                .cost;
            let resources = simulation.state.members[0].resources;
            simulation
                .apply(
                    &command(
                        &player,
                        sequence,
                        CommandKind::Upgrade {
                            entity_id: entity_id.clone(),
                            path: "Overclock".into(),
                        },
                    ),
                    &progress(&player),
                )
                .expect("remaining authored purchase");
            assert_eq!(resources - simulation.state.members[0].resources, cost);
        }
        assert_eq!(simulation.state.defenders[0].level, MAX_DEFENDER_LEVEL);

        let serialized = serde_json::to_string(&simulation.state).expect("serialize max tower");
        let restored: SessionSnapshot =
            serde_json::from_str(&serialized).expect("restore max tower");
        let mut restored = Simulation::from_snapshot(restored);
        assert_eq!(
            restored.apply(&first, &progress(&player)),
            Err(GameError::Duplicate),
            "accepted upgrade IDs remain replay-protected after reload"
        );
        let before_max = restored.state.clone();
        assert_eq!(
            restored.apply(
                &command(
                    &player,
                    4,
                    CommandKind::Upgrade {
                        entity_id,
                        path: "Overclock".into(),
                    },
                ),
                &progress(&player),
            ),
            Err(GameError::MaxUpgrade)
        );
        assert_eq!(restored.state, before_max);
    }

    #[test]
    fn selling_at_the_resource_ceiling_saturates_without_losing_currency() {
        let player = PlayerId::new();
        let mut simulation =
            Simulation::create("c".into(), "Game".into(), player.clone(), "A".into(), 1);
        simulation.state.status = SessionStatus::BetweenWaves;
        simulation.state.members[0].resources = u32::MAX;
        let pad = scaled_build_pads(1, 1)[0];
        simulation.state.defenders.push(tower(
            &player,
            "zip_zapper",
            "Overclock",
            MAX_DEFENDER_LEVEL,
            pad.x,
            pad.y,
        ));
        assert_eq!(validate_snapshot(&simulation.state, "c"), Ok(()));
        let entity_id = simulation.state.defenders[0].id.clone();

        simulation
            .apply(
                &command(&player, 0, CommandKind::Sell { entity_id }),
                &progress(&player),
            )
            .expect("sale at the resource ceiling");

        assert_eq!(simulation.state.members[0].resources, u32::MAX);
        assert!(simulation.state.defenders.is_empty());
        assert_eq!(simulation.state.last_sequence, 1);
    }

    #[test]
    fn persisted_upgrade_levels_accept_five_and_reject_six() {
        let player = PlayerId::new();
        let mut simulation =
            Simulation::create("c".into(), "Game".into(), player.clone(), "A".into(), 1);
        let pad = scaled_build_pads(1, 1)[0];
        simulation.state.defenders.push(tower(
            &player,
            "zip_zapper",
            "Overclock",
            MAX_DEFENDER_LEVEL,
            pad.x,
            pad.y,
        ));
        assert_eq!(validate_snapshot(&simulation.state, "c"), Ok(()));

        let serialized = serde_json::to_string(&simulation.state).expect("serialize level five");
        let restored: SessionSnapshot =
            serde_json::from_str(&serialized).expect("restore level five");
        assert_eq!(restored.defenders[0].level, MAX_DEFENDER_LEVEL);
        assert_eq!(restored.defenders[0].path, "Overclock");
        assert_eq!(validate_snapshot(&restored, "c"), Ok(()));

        simulation.state.defenders[0].level = MAX_DEFENDER_LEVEL + 1;
        assert_eq!(
            validate_snapshot(&simulation.state, "c"),
            Err(ValidationError::Entities)
        );

        for (level, path, expected) in [
            (0, "base", Err(ValidationError::Entities)),
            (1, "base", Ok(())),
            (1, "Overclock", Err(ValidationError::Entities)),
            (2, "base", Err(ValidationError::Entities)),
            (2, "unknown", Err(ValidationError::Entities)),
            (2, "Overclock", Ok(())),
            (3, "Overclock", Ok(())),
            (4, "Overclock", Ok(())),
            (5, "Overclock", Ok(())),
            (6, "Overclock", Err(ValidationError::Entities)),
        ] {
            simulation.state.defenders[0].level = level;
            simulation.state.defenders[0].path = path.into();
            assert_eq!(
                validate_snapshot(&simulation.state, "c"),
                expected,
                "level {level} path {path}"
            );
        }
    }

    #[test]
    fn every_upgrade_path_changes_stats_or_adds_a_unique_mechanic() {
        let player = PlayerId::new();
        for definition in defenders() {
            let base =
                effective_defender(&definition, &tower(&player, definition.id, "base", 1, 0, 0));
            for path in definition.upgrade_paths {
                let mut prior = base;
                for level in 2..=MAX_DEFENDER_LEVEL {
                    let current = effective_defender(
                        &definition,
                        &tower(&player, definition.id, path, level, 0, 0),
                    );
                    assert_ne!(
                        prior, current,
                        "{} {path} level {level} must add a real effect",
                        definition.id
                    );
                    prior = current;
                }
            }
            let first_max = effective_defender(
                &definition,
                &tower(
                    &player,
                    definition.id,
                    definition.upgrade_paths[0],
                    MAX_DEFENDER_LEVEL,
                    0,
                    0,
                ),
            );
            let second_max = effective_defender(
                &definition,
                &tower(
                    &player,
                    definition.id,
                    definition.upgrade_paths[1],
                    MAX_DEFENDER_LEVEL,
                    0,
                    0,
                ),
            );
            assert_ne!(first_max, second_max, "{} max branch choice", definition.id);
        }
    }

    #[test]
    fn low_damage_and_leak_guard_tiers_match_their_authored_effects_exactly() {
        let player = PlayerId::new();
        let buffer = defenders()
            .into_iter()
            .find(|defender| defender.id == "buffer_buddy")
            .expect("buffer buddy content");
        for (path, expected_damage) in [
            ("Long Pause", [5, 6, 7, 8, 9]),
            ("Hard Refresh", [5, 6, 7, 8, 10]),
        ] {
            for (level_index, expected) in expected_damage.into_iter().enumerate() {
                let level = u8::try_from(level_index + 1).expect("authored level");
                let state_path = if level == 1 { "base" } else { path };
                let stats = effective_defender(
                    &buffer,
                    &tower(&player, buffer.id, state_path, level, 0, 0),
                );
                assert_eq!(
                    stats.damage, expected,
                    "{path} level {level} damage must match its whole-damage copy"
                );
            }
        }

        let final_form = defenders()
            .into_iter()
            .find(|defender| defender.id == "final_form")
            .expect("final form content");
        for (level, guard) in [(2, 1), (3, 2), (4, 3), (5, 4)] {
            let stats = effective_defender(
                &final_form,
                &tower(&player, final_form.id, "Plot Armor", level, 0, 0),
            );
            assert_eq!(
                stats.mechanic,
                Some(UpgradeMechanic::LeakGuard { damage: guard }),
                "Plot Armor level {level} must strictly strengthen leak protection"
            );
        }
    }

    #[test]
    fn enraged_boss_lane_shift_never_teleports_between_disconnected_trails() {
        let player = PlayerId::new();
        let mut simulation = Simulation::create("c".into(), "Game".into(), player, "A".into(), 5);
        simulation.state.status = SessionStatus::Running;
        simulation.state.tick = u64::from(
            level_scale(5, 1)
                .expect("final level scale")
                .boss_phase_ticks,
        );
        let mut boss = enemy_state("boss", "boss", 0, 200, 800, 35, 6);
        boss.max_health = 1_650;
        boss.slowed_ticks = 1;
        simulation.state.enemies.push(boss);

        let before = path_position_precise(5, 0, 200);
        simulation.move_enemies();
        let boss = &simulation.state.enemies[0];
        let after = path_position_precise(5, boss.path, boss.progress);
        let dx = i64::from(after.x) - i64::from(before.x);
        let dy = i64::from(after.y) - i64::from(before.y);
        let maximum = i64::from(PATH_POSITION_SCALE) * 5;

        assert_eq!(boss.path, 0, "distant route must wait for a physical merge");
        assert_eq!(boss.progress, 201, "slow applies after the enrage bonus");
        assert!(dx * dx + dy * dy <= maximum * maximum);
    }

    #[test]
    fn chain_knockback_and_armor_shred_apply_their_authored_mechanics() {
        let player = PlayerId::new();
        let point = path_position(1, 0, 500);

        let mut chain = combat_simulation(&player);
        chain.state.defenders.push(tower(
            &player,
            "zip_zapper",
            "Chain Ping",
            2,
            point.x,
            point.y,
        ));
        chain
            .state
            .enemies
            .push(enemy_state("a", "basic", 0, 500, 100, 0, 1));
        chain
            .state
            .enemies
            .push(enemy_state("b", "basic", 0, 505, 100, 0, 1));
        chain.run_defenders();
        assert!(chain.state.enemies.iter().all(|enemy| enemy.health < 100));

        let mut refresh = combat_simulation(&player);
        refresh.state.defenders.push(tower(
            &player,
            "buffer_buddy",
            "Hard Refresh",
            2,
            point.x,
            point.y,
        ));
        refresh
            .state
            .enemies
            .push(enemy_state("refresh", "basic", 0, 500, 100, 0, 1));
        refresh.run_defenders();
        assert_eq!(refresh.state.enemies[0].progress, 476);
        assert!(refresh.state.enemies[0].slowed_ticks > 0);
        assert_eq!(
            refresh.state.enemies[0].control_resistance_ticks,
            KNOCKBACK_RESISTANCE_TICKS
        );

        refresh.state.defenders[0].cooldown_ticks = 0;
        refresh.run_defenders();
        assert_eq!(
            refresh.state.enemies[0].progress, 476,
            "the recovery window must reject repeated rewind"
        );

        let mut receipts = combat_simulation(&player);
        receipts.state.defenders.push(tower(
            &player,
            "deep_scroller",
            "Receipts",
            2,
            point.x,
            point.y,
        ));
        receipts
            .state
            .enemies
            .push(enemy_state("receipts", "armored", 0, 500, 200, 60, 2));
        receipts.run_defenders();
        assert_eq!(receipts.state.enemies[0].armor, 45);
    }

    #[test]
    fn max_hard_refresh_cannot_permanently_rewind_a_slow_enemy() {
        let player = PlayerId::new();
        let point = path_position(1, 0, 500);
        for (enemy_kind, resistance_ticks) in [
            ("armored", KNOCKBACK_RESISTANCE_TICKS),
            ("boss", BOSS_KNOCKBACK_RESISTANCE_TICKS),
        ] {
            let mut refresh = combat_simulation(&player);
            refresh.state.defenders.push(tower(
                &player,
                "buffer_buddy",
                "Hard Refresh",
                MAX_DEFENDER_LEVEL,
                point.x,
                point.y,
            ));
            let mut second = tower(
                &player,
                "buffer_buddy",
                "Hard Refresh",
                MAX_DEFENDER_LEVEL,
                point.x,
                point.y,
            );
            second.id = EntityId("second-refresh".into());
            refresh.state.defenders.push(second);
            let mut enemy = enemy_state(
                enemy_kind,
                enemy_kind,
                0,
                500,
                100_000,
                if enemy_kind == "armored" { 60 } else { 0 },
                2,
            );
            enemy.max_health = 100_000;
            refresh.state.enemies.push(enemy);

            let mut prior_progress = 500;
            for _ in 0..2 {
                for defender in &mut refresh.state.defenders {
                    defender.cooldown_ticks = 0;
                }
                refresh.run_defenders();
                assert_eq!(
                    refresh.state.enemies[0].control_resistance_ticks, resistance_ticks,
                    "the second tower must not reset {enemy_kind} resistance"
                );
                for _ in 0..resistance_ticks {
                    refresh.move_enemies();
                }
                assert!(
                    refresh.state.enemies[0].progress > prior_progress,
                    "{enemy_kind} must make net route progress between knockbacks"
                );
                prior_progress = refresh.state.enemies[0].progress;
            }
        }
    }

    #[test]
    fn missing_health_and_distance_paths_change_live_damage() {
        let player = PlayerId::new();
        let point = path_position(1, 0, 500);
        let simulation = combat_simulation(&player);

        let rage = tower(&player, "caps_lock", "Rage Post", 2, point.x, point.y);
        let rage_definition = defenders()
            .into_iter()
            .find(|defender| defender.id == "caps_lock")
            .expect("caps lock content");
        let rage_stats = effective_defender(&rage_definition, &rage);
        let full = enemy_state("full", "basic", 0, 500, 100, 0, 1);
        let mut injured = enemy_state("injured", "basic", 0, 500, 20, 0, 1);
        injured.max_health = 100;
        let mut executable = enemy_state("execute", "basic", 0, 500, 5, 0, 1);
        executable.max_health = 100;
        let (full_damage, _) = simulation.upgraded_raw_damage(&rage, &full, rage_stats, 100);
        let (injured_damage, _) = simulation.upgraded_raw_damage(&rage, &injured, rage_stats, 100);
        let (_, execute) = simulation.upgraded_raw_damage(&rage, &executable, rage_stats, 100);
        assert!(injured_damage > full_damage);
        assert!(execute);

        let zoom_near = tower(&player, "deep_scroller", "Zoom Lens", 2, point.x, point.y);
        let zoom_definition = defenders()
            .into_iter()
            .find(|defender| defender.id == "deep_scroller")
            .expect("deep scroller content");
        let zoom_stats = effective_defender(&zoom_definition, &zoom_near);
        let zoom_far = tower(
            &player,
            "deep_scroller",
            "Zoom Lens",
            2,
            point.x.saturating_add(zoom_stats.range),
            point.y,
        );
        let (near_damage, _) = simulation.upgraded_raw_damage(&zoom_near, &full, zoom_stats, 100);
        let (far_damage, _) = simulation.upgraded_raw_damage(&zoom_far, &full, zoom_stats, 100);
        assert!(far_damage > near_damage);
    }

    #[test]
    fn economy_paths_split_personal_and_team_payouts() {
        let owner = PlayerId::new();
        let teammate = PlayerId::new();
        let point = scaled_build_pads(1, 2)[0];
        let mut passive = combat_simulation(&owner);
        passive.state.members.push(Member {
            player_id: teammate.clone(),
            display_name: "B".into(),
            role: MemberRole::Player,
            slot: Some(1),
            ready: true,
            resources: 0,
            contribution: 0,
        });
        passive.state.defenders.push(tower(
            &owner,
            "side_hustler",
            "Passive Income",
            2,
            point.x,
            point.y,
        ));
        passive.run_defenders();
        assert_eq!(passive.state.members[0].resources, 26);
        assert_eq!(passive.state.members[1].resources, 0);

        let mut brand = combat_simulation(&owner);
        brand.state.members.push(Member {
            player_id: teammate,
            display_name: "B".into(),
            role: MemberRole::Player,
            slot: Some(1),
            ready: true,
            resources: 0,
            contribution: 0,
        });
        brand.state.defenders.push(tower(
            &owner,
            "side_hustler",
            "Brand Deal",
            2,
            point.x,
            point.y,
        ));
        brand.run_defenders();
        assert_eq!(brand.state.members[0].resources, 25);
        assert_eq!(brand.state.members[1].resources, 17);
    }

    #[test]
    fn final_form_paths_split_boss_offense_and_base_defense() {
        let player = PlayerId::new();
        let point = path_position(1, 0, 500);
        let mut main_character = combat_simulation(&player);
        main_character.state.defenders.push(tower(
            &player,
            "final_form",
            "Main Character",
            2,
            point.x,
            point.y,
        ));
        main_character
            .state
            .enemies
            .push(enemy_state("boss", "boss", 0, 500, 1_000, 0, 6));
        main_character.run_defenders();

        let mut plot_armor = combat_simulation(&player);
        plot_armor.state.defenders.push(tower(
            &player,
            "final_form",
            "Plot Armor",
            2,
            point.x,
            point.y,
        ));
        plot_armor
            .state
            .enemies
            .push(enemy_state("boss", "boss", 0, 500, 1_000, 0, 6));
        plot_armor.run_defenders();
        assert!(
            main_character.state.enemies[0].health < plot_armor.state.enemies[0].health,
            "Main Character must be the stronger boss-damage branch"
        );

        main_character.state.enemies =
            vec![enemy_state("leak-main", "armored", 0, 1_000, 100, 0, 3)];
        plot_armor.state.enemies = vec![enemy_state("leak-plot", "armored", 0, 1_000, 100, 0, 3)];
        main_character.resolve_enemies();
        plot_armor.resolve_enemies();
        assert_eq!(main_character.state.base_health, 17);
        assert_eq!(plot_armor.state.base_health, 18);
    }

    #[test]
    fn plot_armor_uses_the_strongest_guard_and_never_erases_a_leak() {
        let player = PlayerId::new();
        let mut simulation = combat_simulation(&player);
        let pads = scaled_build_pads(1, 1);
        simulation.state.defenders.push(tower(
            &player,
            "final_form",
            "Plot Armor",
            MAX_DEFENDER_LEVEL,
            pads[0].x,
            pads[0].y,
        ));
        simulation.state.defenders.push(tower(
            &player,
            "final_form",
            "Plot Armor",
            MAX_DEFENDER_LEVEL,
            pads[1].x,
            pads[1].y,
        ));
        simulation.state.enemies = vec![
            enemy_state("guarded", "boss", 0, 1_000, 100, 0, 6),
            enemy_state("minimum", "basic", 0, 1_000, 100, 0, 1),
        ];

        simulation.resolve_enemies();

        assert_eq!(simulation.state.base_health, 17);
        assert_eq!(simulation.state.leaked_enemies, 2);
    }

    #[test]
    fn school_enemies_leak_only_after_reaching_the_server_room_on_both_lanes() {
        let player = PlayerId::new();
        let mut simulation = combat_simulation(&player);
        simulation.state.level = 2;
        simulation.state.scale_players = 2;
        simulation.state.enemies = vec![
            enemy_state("school-upper", "basic", 0, 999, 100, 0, 1),
            enemy_state("school-lower", "basic", 1, 999, 100, 0, 1),
        ];

        simulation.move_enemies();
        for enemy in &simulation.state.enemies {
            assert_eq!(
                path_position(2, enemy.path, enemy.progress),
                Point { x: 1000, y: 250 }
            );
        }

        simulation.resolve_enemies();
        assert!(simulation.state.enemies.is_empty());
        assert_eq!(simulation.state.leaked_enemies, 2);
        assert_eq!(simulation.state.base_health, 18);
    }

    #[test]
    fn seeded_spawn_variation_is_replayable_and_preserves_authored_counts() {
        let player = PlayerId::new();
        let mut first =
            Simulation::create("c".into(), "Game".into(), player.clone(), "A".into(), 41);
        first.state.status = SessionStatus::BetweenWaves;
        first.state.scale_players = 4;
        let mut replay = first.clone();
        let mut alternate = Simulation::create("c".into(), "Game".into(), player, "A".into(), 99);
        alternate.state.status = SessionStatus::BetweenWaves;
        alternate.state.scale_players = 4;
        first.start_wave().expect("seeded wave");
        replay.start_wave().expect("same seeded wave");
        alternate.start_wave().expect("alternate seeded wave");
        assert_eq!(first.state.pending_spawns, replay.state.pending_spawns);
        assert_ne!(first.state.pending_spawns, alternate.state.pending_spawns);
        let level = &levels()[0];
        let scale = &level.scales[3];
        let expected = level.waves[0]
            .spawns
            .iter()
            .map(|spawn| (u32::from(spawn.count) * u32::from(scale.wave_percent)).div_ceil(100))
            .sum::<u32>();
        assert_eq!(first.state.pending_spawns.len(), expected as usize);
        assert_eq!(first.state.pending_spawns[0].path, 0);
    }

    #[test]
    fn more_than_sixteen_spectators_are_valid_and_four_active_slots_remain_the_limit() {
        let host = PlayerId::new();
        let mut simulation = Simulation::create("c".into(), "Game".into(), host, "Host".into(), 1);
        for index in 0..24 {
            let spectator = PlayerId(format!("spectator-{index}"));
            simulation
                .apply(
                    &command(
                        &spectator,
                        u64::try_from(index).expect("test index"),
                        CommandKind::Join {
                            as_spectator: true,
                            display_name: format!("Watcher {index}"),
                        },
                    ),
                    &progress(&spectator),
                )
                .expect("spectator joins");
        }
        assert_eq!(simulation.state.members.len(), 25);
        assert_eq!(validate_snapshot(&simulation.state, "c"), Ok(()));
        assert_eq!(
            simulation
                .state
                .members
                .iter()
                .filter(|member| member.slot.is_some())
                .count(),
            1
        );
    }

    #[test]
    fn join_normalizes_names_and_rejects_unsafe_display_names() {
        let host = PlayerId::new();
        let joining = PlayerId::new();
        let mut simulation = Simulation::create("c".into(), "Game".into(), host, "Host".into(), 1);
        for invalid in ["", "   ", "line\nbreak"] {
            assert_eq!(
                simulation.apply(
                    &command(
                        &joining,
                        0,
                        CommandKind::Join {
                            as_spectator: true,
                            display_name: invalid.into(),
                        },
                    ),
                    &progress(&joining),
                ),
                Err(GameError::InvalidDisplayName)
            );
        }
        assert_eq!(
            simulation.apply(
                &command(
                    &joining,
                    0,
                    CommandKind::Join {
                        as_spectator: true,
                        display_name: "x".repeat(41),
                    },
                ),
                &progress(&joining),
            ),
            Err(GameError::InvalidDisplayName)
        );
        simulation
            .apply(
                &command(
                    &joining,
                    0,
                    CommandKind::Join {
                        as_spectator: true,
                        display_name: "  Safe Name  ".into(),
                    },
                ),
                &progress(&joining),
            )
            .expect("valid trimmed name");
        assert_eq!(simulation.state.members[1].display_name, "Safe Name");
    }

    #[test]
    fn upgrade_and_sell_require_an_active_build_state() {
        let player = PlayerId::new();
        let mut simulation =
            Simulation::create("c".into(), "Game".into(), player.clone(), "A".into(), 1);
        simulation.state.members[0].resources = 10_000;
        let pad = scaled_build_pads(1, 1)[0];
        simulation
            .state
            .defenders
            .push(tower(&player, "zip_zapper", "base", 1, pad.x, pad.y));
        let entity_id = simulation.state.defenders[0].id.clone();
        assert_eq!(
            simulation.apply(
                &command(
                    &player,
                    0,
                    CommandKind::Upgrade {
                        entity_id: entity_id.clone(),
                        path: "Overclock".into(),
                    },
                ),
                &progress(&player),
            ),
            Err(GameError::InvalidState)
        );
        assert_eq!(
            simulation.apply(
                &command(
                    &player,
                    0,
                    CommandKind::SetTarget {
                        entity_id: entity_id.clone(),
                        policy: TargetPolicy::Strong,
                    },
                ),
                &progress(&player),
            ),
            Err(GameError::InvalidState)
        );
        assert_eq!(
            simulation.apply(
                &command(
                    &player,
                    0,
                    CommandKind::Sell {
                        entity_id: entity_id.clone(),
                    },
                ),
                &progress(&player),
            ),
            Err(GameError::InvalidState)
        );
        simulation.state.status = SessionStatus::BetweenWaves;
        simulation
            .apply(
                &command(
                    &player,
                    0,
                    CommandKind::Upgrade {
                        entity_id: entity_id.clone(),
                        path: "Overclock".into(),
                    },
                ),
                &progress(&player),
            )
            .expect("upgrade between waves");
        simulation.state.status = SessionStatus::Paused;
        assert_eq!(
            simulation.apply(
                &command(
                    &player,
                    1,
                    CommandKind::Sell {
                        entity_id: entity_id.clone(),
                    },
                ),
                &progress(&player),
            ),
            Err(GameError::InvalidState)
        );
        simulation.state.status = SessionStatus::Running;
        simulation
            .apply(
                &command(&player, 1, CommandKind::Sell { entity_id }),
                &progress(&player),
            )
            .expect("sell during active play");
    }

    #[test]
    fn lobby_scaling_shrinks_on_leave_but_locks_after_start() {
        let host = PlayerId::new();
        let second = PlayerId::new();
        let third = PlayerId::new();
        let mut simulation = Simulation::create("c".into(), "Game".into(), host, "Host".into(), 1);
        simulation
            .apply(
                &command(
                    &second,
                    0,
                    CommandKind::Join {
                        as_spectator: false,
                        display_name: "Second".into(),
                    },
                ),
                &progress(&second),
            )
            .expect("second joins");
        simulation
            .apply(
                &command(
                    &third,
                    1,
                    CommandKind::Join {
                        as_spectator: false,
                        display_name: "Third".into(),
                    },
                ),
                &progress(&third),
            )
            .expect("third joins");
        assert_eq!(simulation.state.scale_players, 3);
        simulation
            .apply(&command(&third, 2, CommandKind::Leave), &progress(&third))
            .expect("third leaves lobby");
        assert_eq!(simulation.state.scale_players, 2);
        simulation.state.status = SessionStatus::BetweenWaves;
        simulation
            .apply(
                &command(
                    &third,
                    3,
                    CommandKind::Join {
                        as_spectator: false,
                        display_name: "Third".into(),
                    },
                ),
                &progress(&third),
            )
            .expect("third joins between waves");
        assert_eq!(simulation.state.scale_players, 2);
        simulation
            .apply(&command(&third, 4, CommandKind::Leave), &progress(&third))
            .expect("third leaves started game");
        assert_eq!(simulation.state.scale_players, 2);
    }

    #[test]
    fn host_leave_migrates_authority_and_removes_only_departing_towers() {
        let host = PlayerId::new();
        let second = PlayerId::new();
        let mut simulation = Simulation::create(
            "channel".into(),
            "Game".into(),
            host.clone(),
            "Host".into(),
            9,
        );
        simulation
            .apply(
                &command(
                    &second,
                    0,
                    CommandKind::Join {
                        as_spectator: false,
                        display_name: "Second".into(),
                    },
                ),
                &progress(&second),
            )
            .expect("second joins");
        let pads = scaled_build_pads(1, 2);
        simulation.state.defenders.push(tower(
            &host,
            "zip_zapper",
            "base",
            1,
            pads[0].x,
            pads[0].y,
        ));
        simulation.state.defenders.push(tower(
            &second,
            "zip_zapper",
            "base",
            1,
            pads[1].x,
            pads[1].y,
        ));
        simulation
            .apply(&command(&host, 1, CommandKind::Leave), &progress(&host))
            .expect("host leaves");
        assert_eq!(simulation.state.host, second);
        assert!(
            simulation
                .state
                .members
                .iter()
                .any(|member| member.player_id == simulation.state.host
                    && member.role == MemberRole::Host)
        );
        assert_eq!(simulation.state.defenders.len(), 1);
        assert_eq!(simulation.state.defenders[0].owner, simulation.state.host);
    }

    #[test]
    fn independent_channel_games_do_not_share_state() {
        let first_host = PlayerId::new();
        let second_host = PlayerId::new();
        let mut first = Simulation::create(
            "channel".into(),
            "First".into(),
            first_host.clone(),
            "One".into(),
            1,
        );
        let second = Simulation::create(
            "channel".into(),
            "Second".into(),
            second_host,
            "Two".into(),
            2,
        );
        first
            .apply(
                &command(&first_host, 0, CommandKind::Ready { ready: true }),
                &progress(&first_host),
            )
            .expect("first game changes");
        assert_ne!(first.state.session_id, second.state.session_id);
        assert!(first.state.members[0].ready);
        assert!(!second.state.members[0].ready);
        assert_eq!(second.state.last_sequence, 0);
    }

    #[test]
    fn spectator_snapshot_round_trip_catches_up_without_simulation_authority() {
        let host = PlayerId::new();
        let spectator = PlayerId::new();
        let mut simulation =
            Simulation::create("channel".into(), "Game".into(), host, "Host".into(), 17);
        simulation
            .apply(
                &command(
                    &spectator,
                    0,
                    CommandKind::Join {
                        as_spectator: true,
                        display_name: "Viewer".into(),
                    },
                ),
                &progress(&spectator),
            )
            .expect("spectator joins");
        let encoded = serde_json::to_string(&simulation.state).expect("serialize snapshot");
        let restored: SessionSnapshot =
            serde_json::from_str(&encoded).expect("restore spectator snapshot");
        assert_eq!(restored, simulation.state);
        assert!(restored.members.iter().any(|member| {
            member.player_id == spectator
                && member.role == MemberRole::Spectator
                && member.slot.is_none()
        }));
    }
}
