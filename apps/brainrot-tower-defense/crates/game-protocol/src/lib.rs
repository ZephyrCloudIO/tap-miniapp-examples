//! Versioned multiplayer commands, snapshots, identifiers, and events.
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

macro_rules! id_type {
    ($name:ident) => {
        #[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub String);
        impl $name {
            #[must_use]
            pub fn new() -> Self {
                Self(Uuid::new_v4().to_string())
            }
        }
        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }
    };
}
id_type!(SessionId);
id_type!(PlayerId);
id_type!(EntityId);
id_type!(CommandId);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Lobby,
    BetweenWaves,
    Running,
    Paused,
    Victory,
    Defeat,
    Abandoned,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemberRole {
    Host,
    Player,
    Spectator,
    Disconnected,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TargetPolicy {
    #[default]
    First,
    Last,
    Strong,
    Fast,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Member {
    pub player_id: PlayerId,
    pub display_name: String,
    pub role: MemberRole,
    pub slot: Option<u8>,
    pub ready: bool,
    pub resources: u32,
    pub contribution: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DefenderState {
    pub id: EntityId,
    pub owner: PlayerId,
    pub kind: String,
    pub x: u16,
    pub y: u16,
    pub level: u8,
    pub path: String,
    #[serde(default)]
    pub cooldown_ticks: u16,
    #[serde(default)]
    pub target_policy: TargetPolicy,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EnemyState {
    pub id: EntityId,
    pub kind: String,
    pub path: u8,
    pub progress: u16,
    pub health: i32,
    pub max_health: i32,
    pub slowed_ticks: u16,
    /// Persisted immunity window after route knockback. Keeping this in the
    /// authoritative snapshot prevents reloads from resetting crowd control.
    #[serde(default)]
    pub control_resistance_ticks: u16,
    #[serde(default)]
    pub armor: u8,
    #[serde(default)]
    pub reward: u32,
    #[serde(default = "default_leak_damage")]
    pub leak_damage: u16,
}

const fn default_leak_damage() -> u16 {
    1
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PendingSpawn {
    pub at_tick: u64,
    pub kind: String,
    pub path: u8,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PendingGameEvent {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecentAction {
    pub sequence: u64,
    pub actor: String,
    pub label: String,
}

/// Durable evidence of a completed run. Receipts remain on the session when
/// the host advances so active players who reconnect after the Victory frame
/// can still claim their progression exactly once.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompletionReceipt {
    pub run_id: SessionId,
    pub attempt: u32,
    pub level: u8,
    pub base_health: u16,
    pub score: u32,
    pub participants: Vec<PlayerId>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompletionCursor {
    pub session_id: SessionId,
    pub attempt: u32,
}

/// Authoritative binding between one processed command payload and its resulting sequence.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProcessedCommandReceipt {
    pub command_id: CommandId,
    pub command_fingerprint: String,
    pub sequence: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SessionSnapshot {
    pub schema_version: u16,
    /// Version of the normalized route-distance metric used by active enemies.
    #[serde(default)]
    pub movement_version: u8,
    pub session_id: SessionId,
    pub channel_id: String,
    pub name: String,
    pub level: u8,
    pub status: SessionStatus,
    /// Monotonic run number within this stable lobby/session identity.
    #[serde(default)]
    pub attempt: u32,
    pub host: PlayerId,
    pub members: Vec<Member>,
    /// Bounded identity history for validating durable completion receipts
    /// after a participating member leaves the active roster.
    #[serde(default)]
    pub participant_history: Vec<PlayerId>,
    #[serde(default = "default_scale_players")]
    pub scale_players: u8,
    pub defenders: Vec<DefenderState>,
    pub enemies: Vec<EnemyState>,
    #[serde(default)]
    pub pending_spawns: Vec<PendingSpawn>,
    /// Durable post-commit event outbox. Entries are removed only after TAP accepts delivery.
    #[serde(default)]
    pub pending_events: Vec<PendingGameEvent>,
    #[serde(default)]
    pub recent_actions: Vec<RecentAction>,
    #[serde(default)]
    pub completion_receipts: Vec<CompletionReceipt>,
    pub wave: u8,
    pub base_health: u16,
    pub tick: u64,
    pub seed: u64,
    pub last_sequence: u64,
    pub processed_commands: Vec<CommandId>,
    #[serde(default)]
    pub processed_command_receipts: Vec<ProcessedCommandReceipt>,
    #[serde(default)]
    pub next_enemy: u64,
    #[serde(default)]
    pub score: u32,
    #[serde(default)]
    pub defeated_enemies: u32,
    #[serde(default)]
    pub leaked_enemies: u16,
}

const fn default_scale_players() -> u8 {
    1
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CommandKind {
    Join {
        as_spectator: bool,
        display_name: String,
    },
    Leave,
    Ready {
        ready: bool,
    },
    SelectLevel {
        level: u8,
    },
    Start,
    StartWave,
    Place {
        defender: String,
        x: u16,
        y: u16,
    },
    Upgrade {
        entity_id: EntityId,
        path: String,
    },
    SetTarget {
        entity_id: EntityId,
        policy: TargetPolicy,
    },
    Sell {
        entity_id: EntityId,
    },
    Move {
        entity_id: EntityId,
        x: u16,
        y: u16,
    },
    Pause,
    Resume,
    Restart,
    AdvanceLevel,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PlayerCommand {
    pub schema_version: u16,
    pub id: CommandId,
    pub player_id: PlayerId,
    pub expected_sequence: u64,
    pub kind: CommandKind,
}

fn push_command_identity_field(identity: &mut String, value: &str) {
    identity.push_str(&value.len().to_string());
    identity.push(':');
    identity.push_str(value);
    identity.push('|');
}

impl PlayerCommand {
    /// Returns a stable, length-delimited identity for this exact command payload.
    ///
    /// The identity intentionally includes the command ID, actor, expected sequence, variant,
    /// and every variant field. Accepted acknowledgements persist it so an entry cannot reuse a
    /// processed command ID with a substituted payload.
    #[must_use]
    pub fn fingerprint(&self) -> String {
        let mut identity = String::from("tap-command-v1|");
        push_command_identity_field(&mut identity, &self.schema_version.to_string());
        push_command_identity_field(&mut identity, &self.id.0);
        push_command_identity_field(&mut identity, &self.player_id.0);
        push_command_identity_field(&mut identity, &self.expected_sequence.to_string());
        match &self.kind {
            CommandKind::Join {
                as_spectator,
                display_name,
            } => {
                push_command_identity_field(&mut identity, "join");
                push_command_identity_field(
                    &mut identity,
                    if *as_spectator { "spectator" } else { "player" },
                );
                push_command_identity_field(&mut identity, display_name);
            }
            CommandKind::Leave => push_command_identity_field(&mut identity, "leave"),
            CommandKind::Ready { ready } => {
                push_command_identity_field(&mut identity, "ready");
                push_command_identity_field(&mut identity, if *ready { "true" } else { "false" });
            }
            CommandKind::SelectLevel { level } => {
                push_command_identity_field(&mut identity, "select_level");
                push_command_identity_field(&mut identity, &level.to_string());
            }
            CommandKind::Start => push_command_identity_field(&mut identity, "start"),
            CommandKind::StartWave => push_command_identity_field(&mut identity, "start_wave"),
            CommandKind::Place { defender, x, y } => {
                push_command_identity_field(&mut identity, "place");
                push_command_identity_field(&mut identity, defender);
                push_command_identity_field(&mut identity, &x.to_string());
                push_command_identity_field(&mut identity, &y.to_string());
            }
            CommandKind::Upgrade { entity_id, path } => {
                push_command_identity_field(&mut identity, "upgrade");
                push_command_identity_field(&mut identity, &entity_id.0);
                push_command_identity_field(&mut identity, path);
            }
            CommandKind::SetTarget { entity_id, policy } => {
                push_command_identity_field(&mut identity, "set_target");
                push_command_identity_field(&mut identity, &entity_id.0);
                push_command_identity_field(
                    &mut identity,
                    match policy {
                        TargetPolicy::First => "first",
                        TargetPolicy::Last => "last",
                        TargetPolicy::Strong => "strong",
                        TargetPolicy::Fast => "fast",
                    },
                );
            }
            CommandKind::Sell { entity_id } => {
                push_command_identity_field(&mut identity, "sell");
                push_command_identity_field(&mut identity, &entity_id.0);
            }
            CommandKind::Move { entity_id, x, y } => {
                push_command_identity_field(&mut identity, "move");
                push_command_identity_field(&mut identity, &entity_id.0);
                push_command_identity_field(&mut identity, &x.to_string());
                push_command_identity_field(&mut identity, &y.to_string());
            }
            CommandKind::Pause => push_command_identity_field(&mut identity, "pause"),
            CommandKind::Resume => push_command_identity_field(&mut identity, "resume"),
            CommandKind::Restart => push_command_identity_field(&mut identity, "restart"),
            CommandKind::AdvanceLevel => {
                push_command_identity_field(&mut identity, "advance_level");
            }
        }
        identity
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CommandAck {
    pub command_id: CommandId,
    pub sequence: u64,
    pub accepted: bool,
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command_fingerprint: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct QueuedCommand {
    pub command: PlayerCommand,
    pub acknowledgement: Option<CommandAck>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CommandQueue {
    pub schema_version: u16,
    pub entries: Vec<QueuedCommand>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Progress {
    pub schema_version: u16,
    pub player_id: PlayerId,
    pub unlocked_level: u8,
    pub unlocked_defenders: Vec<String>,
    pub best_stars: [u8; 5],
    pub best_scores: [u32; 5],
    pub cooperative_completions: u32,
    #[serde(default)]
    pub completed_sessions: Vec<SessionId>,
    /// Run identifiers for cooperative victories, used to merge concurrent progress losslessly.
    #[serde(default)]
    pub completed_cooperative_runs: Vec<SessionId>,
    /// Per-session high-water marks keep receipt replay protection durable
    /// after the bounded exact run-ID windows rotate.
    #[serde(default)]
    pub completion_cursors: Vec<CompletionCursor>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ChannelIndex {
    pub schema_version: u16,
    pub session_ids: Vec<SessionId>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AudioSettings {
    pub schema_version: u16,
    pub player_id: PlayerId,
    pub master: u8,
    pub music: u8,
    pub effects: u8,
    #[serde(default)]
    pub muted: bool,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ProtocolError {
    #[error("unsupported schema version")]
    UnsupportedSchema,
    #[error("invalid command sequence")]
    Sequence,
    #[error("duplicate command")]
    Duplicate,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advance_level_command_has_a_stable_json_contract() {
        let encoded = serde_json::to_value(CommandKind::AdvanceLevel).expect("serialize command");
        assert_eq!(encoded, serde_json::json!({ "type": "advance_level" }));
        assert_eq!(
            serde_json::from_value::<CommandKind>(encoded).expect("deserialize command"),
            CommandKind::AdvanceLevel
        );
    }

    #[test]
    fn legacy_enemy_snapshots_default_the_control_recovery_window() {
        let enemy = serde_json::from_value::<EnemyState>(serde_json::json!({
            "id": "enemy-legacy",
            "kind": "basic",
            "path": 0,
            "progress": 250,
            "health": 80,
            "max_health": 100,
            "slowed_ticks": 0,
            "armor": 0,
            "reward": 5,
            "leak_damage": 1
        }))
        .expect("legacy enemy snapshot");

        assert_eq!(enemy.control_resistance_ticks, 0);
    }

    #[test]
    fn command_fingerprint_binds_every_replay_sensitive_field() {
        let original = PlayerCommand {
            schema_version: 1,
            id: CommandId("command-1".into()),
            player_id: PlayerId("player-1".into()),
            expected_sequence: 4,
            kind: CommandKind::Upgrade {
                entity_id: EntityId("tower-1".into()),
                path: "Overclock".into(),
            },
        };
        let mut substituted = original.clone();
        substituted.kind = CommandKind::Upgrade {
            entity_id: EntityId("tower-1".into()),
            path: "Chain Reaction".into(),
        };
        let mut different_sequence = original.clone();
        different_sequence.expected_sequence += 1;

        assert_eq!(original.fingerprint(), original.clone().fingerprint());
        assert_ne!(original.fingerprint(), substituted.fingerprint());
        assert_ne!(original.fingerprint(), different_sequence.fingerprint());
    }

    #[test]
    fn legacy_acknowledgements_default_to_unbound_identity() {
        let acknowledgement = serde_json::from_value::<CommandAck>(serde_json::json!({
            "command_id": "legacy-command",
            "sequence": 3,
            "accepted": true,
            "reason": null
        }))
        .expect("legacy acknowledgement");

        assert_eq!(acknowledgement.command_fingerprint, None);
    }
}
