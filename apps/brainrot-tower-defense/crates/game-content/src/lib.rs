//! Authored, validated game definitions. Static game content is not domain data.
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::OnceLock;
use thiserror::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum EnemyKind {
    Basic,
    Fast,
    Armored,
    Swarm,
    Disruption,
    Boss,
}

impl EnemyKind {
    #[must_use]
    pub const fn id(self) -> &'static str {
        match self {
            Self::Basic => "basic",
            Self::Fast => "fast",
            Self::Armored => "armored",
            Self::Swarm => "swarm",
            Self::Disruption => "disruption",
            Self::Boss => "boss",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Point {
    pub x: u16,
    pub y: u16,
}

/// Fixed-point scale used for subpixel route sampling.
pub const PATH_POSITION_SCALE: u32 = 1024;

/// A deterministic subpixel point on an authored route.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PrecisePoint {
    pub x: u32,
    pub y: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Spawn {
    pub kind: EnemyKind,
    pub count: u16,
    pub interval: u16,
    pub path: u8,
    pub delay: u16,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Wave {
    pub label: &'static str,
    pub spawns: Vec<Spawn>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Scale {
    /// Lobby-preview footprint for this player-count variant. Authored geometry
    /// uses the map's normalized logical bounds so simulation and rendering
    /// share stable integer coordinates at every display size.
    pub width: u16,
    pub height: u16,
    pub paths: u8,
    pub entrances: u8,
    pub build_slots: u8,
    pub resource_per_player: u32,
    pub enemy_percent: u16,
    pub wave_percent: u16,
    pub boss_phase_ticks: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum BuildZoneOwnership {
    Cooperative,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BuildZone {
    pub id: &'static str,
    pub ownership: BuildZoneOwnership,
    pub pads: Vec<Point>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LevelMap {
    pub asset: &'static str,
    pub logical_width: u16,
    pub logical_height: u16,
    pub paths: Vec<Vec<Point>>,
    pub build_zones: Vec<BuildZone>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum LevelUnlock {
    Initial,
    CompleteLevel(u8),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScoringThresholds {
    pub two_star_health_percent: u8,
    pub three_star_health_percent: u8,
}

impl ScoringThresholds {
    #[must_use]
    pub const fn stars_for_health_percent(self, health_percent: u8) -> u8 {
        if health_percent >= self.three_star_health_percent {
            3
        } else if health_percent >= self.two_star_health_percent {
            2
        } else {
            1
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Level {
    pub id: u8,
    pub name: &'static str,
    pub description: &'static str,
    pub modifier: &'static str,
    pub map: LevelMap,
    pub base_health: u16,
    pub available_defenders: Vec<&'static str>,
    pub unlock: LevelUnlock,
    pub scoring: ScoringThresholds,
    pub scales: [Scale; 4],
    pub waves: Vec<Wave>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Defender {
    pub id: &'static str,
    pub name: &'static str,
    pub role: &'static str,
    pub cost: u32,
    pub damage: u16,
    pub range: u16,
    pub cooldown: u16,
    pub splash: u16,
    pub slow_ticks: u16,
    pub armor_pierce: u8,
    pub income: u16,
    pub upgrade_paths: [&'static str; 2],
}

pub const UPGRADE_TIERS_PER_PATH: usize = 4;
pub const MAX_DEFENDER_LEVEL: u8 = 1 + UPGRADE_TIERS_PER_PATH as u8;
/// Per-active-player payout after a non-final wave.
///
/// This accelerates ordinary builds. The most expensive max paths remain an
/// intentional economy choice that also uses enemy rewards, income defenders,
/// or sell-and-reinvest decisions.
pub const WAVE_CLEAR_BONUS: u32 = 40;

/// Incremental stat growth purchased by one authored upgrade tier.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpgradeGrowth {
    pub damage_percent: u16,
    /// Deterministic whole damage added by low-base-damage upgrade tiers.
    #[serde(default)]
    pub flat_damage: u16,
    pub cooldown_reduction: u16,
    pub range: u16,
    pub splash: u16,
    pub slow_ticks: u16,
    pub armor_pierce: u8,
    pub income: u16,
}

impl UpgradeGrowth {
    #[must_use]
    pub fn saturating_add(self, other: Self) -> Self {
        Self {
            damage_percent: self.damage_percent.saturating_add(other.damage_percent),
            flat_damage: self.flat_damage.saturating_add(other.flat_damage),
            cooldown_reduction: self
                .cooldown_reduction
                .saturating_add(other.cooldown_reduction),
            range: self.range.saturating_add(other.range),
            splash: self.splash.saturating_add(other.splash),
            slow_ticks: self.slow_ticks.saturating_add(other.slow_ticks),
            armor_pierce: self.armor_pierce.saturating_add(other.armor_pierce),
            income: self.income.saturating_add(other.income),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpgradeTierDefinition {
    pub name: &'static str,
    pub effect: &'static str,
    pub cost: u32,
    pub growth: UpgradeGrowth,
}

/// Mechanics that cannot be represented by stat growth alone.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum UpgradeMechanic {
    None,
    Chain {
        radius: u16,
        extra_targets: u8,
        secondary_damage_percent: u8,
    },
    MissingHealth {
        max_bonus_percent: u16,
        execute_percent: u8,
    },
    Knockback {
        progress: u16,
    },
    DistanceDamage {
        max_bonus_percent: u16,
    },
    ArmorShred {
        armor: u8,
    },
    TeamIncome {
        teammate_percent: u8,
    },
    BossDamage {
        bonus_percent: u16,
    },
    LeakGuard {
        damage: u16,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpgradePathDefinition {
    pub name: &'static str,
    pub description: &'static str,
    pub tiers: [UpgradeTierDefinition; UPGRADE_TIERS_PER_PATH],
    pub mechanics: [UpgradeMechanic; UPGRADE_TIERS_PER_PATH],
}

const fn growth(
    damage_percent: u16,
    cooldown_reduction: u16,
    range: u16,
    splash: u16,
    slow_ticks: u16,
    armor_pierce: u8,
    income: u16,
) -> UpgradeGrowth {
    UpgradeGrowth {
        damage_percent,
        flat_damage: 0,
        cooldown_reduction,
        range,
        splash,
        slow_ticks,
        armor_pierce,
        income,
    }
}

const fn with_flat_damage(mut growth: UpgradeGrowth, flat_damage: u16) -> UpgradeGrowth {
    growth.flat_damage = flat_damage;
    growth
}

const fn tier(
    name: &'static str,
    effect: &'static str,
    cost: u32,
    growth: UpgradeGrowth,
) -> UpgradeTierDefinition {
    UpgradeTierDefinition {
        name,
        effect,
        cost,
        growth,
    }
}

#[must_use]
pub fn next_upgrade_tier(
    defender: &str,
    path: &str,
    current_level: u8,
) -> Option<UpgradeTierDefinition> {
    let tier_index = usize::from(current_level.checked_sub(1)?);
    upgrade_path(defender, path)?.tiers.get(tier_index).copied()
}

/// Returns the authored mechanics for one of a defender's two upgrade paths.
/// The string keys intentionally match the serialized protocol and existing UI.
#[must_use]
pub fn upgrade_path(defender: &str, path: &str) -> Option<UpgradePathDefinition> {
    let definition = match (defender, path) {
        ("zip_zapper", "Overclock") => UpgradePathDefinition {
            name: "Overclock",
            description: "Greatly shortens attack cooldown for sustained single-target damage.",
            tiers: [
                tier(
                    "Fast Cache",
                    "+15% damage, faster attacks, +4 range, and +2 armor pierce.",
                    110,
                    growth(15, 1, 4, 0, 0, 2, 0),
                ),
                tier(
                    "Fiber Link",
                    "+18% damage, faster attacks, +6 range, and +3 armor pierce.",
                    155,
                    growth(18, 1, 6, 0, 0, 3, 0),
                ),
                tier(
                    "Zero Latency",
                    "+22% damage, faster attacks, +8 range, and +3 armor pierce.",
                    205,
                    growth(22, 1, 8, 0, 0, 3, 0),
                ),
                tier(
                    "Ludicrous Speed",
                    "+30% damage, much faster attacks, +10 range, and +4 armor pierce.",
                    270,
                    growth(30, 2, 10, 0, 0, 4, 0),
                ),
            ],
            mechanics: [UpgradeMechanic::None; UPGRADE_TIERS_PER_PATH],
        },
        ("zip_zapper", "Chain Ping") => UpgradePathDefinition {
            name: "Chain Ping",
            description: "Bounces each attack to additional nearby enemies.",
            tiers: [
                tier(
                    "Double Tap",
                    "Adds one chain target, +12% damage, and +6 range.",
                    110,
                    growth(12, 0, 6, 0, 0, 0, 0),
                ),
                tier(
                    "Group Chat",
                    "Adds another chain target, +14% damage, and +8 range.",
                    160,
                    growth(14, 0, 8, 0, 0, 0, 0),
                ),
                tier(
                    "Viral Thread",
                    "Adds another chain target, +18% damage, and +10 range.",
                    215,
                    growth(18, 0, 10, 0, 0, 0, 0),
                ),
                tier(
                    "Whole Timeline",
                    "Adds a fourth chain target, +24% damage, and +12 range.",
                    280,
                    growth(24, 0, 12, 0, 0, 0, 0),
                ),
            ],
            mechanics: [
                UpgradeMechanic::Chain {
                    radius: 58,
                    extra_targets: 1,
                    secondary_damage_percent: 70,
                },
                UpgradeMechanic::Chain {
                    radius: 58,
                    extra_targets: 2,
                    secondary_damage_percent: 70,
                },
                UpgradeMechanic::Chain {
                    radius: 66,
                    extra_targets: 3,
                    secondary_damage_percent: 72,
                },
                UpgradeMechanic::Chain {
                    radius: 76,
                    extra_targets: 4,
                    secondary_damage_percent: 80,
                },
            ],
        },
        ("caps_lock", "Bigger Type") => UpgradePathDefinition {
            name: "Bigger Type",
            description: "Expands the blast and increases its direct damage.",
            tiers: [
                tier(
                    "Bold",
                    "+25% damage, +24 blast radius, and +4 range.",
                    135,
                    growth(25, 0, 4, 24, 0, 0, 0),
                ),
                tier(
                    "Headline",
                    "+30% damage, +30 blast radius, and +5 range.",
                    205,
                    growth(30, 0, 5, 30, 0, 0, 0),
                ),
                tier(
                    "Billboard",
                    "+36% damage, +38 blast radius, and +6 range.",
                    285,
                    growth(36, 0, 6, 38, 0, 0, 0),
                ),
                tier(
                    "ALL CAPS",
                    "+48% damage, +50 blast radius, and +8 range.",
                    380,
                    growth(48, 0, 8, 50, 0, 0, 0),
                ),
            ],
            mechanics: [UpgradeMechanic::None; UPGRADE_TIERS_PER_PATH],
        },
        ("caps_lock", "Rage Post") => UpgradePathDefinition {
            name: "Rage Post",
            description: "Attacks faster and hit harder as a target loses health.",
            tiers: [
                tier(
                    "Ratio",
                    "+10% damage, faster attacks, and a missing-health damage bonus.",
                    135,
                    growth(10, 1, 0, 0, 0, 0, 0),
                ),
                tier(
                    "Dogpile",
                    "+14% damage, faster attacks, and a stronger execute threshold.",
                    205,
                    growth(14, 1, 0, 0, 0, 0, 0),
                ),
                tier(
                    "Meltdown",
                    "+18% damage, faster attacks, and a stronger missing-health bonus.",
                    285,
                    growth(18, 1, 0, 0, 0, 0, 0),
                ),
                tier(
                    "Final Word",
                    "+26% damage, much faster attacks, and the maximum execute threshold.",
                    380,
                    growth(26, 2, 0, 0, 0, 0, 0),
                ),
            ],
            mechanics: [
                UpgradeMechanic::MissingHealth {
                    max_bonus_percent: 45,
                    execute_percent: 6,
                },
                UpgradeMechanic::MissingHealth {
                    max_bonus_percent: 90,
                    execute_percent: 12,
                },
                UpgradeMechanic::MissingHealth {
                    max_bonus_percent: 125,
                    execute_percent: 15,
                },
                UpgradeMechanic::MissingHealth {
                    max_bonus_percent: 165,
                    execute_percent: 18,
                },
            ],
        },
        ("buffer_buddy", "Long Pause") => UpgradePathDefinition {
            name: "Long Pause",
            description: "Spreads a much longer slow across a growing support area.",
            tiers: [
                tier(
                    "Buffering",
                    "+1 damage, +20 slow duration, +25 support area, and +6 range.",
                    120,
                    with_flat_damage(growth(0, 0, 6, 25, 20, 0, 0), 1),
                ),
                tier(
                    "Loading Loop",
                    "+1 damage, +25 slow duration, +30 support area, and +8 range.",
                    180,
                    with_flat_damage(growth(0, 0, 8, 30, 25, 0, 0), 1),
                ),
                tier(
                    "Frozen Feed",
                    "+1 damage, +32 slow duration, +38 support area, and +10 range.",
                    250,
                    with_flat_damage(growth(0, 0, 10, 38, 32, 0, 0), 1),
                ),
                tier(
                    "Infinite Timeout",
                    "+1 damage, +45 slow duration, +50 support area, and +14 range.",
                    330,
                    with_flat_damage(growth(0, 0, 14, 50, 45, 0, 0), 1),
                ),
            ],
            mechanics: [UpgradeMechanic::None; UPGRADE_TIERS_PER_PATH],
        },
        ("buffer_buddy", "Hard Refresh") => UpgradePathDefinition {
            name: "Hard Refresh",
            description: "Knocks the current target backward along its route.",
            tiers: [
                tier(
                    "Cache Bust",
                    "+1 damage, faster attacks, +6 slow duration, and route knockback.",
                    120,
                    with_flat_damage(growth(0, 1, 0, 0, 6, 0, 0), 1),
                ),
                tier(
                    "Force Reload",
                    "+1 damage, faster attacks, +8 slow duration, and stronger knockback.",
                    180,
                    with_flat_damage(growth(0, 1, 0, 0, 8, 0, 0), 1),
                ),
                tier(
                    "Rollback",
                    "+1 damage, faster attacks, +10 slow duration, and stronger knockback.",
                    250,
                    with_flat_damage(growth(0, 1, 0, 0, 10, 0, 0), 1),
                ),
                tier(
                    "Factory Reset",
                    "+2 damage, much faster attacks, +14 slow duration, and maximum knockback.",
                    330,
                    with_flat_damage(growth(0, 2, 0, 0, 14, 0, 0), 2),
                ),
            ],
            mechanics: [
                UpgradeMechanic::Knockback { progress: 24 },
                UpgradeMechanic::Knockback { progress: 48 },
                UpgradeMechanic::Knockback { progress: 60 },
                UpgradeMechanic::Knockback { progress: 72 },
            ],
        },
        ("deep_scroller", "Zoom Lens") => UpgradePathDefinition {
            name: "Zoom Lens",
            description: "Extends range and rewards shots taken near maximum range.",
            tiers: [
                tier(
                    "Long Read",
                    "+18% damage, +25 range, and a distance-based damage bonus.",
                    155,
                    growth(18, 0, 25, 0, 0, 0, 0),
                ),
                tier(
                    "Deep Zoom",
                    "+22% damage, +30 range, and a stronger distance bonus.",
                    245,
                    growth(22, 0, 30, 0, 0, 0, 0),
                ),
                tier(
                    "Satellite View",
                    "+28% damage, +35 range, and a stronger distance bonus.",
                    350,
                    growth(28, 0, 35, 0, 0, 0, 0),
                ),
                tier(
                    "Omniscroll",
                    "+38% damage, +45 range, and the maximum distance bonus.",
                    475,
                    growth(38, 0, 45, 0, 0, 0, 0),
                ),
            ],
            mechanics: [
                UpgradeMechanic::DistanceDamage {
                    max_bonus_percent: 40,
                },
                UpgradeMechanic::DistanceDamage {
                    max_bonus_percent: 80,
                },
                UpgradeMechanic::DistanceDamage {
                    max_bonus_percent: 110,
                },
                UpgradeMechanic::DistanceDamage {
                    max_bonus_percent: 150,
                },
            ],
        },
        ("deep_scroller", "Receipts") => UpgradePathDefinition {
            name: "Receipts",
            description: "Each hit permanently strips armor from its target.",
            tiers: [
                tier(
                    "Screenshot",
                    "+16% damage, +2 armor pierce, and permanent armor shred.",
                    155,
                    growth(16, 0, 0, 0, 0, 2, 0),
                ),
                tier(
                    "Archive",
                    "+20% damage, faster attacks, +2 armor pierce, and stronger shred.",
                    245,
                    growth(20, 1, 0, 0, 0, 2, 0),
                ),
                tier(
                    "Audit Trail",
                    "+26% damage, faster attacks, +3 armor pierce, and stronger shred.",
                    350,
                    growth(26, 1, 0, 0, 0, 3, 0),
                ),
                tier(
                    "Permanent Record",
                    "+36% damage, much faster attacks, +3 armor pierce, and maximum shred.",
                    475,
                    growth(36, 2, 0, 0, 0, 3, 0),
                ),
            ],
            mechanics: [
                UpgradeMechanic::ArmorShred { armor: 15 },
                UpgradeMechanic::ArmorShred { armor: 30 },
                UpgradeMechanic::ArmorShred { armor: 38 },
                UpgradeMechanic::ArmorShred { armor: 50 },
            ],
        },
        ("side_hustler", "Passive Income") => UpgradePathDefinition {
            name: "Passive Income",
            description: "Generates a larger personal payout much more often.",
            tiers: [
                tier(
                    "Tip Jar",
                    "+8 personal income and more frequent payouts.",
                    145,
                    growth(0, 8, 0, 0, 0, 0, 8),
                ),
                tier(
                    "Subscription",
                    "+10 personal income and more frequent payouts.",
                    225,
                    growth(0, 10, 0, 0, 0, 0, 10),
                ),
                tier(
                    "Portfolio",
                    "+13 personal income and more frequent payouts.",
                    320,
                    growth(0, 12, 0, 0, 0, 0, 13),
                ),
                tier(
                    "Compound Interest",
                    "+17 personal income and the fastest payout cycle.",
                    430,
                    growth(0, 15, 0, 0, 0, 0, 17),
                ),
            ],
            mechanics: [UpgradeMechanic::None; UPGRADE_TIERS_PER_PATH],
        },
        ("side_hustler", "Brand Deal") => UpgradePathDefinition {
            name: "Brand Deal",
            description: "Shares every payout with all active teammates.",
            tiers: [
                tier(
                    "Affiliate Link",
                    "+7 income and shares 70% of every payout with teammates.",
                    145,
                    growth(0, 0, 0, 0, 0, 0, 7),
                ),
                tier(
                    "Sponsorship",
                    "+9 income while preserving the shared team payout.",
                    225,
                    growth(0, 0, 0, 0, 0, 0, 9),
                ),
                tier(
                    "Team Contract",
                    "+12 income while preserving the shared team payout.",
                    320,
                    growth(0, 0, 0, 0, 0, 0, 12),
                ),
                tier(
                    "Global Campaign",
                    "+16 income with the maximum shared team payout.",
                    430,
                    growth(0, 0, 0, 0, 0, 0, 16),
                ),
            ],
            mechanics: [
                UpgradeMechanic::TeamIncome {
                    teammate_percent: 70,
                },
                UpgradeMechanic::TeamIncome {
                    teammate_percent: 70,
                },
                UpgradeMechanic::TeamIncome {
                    teammate_percent: 80,
                },
                UpgradeMechanic::TeamIncome {
                    teammate_percent: 90,
                },
            ],
        },
        ("final_form", "Main Character") => UpgradePathDefinition {
            name: "Main Character",
            description: "Builds overwhelming damage with an extra bonus against bosses.",
            tiers: [
                tier(
                    "Spotlight",
                    "+25% damage, +8 range, +4 armor pierce, and bonus boss damage.",
                    275,
                    growth(25, 0, 8, 0, 0, 4, 0),
                ),
                tier(
                    "Plot Twist",
                    "+32% damage, faster attacks, +10 range, and +5 armor pierce.",
                    485,
                    growth(32, 1, 10, 0, 0, 5, 0),
                ),
                tier(
                    "Season Finale",
                    "+42% damage, faster attacks, +14 range, and +7 armor pierce.",
                    725,
                    growth(42, 1, 14, 0, 0, 7, 0),
                ),
                tier(
                    "Canon Event",
                    "+58% damage, much faster attacks, +20 range, and +10 armor pierce.",
                    1_000,
                    growth(58, 2, 20, 0, 0, 10, 0),
                ),
            ],
            mechanics: [
                UpgradeMechanic::BossDamage { bonus_percent: 45 },
                UpgradeMechanic::BossDamage { bonus_percent: 90 },
                UpgradeMechanic::BossDamage { bonus_percent: 125 },
                UpgradeMechanic::BossDamage { bonus_percent: 175 },
            ],
        },
        ("final_form", "Plot Armor") => UpgradePathDefinition {
            name: "Plot Armor",
            description: "Intercepts damage from enemies that reach the base.",
            tiers: [
                tier(
                    "Foreshadowing",
                    "+12% damage, +12 blast radius, +3 armor pierce, and leak protection.",
                    275,
                    growth(12, 0, 0, 12, 0, 3, 0),
                ),
                tier(
                    "Retcon",
                    "+16% damage, +16 blast radius, +4 armor pierce, and stronger protection.",
                    485,
                    growth(16, 0, 0, 16, 0, 4, 0),
                ),
                tier(
                    "Deus Ex",
                    "+22% damage, +22 blast radius, +6 armor pierce, and stronger protection.",
                    725,
                    growth(22, 0, 0, 22, 0, 6, 0),
                ),
                tier(
                    "Untouchable",
                    "+30% damage, +30 blast radius, +8 armor pierce, and maximum protection.",
                    1_000,
                    growth(30, 0, 0, 30, 0, 8, 0),
                ),
            ],
            mechanics: [
                UpgradeMechanic::LeakGuard { damage: 1 },
                UpgradeMechanic::LeakGuard { damage: 2 },
                UpgradeMechanic::LeakGuard { damage: 3 },
                UpgradeMechanic::LeakGuard { damage: 4 },
            ],
        },
        _ => return None,
    };
    Some(definition)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EnemyDefinition {
    pub display_name: &'static str,
    pub description: &'static str,
    pub health: i32,
    pub speed: u16,
    pub reward: u32,
    pub armor: u8,
    pub leak_damage: u16,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ContentError {
    #[error("level has no waves")]
    MissingWaves,
    #[error("invalid player scaling")]
    InvalidScaling,
    #[error("wave references a route that does not exist")]
    InvalidRoute,
    #[error("map has too few build pads")]
    MissingBuildPads,
    #[error("defender has missing or duplicate upgrade mechanics")]
    InvalidUpgrade,
    #[error("level map metadata is incomplete or inconsistent")]
    InvalidMap,
    #[error("level unlock or scoring metadata is invalid")]
    InvalidProgression,
    #[error("level defender availability is invalid")]
    InvalidAvailability,
}

#[must_use]
pub fn defenders() -> Vec<Defender> {
    vec![
        Defender {
            id: "zip_zapper",
            name: "Zip Zapper",
            role: "Rapid single-target",
            cost: 90,
            damage: 9,
            range: 135,
            cooldown: 7,
            splash: 0,
            slow_ticks: 0,
            armor_pierce: 10,
            income: 0,
            upgrade_paths: ["Overclock", "Chain Ping"],
        },
        Defender {
            id: "caps_lock",
            name: "Caps Lock",
            role: "Area burst",
            cost: 140,
            damage: 25,
            range: 115,
            cooldown: 22,
            splash: 72,
            slow_ticks: 0,
            armor_pierce: 5,
            income: 0,
            upgrade_paths: ["Bigger Type", "Rage Post"],
        },
        Defender {
            id: "buffer_buddy",
            name: "Buffer Buddy",
            role: "Slow support",
            cost: 110,
            damage: 5,
            range: 125,
            cooldown: 15,
            splash: 0,
            slow_ticks: 35,
            armor_pierce: 0,
            income: 0,
            upgrade_paths: ["Long Pause", "Hard Refresh"],
        },
        Defender {
            id: "deep_scroller",
            name: "Deep Scroller",
            role: "Anti-armor sniper",
            cost: 180,
            damage: 48,
            range: 230,
            cooldown: 30,
            splash: 0,
            slow_ticks: 0,
            armor_pierce: 90,
            income: 0,
            upgrade_paths: ["Zoom Lens", "Receipts"],
        },
        Defender {
            id: "side_hustler",
            name: "Side Hustler",
            role: "Resource generator",
            cost: 160,
            damage: 0,
            range: 0,
            cooldown: 90,
            splash: 0,
            slow_ticks: 0,
            armor_pierce: 0,
            income: 18,
            upgrade_paths: ["Passive Income", "Brand Deal"],
        },
        Defender {
            id: "final_form",
            name: "Final Form",
            role: "Late-game powerhouse",
            cost: 420,
            damage: 92,
            range: 175,
            cooldown: 25,
            splash: 58,
            slow_ticks: 0,
            armor_pierce: 65,
            income: 0,
            upgrade_paths: ["Main Character", "Plot Armor"],
        },
    ]
}

#[must_use]
pub const fn enemy(kind: EnemyKind) -> EnemyDefinition {
    match kind {
        EnemyKind::Basic => EnemyDefinition {
            display_name: "Tralalero Tralala",
            description: "A steady all-rounder that advances without armor or special defenses.",
            health: 64,
            speed: 3,
            reward: 8,
            armor: 0,
            leak_damage: 1,
        },
        EnemyKind::Fast => EnemyDefinition {
            display_name: "Cappuccino Assassino",
            description: "A fragile sprinter that trades durability for exceptional speed.",
            health: 42,
            speed: 6,
            reward: 8,
            armor: 0,
            leak_damage: 1,
        },
        EnemyKind::Armored => EnemyDefinition {
            display_name: "Tung Tung Tung Sahur",
            description: "A slow, heavily armored bruiser that resists low-pierce attacks.",
            health: 155,
            speed: 2,
            reward: 16,
            armor: 55,
            leak_damage: 2,
        },
        EnemyKind::Swarm => EnemyDefinition {
            display_name: "Ballerina Cappuccina",
            description: "A lightweight rush unit that attacks in dense, fast-moving groups.",
            health: 24,
            speed: 5,
            reward: 4,
            armor: 0,
            leak_damage: 1,
        },
        EnemyKind::Disruption => EnemyDefinition {
            display_name: "Boneca Ambalabu",
            description: "A resilient mid-speed threat protected by light armor.",
            health: 98,
            speed: 3,
            reward: 14,
            armor: 15,
            leak_damage: 1,
        },
        EnemyKind::Boss => EnemyDefinition {
            display_name: "La Vaca Saturno Saturnita",
            description: "The armored final boss shifts lanes below half health and deals severe leak damage.",
            health: 1_650,
            speed: 1,
            reward: 250,
            armor: 35,
            leak_damage: 6,
        },
    }
}

const fn spawn(kind: EnemyKind, count: u16, interval: u16, path: u8, delay: u16) -> Spawn {
    Spawn {
        kind,
        count,
        interval,
        path,
        delay,
    }
}

fn wave(label: &'static str, spawns: Vec<Spawn>) -> Wave {
    Wave { label, spawns }
}

const fn scaled_path_count(path_profile: u8, player_index: u8) -> u8 {
    match path_profile {
        1 => 1,
        2 => {
            if player_index >= 1 {
                2
            } else {
                1
            }
        }
        _ => {
            let requested = player_index + 1;
            if requested < path_profile {
                requested
            } else {
                path_profile
            }
        }
    }
}

const fn scale_for_profile(path_profile: u8, total_build_slots: u8, players: u8) -> Scale {
    let player_count = if players < 1 {
        1
    } else if players > 4 {
        4
    } else {
        players
    };
    let paths = scaled_path_count(path_profile, player_count - 1);
    let available_slots = 5 + player_count * 2;
    Scale {
        width: 720 + 120 * player_count as u16,
        height: 522 + 20 * player_count as u16,
        paths,
        entrances: paths,
        build_slots: if total_build_slots < available_slots {
            total_build_slots
        } else {
            available_slots
        },
        resource_per_player: 400 - 25 * player_count as u32,
        enemy_percent: 90 + 10 * player_count as u16,
        wave_percent: 85 + 15 * player_count as u16,
        boss_phase_ticks: 120 - 15 * player_count as u16,
    }
}

/// Allocation-free access to the authoritative scale for a level and player count.
#[must_use]
pub const fn level_scale(level: u8, players: u8) -> Option<Scale> {
    let (path_profile, total_build_slots) = match level {
        1 => (1, 9),
        2 => (2, 10),
        3..=5 => (if level == 5 { 3 } else { 2 }, 12),
        _ => return None,
    };
    Some(scale_for_profile(path_profile, total_build_slots, players))
}

fn scales(path_profile: u8, total_build_slots: u8) -> [Scale; 4] {
    std::array::from_fn(|index| {
        scale_for_profile(
            path_profile,
            total_build_slots,
            u8::try_from(index + 1).unwrap_or(4),
        )
    })
}

const STANDARD_SCORING: ScoringThresholds = ScoringThresholds {
    two_star_health_percent: 40,
    three_star_health_percent: 75,
};

fn available_defenders(level: u8) -> Vec<&'static str> {
    let count = match level {
        1 => 3,
        2 => 4,
        3 => 5,
        _ => 6,
    };
    defenders()
        .into_iter()
        .take(count)
        .map(|defender| defender.id)
        .collect()
}

fn level_map(level: u8) -> LevelMap {
    let (asset, path_count) = match level {
        1 => ("assets/maps/backyard-wifi.webp", 1),
        2 => ("assets/maps/school-hallway-rush-v2.webp", 2),
        3 => ("assets/maps/food-court-frenzy.webp", 2),
        4 => ("assets/maps/suburban-doomscroll.webp", 2),
        5 => ("assets/maps/final-feed.webp", 3),
        _ => ("", 0),
    };
    LevelMap {
        asset,
        logical_width: 1000,
        logical_height: 562,
        paths: (0..path_count)
            .map(|lane| route(level, lane).to_vec())
            .collect(),
        build_zones: vec![BuildZone {
            id: "shared",
            ownership: BuildZoneOwnership::Cooperative,
            pads: build_pads(level).to_vec(),
        }],
    }
}

#[must_use]
pub fn levels() -> Vec<Level> {
    vec![
        Level {
            id: 1,
            name: "Backyard Wi-Fi",
            description: "Learn range, placement, upgrades, and wave timing.",
            modifier: "Strong signal · no map hazard",
            map: level_map(1),
            base_health: 20,
            available_defenders: available_defenders(1),
            unlock: LevelUnlock::Initial,
            scoring: STANDARD_SCORING,
            scales: scales(1, 9),
            waves: vec![
                wave(
                    "Doom scroll warm-up",
                    vec![spawn(EnemyKind::Basic, 8, 14, 0, 0)],
                ),
                wave(
                    "Clips incoming",
                    vec![
                        spawn(EnemyKind::Basic, 6, 15, 0, 0),
                        spawn(EnemyKind::Fast, 7, 10, 0, 34),
                    ],
                ),
                wave(
                    "Comment armor",
                    vec![
                        spawn(EnemyKind::Armored, 4, 25, 0, 0),
                        spawn(EnemyKind::Basic, 8, 12, 0, 18),
                    ],
                ),
                wave(
                    "Tab storm",
                    vec![
                        spawn(EnemyKind::Swarm, 16, 5, 0, 0),
                        spawn(EnemyKind::Fast, 8, 9, 0, 24),
                    ],
                ),
                wave(
                    "Backyard blackout",
                    vec![
                        spawn(EnemyKind::Disruption, 3, 34, 0, 0),
                        spawn(EnemyKind::Armored, 6, 19, 0, 15),
                        spawn(EnemyKind::Fast, 10, 8, 0, 46),
                    ],
                ),
            ],
        },
        Level {
            id: 2,
            name: "School Hallway Rush",
            description: "Two lanes demand target priorities and shared coverage.",
            modifier: "Passing period · fast enemies gain +1 speed",
            map: level_map(2),
            base_health: 20,
            available_defenders: available_defenders(2),
            unlock: LevelUnlock::CompleteLevel(1),
            scoring: STANDARD_SCORING,
            scales: scales(2, 10),
            waves: vec![
                wave(
                    "First bell",
                    vec![
                        spawn(EnemyKind::Fast, 8, 11, 0, 0),
                        spawn(EnemyKind::Basic, 8, 14, 1, 8),
                    ],
                ),
                wave(
                    "Hall pass swarm",
                    vec![
                        spawn(EnemyKind::Swarm, 16, 5, 0, 0),
                        spawn(EnemyKind::Swarm, 16, 5, 1, 18),
                    ],
                ),
                wave(
                    "Locker traffic",
                    vec![
                        spawn(EnemyKind::Armored, 7, 22, 0, 0),
                        spawn(EnemyKind::Fast, 14, 8, 1, 12),
                    ],
                ),
                wave(
                    "Pop quiz",
                    vec![
                        spawn(EnemyKind::Disruption, 5, 24, 0, 0),
                        spawn(EnemyKind::Armored, 5, 24, 1, 10),
                        spawn(EnemyKind::Swarm, 14, 6, 1, 42),
                    ],
                ),
                wave(
                    "Final bell",
                    vec![
                        spawn(EnemyKind::Fast, 18, 7, 0, 0),
                        spawn(EnemyKind::Armored, 9, 18, 1, 0),
                        spawn(EnemyKind::Disruption, 6, 20, 0, 50),
                    ],
                ),
            ],
        },
        Level {
            id: 3,
            name: "Food Court Frenzy",
            description: "Branching routes reward complementary builds.",
            modifier: "Armored trays · armored enemies gain +15 armor",
            map: level_map(3),
            base_health: 18,
            available_defenders: available_defenders(3),
            unlock: LevelUnlock::CompleteLevel(2),
            scoring: STANDARD_SCORING,
            scales: scales(2, 12),
            waves: vec![
                wave(
                    "Lunch line",
                    vec![
                        spawn(EnemyKind::Basic, 10, 12, 0, 0),
                        spawn(EnemyKind::Basic, 10, 12, 1, 6),
                    ],
                ),
                wave(
                    "Tray armor",
                    vec![
                        spawn(EnemyKind::Armored, 8, 20, 0, 0),
                        spawn(EnemyKind::Swarm, 18, 5, 1, 20),
                    ],
                ),
                wave(
                    "Rush order",
                    vec![
                        spawn(EnemyKind::Fast, 16, 8, 0, 0),
                        spawn(EnemyKind::Disruption, 5, 23, 1, 9),
                    ],
                ),
                wave(
                    "Split check",
                    vec![
                        spawn(EnemyKind::Armored, 8, 18, 0, 0),
                        spawn(EnemyKind::Armored, 8, 18, 1, 0),
                        spawn(EnemyKind::Swarm, 20, 5, 0, 44),
                    ],
                ),
                wave(
                    "Closing time",
                    vec![
                        spawn(EnemyKind::Disruption, 8, 18, 0, 0),
                        spawn(EnemyKind::Fast, 20, 7, 1, 12),
                        spawn(EnemyKind::Armored, 10, 16, 0, 40),
                    ],
                ),
            ],
        },
        Level {
            id: 4,
            name: "Suburban Doomscroll",
            description: "Signal outages interrupt defender rhythm.",
            modifier: "Signal outage · towers pause for 35 ticks every 300 ticks",
            map: level_map(4),
            base_health: 16,
            available_defenders: available_defenders(4),
            unlock: LevelUnlock::CompleteLevel(3),
            scoring: STANDARD_SCORING,
            scales: scales(2, 12),
            waves: vec![
                wave(
                    "Porch lights",
                    vec![
                        spawn(EnemyKind::Disruption, 5, 22, 0, 0),
                        spawn(EnemyKind::Basic, 12, 10, 1, 12),
                    ],
                ),
                wave(
                    "Dead zone",
                    vec![
                        spawn(EnemyKind::Fast, 16, 7, 0, 0),
                        spawn(EnemyKind::Armored, 8, 19, 1, 10),
                    ],
                ),
                wave(
                    "Neighborhood tabs",
                    vec![
                        spawn(EnemyKind::Swarm, 24, 4, 0, 0),
                        spawn(EnemyKind::Swarm, 24, 4, 1, 14),
                    ],
                ),
                wave(
                    "Router reset",
                    vec![
                        spawn(EnemyKind::Disruption, 9, 17, 0, 0),
                        spawn(EnemyKind::Armored, 10, 17, 1, 8),
                    ],
                ),
                wave(
                    "Infinite scroll",
                    vec![
                        spawn(EnemyKind::Fast, 24, 6, 0, 0),
                        spawn(EnemyKind::Disruption, 10, 15, 1, 12),
                        spawn(EnemyKind::Armored, 12, 15, 0, 42),
                    ],
                ),
            ],
        },
        Level {
            id: 5,
            name: "Final Feed",
            description: "A multi-phase boss combines every lesson.",
            modifier: "Algorithm shift · boss changes route below 50% health",
            map: level_map(5),
            base_health: 15,
            available_defenders: available_defenders(5),
            unlock: LevelUnlock::CompleteLevel(4),
            scoring: STANDARD_SCORING,
            scales: scales(3, 12),
            waves: vec![
                wave(
                    "Three entrances",
                    vec![
                        spawn(EnemyKind::Basic, 10, 10, 0, 0),
                        spawn(EnemyKind::Fast, 10, 8, 1, 6),
                        spawn(EnemyKind::Swarm, 16, 5, 2, 12),
                    ],
                ),
                wave(
                    "Filter bubble",
                    vec![
                        spawn(EnemyKind::Armored, 8, 17, 0, 0),
                        spawn(EnemyKind::Disruption, 7, 18, 1, 7),
                        spawn(EnemyKind::Fast, 16, 7, 2, 16),
                    ],
                ),
                wave(
                    "Engagement spike",
                    vec![
                        spawn(EnemyKind::Swarm, 24, 4, 0, 0),
                        spawn(EnemyKind::Swarm, 24, 4, 1, 8),
                        spawn(EnemyKind::Swarm, 24, 4, 2, 16),
                    ],
                ),
                wave(
                    "Moderation collapse",
                    vec![
                        spawn(EnemyKind::Disruption, 9, 15, 0, 0),
                        spawn(EnemyKind::Armored, 11, 15, 1, 5),
                        spawn(EnemyKind::Fast, 20, 6, 2, 12),
                    ],
                ),
                wave(
                    "The algorithm",
                    vec![
                        spawn(EnemyKind::Boss, 1, 1, 2, 0),
                        spawn(EnemyKind::Swarm, 24, 4, 0, 45),
                        spawn(EnemyKind::Disruption, 8, 15, 1, 60),
                        spawn(EnemyKind::Armored, 10, 16, 2, 72),
                    ],
                ),
            ],
        },
    ]
}

const ROUTE_1: &[Point] = &[
    Point { x: 62, y: 478 },
    Point { x: 82, y: 465 },
    Point { x: 103, y: 453 },
    Point { x: 124, y: 441 },
    Point { x: 146, y: 431 },
    Point { x: 169, y: 423 },
    Point { x: 192, y: 418 },
    Point { x: 216, y: 412 },
    Point { x: 239, y: 406 },
    Point { x: 263, y: 401 },
    Point { x: 286, y: 393 },
    Point { x: 308, y: 383 },
    Point { x: 328, y: 371 },
    Point { x: 344, y: 353 },
    Point { x: 350, y: 331 },
    Point { x: 347, y: 307 },
    Point { x: 340, y: 284 },
    Point { x: 327, y: 264 },
    Point { x: 321, y: 240 },
    Point { x: 336, y: 225 },
    Point { x: 358, y: 216 },
    Point { x: 381, y: 208 },
    Point { x: 404, y: 200 },
    Point { x: 426, y: 190 },
    Point { x: 447, y: 178 },
    Point { x: 464, y: 161 },
    Point { x: 480, y: 144 },
    Point { x: 496, y: 125 },
    Point { x: 509, y: 105 },
    Point { x: 527, y: 94 },
    Point { x: 551, y: 92 },
    Point { x: 575, y: 99 },
    Point { x: 593, y: 113 },
    Point { x: 604, y: 134 },
    Point { x: 609, y: 157 },
    Point { x: 611, y: 181 },
    Point { x: 617, y: 204 },
    Point { x: 629, y: 225 },
    Point { x: 646, y: 242 },
    Point { x: 666, y: 255 },
    Point { x: 688, y: 264 },
    Point { x: 712, y: 266 },
    Point { x: 736, y: 263 },
    Point { x: 759, y: 257 },
    Point { x: 781, y: 247 },
    Point { x: 800, y: 232 },
    Point { x: 816, y: 218 },
    Point { x: 825, y: 200 },
    Point { x: 818, y: 177 },
    Point { x: 821, y: 157 },
    Point { x: 828, y: 137 },
    Point { x: 842, y: 119 },
    Point { x: 859, y: 103 },
    Point { x: 876, y: 91 },
];
// Persisted movement-version 1 snapshots normalize progress over these exact
// School Hallway routes. Keep the retired geometry independent from the active
// authored routes so a future redraw can preserve live enemies' world position.
const LEGACY_SCHOOL_ROUTE_2A_V1: &[Point] = &[
    Point { x: 52, y: 126 },
    Point { x: 85, y: 132 },
    Point { x: 120, y: 146 },
    Point { x: 160, y: 157 },
    Point { x: 210, y: 160 },
    Point { x: 260, y: 159 },
    Point { x: 310, y: 156 },
    Point { x: 360, y: 151 },
    Point { x: 410, y: 143 },
    Point { x: 455, y: 128 },
    Point { x: 500, y: 110 },
    Point { x: 540, y: 99 },
    Point { x: 575, y: 97 },
    Point { x: 606, y: 108 },
    Point { x: 632, y: 132 },
    Point { x: 649, y: 160 },
    Point { x: 668, y: 182 },
    Point { x: 700, y: 192 },
    Point { x: 730, y: 190 },
    Point { x: 756, y: 177 },
    Point { x: 780, y: 167 },
    Point { x: 803, y: 166 },
    Point { x: 825, y: 175 },
    Point { x: 838, y: 195 },
    Point { x: 838, y: 218 },
    Point { x: 828, y: 235 },
    Point { x: 806, y: 245 },
];
const LEGACY_SCHOOL_ROUTE_2B_V1: &[Point] = &[
    Point { x: 0, y: 389 },
    Point { x: 45, y: 377 },
    Point { x: 82, y: 358 },
    Point { x: 110, y: 332 },
    Point { x: 132, y: 302 },
    Point { x: 144, y: 270 },
    Point { x: 145, y: 245 },
    Point { x: 156, y: 226 },
    Point { x: 180, y: 217 },
    Point { x: 205, y: 219 },
    Point { x: 229, y: 232 },
    Point { x: 247, y: 254 },
    Point { x: 263, y: 278 },
    Point { x: 286, y: 296 },
    Point { x: 315, y: 306 },
    Point { x: 350, y: 309 },
    Point { x: 384, y: 305 },
    Point { x: 414, y: 303 },
    Point { x: 438, y: 314 },
    Point { x: 454, y: 335 },
    Point { x: 464, y: 363 },
    Point { x: 483, y: 385 },
    Point { x: 510, y: 398 },
    Point { x: 540, y: 404 },
    Point { x: 570, y: 402 },
    Point { x: 600, y: 392 },
    Point { x: 625, y: 375 },
    Point { x: 648, y: 353 },
    Point { x: 673, y: 337 },
    Point { x: 700, y: 326 },
    Point { x: 730, y: 322 },
    Point { x: 760, y: 323 },
    Point { x: 785, y: 318 },
    Point { x: 805, y: 305 },
    Point { x: 820, y: 286 },
    Point { x: 825, y: 266 },
    Point { x: 816, y: 251 },
    Point { x: 806, y: 245 },
];
/// Reviewed School Hallway landmark contract for the server-room redraw.
///
/// Both painted lanes meet at the east-side T-junction, follow the same final
/// corridor, and disappear through the server-room threshold at the canvas edge.
pub const SCHOOL_HALLWAY_MERGE: Point = Point { x: 910, y: 245 };
pub const SCHOOL_HALLWAY_GOAL: Point = Point { x: 1000, y: 250 };

const ROUTE_2A: &[Point] = &[
    Point { x: 52, y: 126 },
    Point { x: 85, y: 132 },
    Point { x: 120, y: 146 },
    Point { x: 160, y: 157 },
    Point { x: 210, y: 160 },
    Point { x: 260, y: 159 },
    Point { x: 310, y: 156 },
    Point { x: 360, y: 151 },
    Point { x: 410, y: 143 },
    Point { x: 455, y: 128 },
    Point { x: 500, y: 110 },
    Point { x: 540, y: 99 },
    Point { x: 575, y: 97 },
    Point { x: 606, y: 108 },
    Point { x: 632, y: 132 },
    Point { x: 649, y: 160 },
    Point { x: 668, y: 182 },
    Point { x: 700, y: 192 },
    Point { x: 730, y: 190 },
    Point { x: 756, y: 177 },
    Point { x: 780, y: 167 },
    Point { x: 803, y: 166 },
    Point { x: 830, y: 165 },
    Point { x: 855, y: 169 },
    Point { x: 878, y: 180 },
    Point { x: 895, y: 198 },
    Point { x: 905, y: 220 },
    SCHOOL_HALLWAY_MERGE,
    Point { x: 936, y: 248 },
    Point { x: 962, y: 250 },
    Point { x: 985, y: 250 },
    SCHOOL_HALLWAY_GOAL,
];
const ROUTE_2B: &[Point] = &[
    Point { x: 0, y: 389 },
    Point { x: 45, y: 377 },
    Point { x: 82, y: 358 },
    Point { x: 110, y: 332 },
    Point { x: 132, y: 302 },
    Point { x: 144, y: 270 },
    Point { x: 145, y: 245 },
    Point { x: 156, y: 226 },
    Point { x: 180, y: 217 },
    Point { x: 205, y: 219 },
    Point { x: 229, y: 232 },
    Point { x: 247, y: 254 },
    Point { x: 263, y: 278 },
    Point { x: 286, y: 296 },
    Point { x: 315, y: 306 },
    Point { x: 350, y: 309 },
    Point { x: 384, y: 305 },
    Point { x: 414, y: 303 },
    Point { x: 438, y: 314 },
    Point { x: 454, y: 335 },
    Point { x: 464, y: 363 },
    Point { x: 483, y: 385 },
    Point { x: 510, y: 398 },
    Point { x: 540, y: 404 },
    Point { x: 570, y: 402 },
    Point { x: 600, y: 392 },
    Point { x: 625, y: 375 },
    Point { x: 648, y: 353 },
    Point { x: 673, y: 337 },
    Point { x: 700, y: 326 },
    Point { x: 730, y: 322 },
    Point { x: 760, y: 323 },
    Point { x: 785, y: 318 },
    Point { x: 810, y: 320 },
    Point { x: 836, y: 322 },
    Point { x: 862, y: 318 },
    Point { x: 884, y: 308 },
    Point { x: 900, y: 292 },
    Point { x: 908, y: 270 },
    SCHOOL_HALLWAY_MERGE,
    Point { x: 936, y: 248 },
    Point { x: 962, y: 250 },
    Point { x: 985, y: 250 },
    SCHOOL_HALLWAY_GOAL,
];
const ROUTE_3A: &[Point] = &[
    Point { x: 68, y: 502 },
    Point { x: 95, y: 476 },
    Point { x: 125, y: 450 },
    Point { x: 150, y: 420 },
    Point { x: 170, y: 385 },
    Point { x: 178, y: 350 },
    Point { x: 180, y: 320 },
    Point { x: 192, y: 299 },
    Point { x: 220, y: 290 },
    Point { x: 250, y: 294 },
    Point { x: 278, y: 282 },
    Point { x: 295, y: 260 },
    Point { x: 300, y: 230 },
    Point { x: 295, y: 200 },
    Point { x: 300, y: 170 },
    Point { x: 318, y: 145 },
    Point { x: 350, y: 126 },
    Point { x: 390, y: 112 },
    Point { x: 430, y: 100 },
    Point { x: 470, y: 94 },
    Point { x: 510, y: 95 },
    Point { x: 550, y: 105 },
    Point { x: 580, y: 125 },
    Point { x: 600, y: 150 },
    Point { x: 610, y: 180 },
    Point { x: 610, y: 215 },
    Point { x: 603, y: 250 },
    Point { x: 606, y: 285 },
    Point { x: 620, y: 315 },
    Point { x: 645, y: 337 },
    Point { x: 675, y: 348 },
    Point { x: 705, y: 370 },
    Point { x: 745, y: 382 },
    Point { x: 780, y: 372 },
    Point { x: 810, y: 345 },
    Point { x: 825, y: 310 },
    Point { x: 820, y: 278 },
    Point { x: 822, y: 245 },
    Point { x: 815, y: 215 },
    Point { x: 810, y: 185 },
    Point { x: 818, y: 150 },
    Point { x: 835, y: 120 },
    Point { x: 850, y: 93 },
    Point { x: 858, y: 67 },
];
const ROUTE_3B: &[Point] = &[
    Point { x: 814, y: 562 },
    Point { x: 810, y: 525 },
    Point { x: 797, y: 490 },
    Point { x: 778, y: 458 },
    Point { x: 752, y: 437 },
    Point { x: 720, y: 425 },
    Point { x: 685, y: 438 },
    Point { x: 650, y: 455 },
    Point { x: 615, y: 450 },
    Point { x: 580, y: 432 },
    Point { x: 545, y: 428 },
    Point { x: 515, y: 416 },
    Point { x: 492, y: 400 },
    Point { x: 476, y: 378 },
    Point { x: 468, y: 355 },
    Point { x: 473, y: 337 },
    Point { x: 491, y: 326 },
    Point { x: 520, y: 319 },
    Point { x: 552, y: 314 },
    Point { x: 580, y: 302 },
    Point { x: 603, y: 285 },
    Point { x: 620, y: 315 },
    Point { x: 645, y: 337 },
    Point { x: 675, y: 348 },
    Point { x: 705, y: 370 },
    Point { x: 745, y: 382 },
    Point { x: 780, y: 372 },
    Point { x: 810, y: 345 },
    Point { x: 825, y: 310 },
    Point { x: 820, y: 278 },
    Point { x: 822, y: 245 },
    Point { x: 815, y: 215 },
    Point { x: 810, y: 185 },
    Point { x: 818, y: 150 },
    Point { x: 835, y: 120 },
    Point { x: 850, y: 93 },
    Point { x: 858, y: 67 },
];
const ROUTE_4A: &[Point] = &[
    Point { x: 253, y: 0 },
    Point { x: 256, y: 35 },
    Point { x: 265, y: 70 },
    Point { x: 280, y: 108 },
    Point { x: 294, y: 145 },
    Point { x: 307, y: 170 },
    Point { x: 330, y: 184 },
    Point { x: 360, y: 190 },
    Point { x: 395, y: 187 },
    Point { x: 430, y: 181 },
    Point { x: 465, y: 179 },
    Point { x: 500, y: 180 },
    Point { x: 535, y: 187 },
    Point { x: 565, y: 202 },
    Point { x: 585, y: 222 },
    Point { x: 598, y: 247 },
    Point { x: 597, y: 270 },
    Point { x: 584, y: 292 },
    Point { x: 565, y: 308 },
    Point { x: 540, y: 318 },
    Point { x: 515, y: 320 },
    Point { x: 495, y: 310 },
    Point { x: 484, y: 292 },
    Point { x: 480, y: 270 },
];
const ROUTE_4B: &[Point] = &[
    Point { x: 714, y: 562 },
    Point { x: 714, y: 525 },
    Point { x: 709, y: 490 },
    Point { x: 699, y: 455 },
    Point { x: 684, y: 425 },
    Point { x: 665, y: 405 },
    Point { x: 642, y: 390 },
    Point { x: 620, y: 374 },
    Point { x: 604, y: 352 },
    Point { x: 593, y: 330 },
    Point { x: 579, y: 312 },
    Point { x: 565, y: 308 },
    Point { x: 540, y: 318 },
    Point { x: 515, y: 320 },
    Point { x: 495, y: 310 },
    Point { x: 484, y: 292 },
    Point { x: 480, y: 270 },
];
const ROUTE_5A: &[Point] = &[
    Point { x: 70, y: 120 },
    Point { x: 105, y: 125 },
    Point { x: 120, y: 150 },
    Point { x: 125, y: 180 },
    Point { x: 165, y: 210 },
    Point { x: 220, y: 230 },
    Point { x: 285, y: 245 },
    Point { x: 345, y: 250 },
    Point { x: 380, y: 245 },
    Point { x: 405, y: 210 },
    Point { x: 450, y: 180 },
    Point { x: 510, y: 175 },
    Point { x: 570, y: 180 },
    Point { x: 620, y: 190 },
    Point { x: 650, y: 155 },
    Point { x: 685, y: 120 },
    Point { x: 720, y: 88 },
    Point { x: 755, y: 65 },
];
const ROUTE_5B: &[Point] = &[
    Point { x: 230, y: 190 },
    Point { x: 250, y: 150 },
    Point { x: 285, y: 115 },
    Point { x: 330, y: 90 },
    Point { x: 390, y: 75 },
    Point { x: 460, y: 65 },
    Point { x: 530, y: 70 },
    Point { x: 580, y: 90 },
    Point { x: 610, y: 120 },
    Point { x: 625, y: 160 },
    Point { x: 620, y: 190 },
    Point { x: 650, y: 155 },
    Point { x: 685, y: 120 },
    Point { x: 720, y: 88 },
    Point { x: 755, y: 65 },
];
const ROUTE_5C: &[Point] = &[
    Point { x: 700, y: 562 },
    Point { x: 720, y: 520 },
    Point { x: 755, y: 480 },
    Point { x: 790, y: 430 },
    Point { x: 820, y: 375 },
    Point { x: 840, y: 315 },
    Point { x: 842, y: 270 },
    Point { x: 820, y: 235 },
    Point { x: 780, y: 215 },
    Point { x: 730, y: 215 },
    Point { x: 680, y: 220 },
    Point { x: 640, y: 225 },
    Point { x: 620, y: 205 },
    Point { x: 620, y: 190 },
    Point { x: 650, y: 155 },
    Point { x: 685, y: 120 },
    Point { x: 720, y: 88 },
    Point { x: 755, y: 65 },
];

const PADS_1: &[Point] = &[
    Point { x: 357, y: 163 },
    Point { x: 257, y: 213 },
    Point { x: 267, y: 322 },
    Point { x: 528, y: 152 },
    Point { x: 593, y: 268 },
    Point { x: 690, y: 370 },
    Point { x: 403, y: 438 },
    Point { x: 906, y: 162 },
    Point { x: 926, y: 242 },
];
const PADS_2: &[Point] = &[
    Point { x: 239, y: 117 },
    Point { x: 597, y: 126 },
    Point { x: 750, y: 124 },
    Point { x: 128, y: 189 },
    Point { x: 339, y: 188 },
    Point { x: 618, y: 185 },
    Point { x: 212, y: 285 },
    Point { x: 398, y: 365 },
    Point { x: 768, y: 364 },
    Point { x: 452, y: 424 },
];
const PADS_3: &[Point] = &[
    Point { x: 451, y: 42 },
    Point { x: 285, y: 105 },
    Point { x: 715, y: 85 },
    Point { x: 365, y: 177 },
    Point { x: 264, y: 251 },
    Point { x: 755, y: 244 },
    Point { x: 139, y: 327 },
    Point { x: 255, y: 355 },
    Point { x: 519, y: 360 },
    Point { x: 748, y: 337 },
    Point { x: 638, y: 411 },
    Point { x: 418, y: 458 },
];
const PADS_4: &[Point] = &[
    Point { x: 384, y: 108 },
    Point { x: 500, y: 141 },
    Point { x: 592, y: 100 },
    Point { x: 236, y: 190 },
    Point { x: 173, y: 228 },
    Point { x: 744, y: 205 },
    Point { x: 727, y: 294 },
    Point { x: 212, y: 331 },
    Point { x: 327, y: 404 },
    Point { x: 244, y: 447 },
    Point { x: 541, y: 406 },
    Point { x: 577, y: 509 },
];
const PADS_5: &[Point] = &[
    Point { x: 476, y: 119 },
    Point { x: 574, y: 142 },
    Point { x: 349, y: 176 },
    Point { x: 309, y: 209 },
    Point { x: 759, y: 184 },
    Point { x: 281, y: 273 },
    Point { x: 707, y: 279 },
    Point { x: 655, y: 332 },
    Point { x: 486, y: 382 },
    Point { x: 446, y: 424 },
    Point { x: 544, y: 435 },
    Point { x: 339, y: 326 },
];

#[must_use]
pub const fn route_count(level: u8) -> u8 {
    match level {
        1 => 1,
        2..=4 => 2,
        5 => 3,
        _ => 0,
    }
}

/// Number of authored lanes enabled for a persisted player-count scale.
/// This mirrors `Scale::paths` without allocating the full level catalog.
#[must_use]
pub const fn active_route_count(level: u8, players: u8) -> u8 {
    let path_profile = match level {
        1 => 1,
        2..=4 => 2,
        5 => 3,
        _ => return 0,
    };
    let clamped_players = if players < 1 {
        1
    } else if players > 4 {
        4
    } else {
        players
    };
    let scaled = scaled_path_count(path_profile, clamped_players - 1);
    let available = route_count(level);
    if scaled < available {
        scaled
    } else {
        available
    }
}

#[must_use]
pub const fn try_route(level: u8, lane: u8) -> Option<&'static [Point]> {
    match (level, lane) {
        (1, 0) => Some(ROUTE_1),
        (2, 0) => Some(ROUTE_2A),
        (2, 1) => Some(ROUTE_2B),
        (3, 0) => Some(ROUTE_3A),
        (3, 1) => Some(ROUTE_3B),
        (4, 0) => Some(ROUTE_4A),
        (4, 1) => Some(ROUTE_4B),
        (5, 0) => Some(ROUTE_5A),
        (5, 1) => Some(ROUTE_5B),
        (5, 2) => Some(ROUTE_5C),
        _ => None,
    }
}

#[must_use]
pub const fn route(level: u8, lane: u8) -> &'static [Point] {
    match try_route(level, lane) {
        Some(points) => points,
        None => &[],
    }
}

#[must_use]
pub const fn build_pads(level: u8) -> &'static [Point] {
    match level {
        1 => PADS_1,
        2 => PADS_2,
        3 => PADS_3,
        4 => PADS_4,
        5 => PADS_5,
        _ => &[],
    }
}

/// Authored build-zone expansion for the active player-count variant.
#[must_use]
pub fn scaled_build_pads(level: u8, players: usize) -> &'static [Point] {
    let pads = build_pads(level);
    let player_count = u8::try_from(players.clamp(1, 4)).unwrap_or(4);
    let count = level_scale(level, player_count)
        .map(|scale| usize::from(scale.build_slots).min(pads.len()))
        .unwrap_or(0);
    &pads[..count]
}

#[derive(Debug)]
struct RouteMetrics {
    cumulative_lengths: Vec<u64>,
}

impl RouteMetrics {
    fn new(points: &[Point]) -> Self {
        let mut cumulative_lengths = Vec::with_capacity(points.len());
        cumulative_lengths.push(0);
        for edge in points.windows(2) {
            let dx = i64::from(edge[1].x) - i64::from(edge[0].x);
            let dy = i64::from(edge[1].y) - i64::from(edge[0].y);
            let squared = u64::try_from(dx * dx + dy * dy).unwrap_or(0);
            let scale = u64::from(PATH_POSITION_SCALE);
            let length = squared.saturating_mul(scale.saturating_mul(scale)).isqrt();
            let previous = cumulative_lengths.last().copied().unwrap_or(0_u64);
            cumulative_lengths.push(previous.saturating_add(length));
        }
        Self { cumulative_lengths }
    }

    fn total_length(&self) -> u64 {
        self.cumulative_lengths.last().copied().unwrap_or(0)
    }
}

static ROUTE_METRICS: OnceLock<[RouteMetrics; 10]> = OnceLock::new();
static LEGACY_SCHOOL_ROUTE_METRICS_V1: OnceLock<[RouteMetrics; 2]> = OnceLock::new();

fn route_metric_index(level: u8, lane: u8) -> Option<usize> {
    match (level, lane) {
        (1, 0) => Some(0),
        (2, 0) => Some(1),
        (2, 1) => Some(2),
        (3, 0) => Some(3),
        (3, 1) => Some(4),
        (4, 0) => Some(5),
        (4, 1) => Some(6),
        (5, 0) => Some(7),
        (5, 1) => Some(8),
        (5, 2) => Some(9),
        _ => None,
    }
}

fn route_metrics(level: u8, lane: u8) -> Option<&'static RouteMetrics> {
    let index = route_metric_index(level, lane)?;
    ROUTE_METRICS
        .get_or_init(|| {
            [
                RouteMetrics::new(ROUTE_1),
                RouteMetrics::new(ROUTE_2A),
                RouteMetrics::new(ROUTE_2B),
                RouteMetrics::new(ROUTE_3A),
                RouteMetrics::new(ROUTE_3B),
                RouteMetrics::new(ROUTE_4A),
                RouteMetrics::new(ROUTE_4B),
                RouteMetrics::new(ROUTE_5A),
                RouteMetrics::new(ROUTE_5B),
                RouteMetrics::new(ROUTE_5C),
            ]
        })
        .get(index)
}

fn legacy_school_route_v1(lane: u8) -> Option<&'static [Point]> {
    match lane {
        0 => Some(LEGACY_SCHOOL_ROUTE_2A_V1),
        1 => Some(LEGACY_SCHOOL_ROUTE_2B_V1),
        _ => None,
    }
}

fn legacy_school_route_metrics_v1(lane: u8) -> Option<&'static RouteMetrics> {
    LEGACY_SCHOOL_ROUTE_METRICS_V1
        .get_or_init(|| {
            [
                RouteMetrics::new(LEGACY_SCHOOL_ROUTE_2A_V1),
                RouteMetrics::new(LEGACY_SCHOOL_ROUTE_2B_V1),
            ]
        })
        .get(usize::from(lane))
}

fn rounded_div(numerator: i128, denominator: i128) -> i128 {
    if numerator >= 0 {
        (numerator + denominator / 2) / denominator
    } else {
        -((-numerator + denominator / 2) / denominator)
    }
}

fn interpolate_coordinate(
    start: u16,
    end: u16,
    local_distance_numerator: u64,
    segment_distance_denominator: u64,
) -> u32 {
    let scale = i128::from(PATH_POSITION_SCALE);
    let start_scaled = i128::from(start) * scale;
    let delta_scaled = (i128::from(end) - i128::from(start)) * scale;
    let offset = rounded_div(
        delta_scaled * i128::from(local_distance_numerator),
        i128::from(segment_distance_denominator),
    );
    u32::try_from(start_scaled + offset).unwrap_or(0)
}

fn precise_position_on_route(
    points: &[Point],
    metrics: &RouteMetrics,
    progress: u16,
) -> PrecisePoint {
    let first = points.first().copied().unwrap_or(Point { x: 0, y: 0 });
    if points.len() < 2 || metrics.total_length() == 0 {
        return PrecisePoint {
            x: u32::from(first.x) * PATH_POSITION_SCALE,
            y: u32::from(first.y) * PATH_POSITION_SCALE,
        };
    }
    if progress >= 1000 {
        let last = points.last().copied().unwrap_or(first);
        return PrecisePoint {
            x: u32::from(last.x) * PATH_POSITION_SCALE,
            y: u32::from(last.y) * PATH_POSITION_SCALE,
        };
    }

    // Keep the target as a rational value so no distance is discarded before
    // the final fixed-point coordinate rounding.
    let target_numerator = metrics.total_length() * u64::from(progress);
    for (index, edge) in points.windows(2).enumerate() {
        let segment_start = metrics.cumulative_lengths[index];
        let segment_end = metrics.cumulative_lengths[index + 1];
        let segment_length = segment_end.saturating_sub(segment_start);
        if segment_length == 0 || target_numerator > segment_end * 1000 {
            continue;
        }
        let local_numerator = target_numerator.saturating_sub(segment_start * 1000);
        let denominator = segment_length * 1000;
        return PrecisePoint {
            x: interpolate_coordinate(edge[0].x, edge[1].x, local_numerator, denominator),
            y: interpolate_coordinate(edge[0].y, edge[1].y, local_numerator, denominator),
        };
    }

    let last = points.last().copied().unwrap_or(first);
    PrecisePoint {
        x: u32::from(last.x) * PATH_POSITION_SCALE,
        y: u32::from(last.y) * PATH_POSITION_SCALE,
    }
}

/// Deterministic arc-length route interpolation with 1/1024-pixel precision.
#[must_use]
pub fn path_position_precise(level: u8, lane: u8, progress: u16) -> PrecisePoint {
    let points = route(level, lane);
    let Some(metrics) = route_metrics(level, lane) else {
        let point = points.first().copied().unwrap_or(Point { x: 0, y: 0 });
        return PrecisePoint {
            x: u32::from(point.x) * PATH_POSITION_SCALE,
            y: u32::from(point.y) * PATH_POSITION_SCALE,
        };
    };
    precise_position_on_route(points, metrics, progress)
}

/// Returns the authored route length in [`PATH_POSITION_SCALE`] fixed-point units.
///
/// Presentation code uses this to tie animation cadence to physical distance rather than
/// normalized progress. Authoritative movement and targeting continue to use route progress.
#[must_use]
pub fn route_length_precise(level: u8, lane: u8) -> u64 {
    route_metrics(level, lane).map_or(0, RouteMetrics::total_length)
}

/// Finds the closest normalized location on a route to a fixed-point world position.
///
/// The projection is used for rare, presentation-sensitive lane transitions;
/// ordinary movement continues to use direct cached arc-length sampling.
#[must_use]
pub fn nearest_route_progress(level: u8, lane: u8, position: PrecisePoint) -> Option<(u16, u64)> {
    let points = route(level, lane);
    let metrics = route_metrics(level, lane)?;
    if points.len() < 2 || metrics.total_length() == 0 {
        return None;
    }
    let mut closest = None;
    for (index, edge) in points.windows(2).enumerate() {
        let scale = i128::from(PATH_POSITION_SCALE);
        let start_x = i128::from(edge[0].x) * scale;
        let start_y = i128::from(edge[0].y) * scale;
        let vector_x = (i128::from(edge[1].x) - i128::from(edge[0].x)) * scale;
        let vector_y = (i128::from(edge[1].y) - i128::from(edge[0].y)) * scale;
        let length_squared = vector_x * vector_x + vector_y * vector_y;
        if length_squared == 0 {
            continue;
        }
        let offset_x = i128::from(position.x) - start_x;
        let offset_y = i128::from(position.y) - start_y;
        let projection = (offset_x * vector_x + offset_y * vector_y).clamp(0, length_squared);
        let segment_length =
            metrics.cumulative_lengths[index + 1] - metrics.cumulative_lengths[index];
        let projected_distance = metrics.cumulative_lengths[index]
            + u64::try_from(rounded_div(
                i128::from(segment_length) * projection,
                length_squared,
            ))
            .unwrap_or(0);
        let progress = u16::try_from(
            (projected_distance * 1000 + metrics.total_length() / 2) / metrics.total_length(),
        )
        .unwrap_or(1000)
        .min(1000);
        let candidate = precise_position_on_route(points, metrics, progress);
        let dx = i64::from(candidate.x) - i64::from(position.x);
        let dy = i64::from(candidate.y) - i64::from(position.y);
        let distance_squared = u64::try_from(dx * dx + dy * dy).unwrap_or(u64::MAX);
        if closest.is_none_or(|(_, best_distance)| distance_squared < best_distance) {
            closest = Some((progress, distance_squared));
        }
    }
    closest
}

/// Resolves movement-version 1 School Hallway progress against its retired
/// arc-length geometry so persisted live enemies can be projected onto a redraw.
#[must_use]
pub fn legacy_school_v1_arc_position_precise(lane: u8, progress: u16) -> Option<PrecisePoint> {
    let points = legacy_school_route_v1(lane)?;
    let metrics = legacy_school_route_metrics_v1(lane)?;
    Some(precise_position_on_route(points, metrics, progress))
}

/// Resolves movement-version 0 School Hallway progress against its retired
/// segment-index geometry before projecting it onto the current authored route.
#[must_use]
pub fn legacy_school_v0_segment_position_precise(lane: u8, progress: u16) -> Option<PrecisePoint> {
    let points = legacy_school_route_v1(lane)?;
    let first = points.first().copied()?;
    if points.len() < 2 {
        return Some(PrecisePoint {
            x: u32::from(first.x) * PATH_POSITION_SCALE,
            y: u32::from(first.y) * PATH_POSITION_SCALE,
        });
    }
    if progress >= 1000 {
        let last = points.last().copied().unwrap_or(first);
        return Some(PrecisePoint {
            x: u32::from(last.x) * PATH_POSITION_SCALE,
            y: u32::from(last.y) * PATH_POSITION_SCALE,
        });
    }

    let segment_count = u64::try_from(points.len() - 1).unwrap_or(1);
    let scaled_progress = u64::from(progress) * segment_count;
    let index = usize::try_from((scaled_progress / 1000).min(segment_count - 1)).unwrap_or(0);
    let fraction = scaled_progress % 1000;
    let edge = [points[index], points[index + 1]];
    Some(PrecisePoint {
        x: interpolate_coordinate(edge[0].x, edge[1].x, fraction, 1000),
        y: interpolate_coordinate(edge[0].y, edge[1].y, fraction, 1000),
    })
}

/// Converts the original segment-index progress metric to arc-length progress.
///
/// This is used only when loading persisted sessions created before the route
/// metric changed. It preserves the enemy's physical location to within one
/// normalized progress unit.
#[must_use]
pub fn legacy_progress_to_arc_progress(level: u8, lane: u8, progress: u16) -> u16 {
    if progress >= 1000 {
        return 1000;
    }
    let points = route(level, lane);
    let Some(metrics) = route_metrics(level, lane) else {
        return progress;
    };
    if points.len() < 2 || metrics.total_length() == 0 {
        return progress;
    }
    let segments = u64::try_from(points.len() - 1).unwrap_or(1);
    let scaled = u64::from(progress) * segments;
    let index = usize::try_from((scaled / 1000).min(segments - 1)).unwrap_or(0);
    let fraction = scaled % 1000;
    let segment_start = metrics.cumulative_lengths[index];
    let segment_length = metrics.cumulative_lengths[index + 1].saturating_sub(segment_start);
    let distance_numerator = segment_start * 1000 + segment_length * fraction;
    u16::try_from((distance_numerator + metrics.total_length() / 2) / metrics.total_length())
        .unwrap_or(progress)
}

/// Arc-length route interpolation rounded for authoritative range checks.
#[must_use]
pub fn path_position(level: u8, lane: u8, progress: u16) -> Point {
    let precise = path_position_precise(level, lane, progress);
    let half = PATH_POSITION_SCALE / 2;
    Point {
        x: u16::try_from((precise.x + half) / PATH_POSITION_SCALE).unwrap_or(u16::MAX),
        y: u16::try_from((precise.y + half) / PATH_POSITION_SCALE).unwrap_or(u16::MAX),
    }
}

fn orientation(first: Point, second: Point, third: Point) -> i64 {
    (i64::from(second.x) - i64::from(first.x)) * (i64::from(third.y) - i64::from(first.y))
        - (i64::from(second.y) - i64::from(first.y)) * (i64::from(third.x) - i64::from(first.x))
}

fn point_on_segment(start: Point, end: Point, point: Point) -> bool {
    orientation(start, end, point) == 0
        && point.x >= start.x.min(end.x)
        && point.x <= start.x.max(end.x)
        && point.y >= start.y.min(end.y)
        && point.y <= start.y.max(end.y)
}

fn segments_intersect(a: Point, b: Point, c: Point, d: Point) -> bool {
    let first = orientation(a, b, c);
    let second = orientation(a, b, d);
    let third = orientation(c, d, a);
    let fourth = orientation(c, d, b);
    (first.signum() != second.signum()
        && third.signum() != fourth.signum()
        && first != 0
        && second != 0
        && third != 0
        && fourth != 0)
        || (first == 0 && point_on_segment(a, b, c))
        || (second == 0 && point_on_segment(a, b, d))
        || (third == 0 && point_on_segment(c, d, a))
        || (fourth == 0 && point_on_segment(c, d, b))
}

fn segments_meet_only_at(a: Point, b: Point, c: Point, d: Point, point: Point) -> bool {
    let first_has_point = a == point || b == point;
    let second_has_point = c == point || d == point;
    if !first_has_point || !second_has_point {
        return false;
    }
    let first_other = if a == point { b } else { a };
    let second_other = if c == point { d } else { c };
    if orientation(first_other, point, second_other) != 0 {
        return true;
    }
    let first_x = i64::from(first_other.x) - i64::from(point.x);
    let first_y = i64::from(first_other.y) - i64::from(point.y);
    let second_x = i64::from(second_other.x) - i64::from(point.x);
    let second_y = i64::from(second_other.y) - i64::from(point.y);
    first_x * second_x + first_y * second_y <= 0
}

fn common_suffix_start(first: &[Point], second: &[Point]) -> Option<(usize, usize, Point)> {
    let suffix_len = first
        .iter()
        .rev()
        .zip(second.iter().rev())
        .take_while(|(left, right)| left == right)
        .count();
    if suffix_len == 0 {
        return None;
    }
    let first_start = first.len() - suffix_len;
    let second_start = second.len() - suffix_len;
    Some((first_start, second_start, first[first_start]))
}

fn routes_merge_without_crossing(first: &[Point], second: &[Point]) -> bool {
    let Some((first_merge, second_merge, merge_point)) = common_suffix_start(first, second) else {
        return false;
    };
    for first_index in 0..first.len().saturating_sub(1) {
        for second_index in 0..second.len().saturating_sub(1) {
            if first_index >= first_merge && second_index >= second_merge {
                continue;
            }
            let first_start = first[first_index];
            let first_end = first[first_index + 1];
            let second_start = second[second_index];
            let second_end = second[second_index + 1];
            if segments_intersect(first_start, first_end, second_start, second_end)
                && !segments_meet_only_at(
                    first_start,
                    first_end,
                    second_start,
                    second_end,
                    merge_point,
                )
            {
                return false;
            }
        }
    }
    true
}

fn squared_distance_to_segment(point: Point, start: Point, end: Point) -> f64 {
    let segment_x = f64::from(end.x) - f64::from(start.x);
    let segment_y = f64::from(end.y) - f64::from(start.y);
    let point_x = f64::from(point.x) - f64::from(start.x);
    let point_y = f64::from(point.y) - f64::from(start.y);
    let length_squared = segment_x * segment_x + segment_y * segment_y;
    if length_squared <= f64::EPSILON {
        return point_x * point_x + point_y * point_y;
    }
    let projection = ((point_x * segment_x + point_y * segment_y) / length_squared).clamp(0., 1.);
    let nearest_x = f64::from(start.x) + projection * segment_x;
    let nearest_y = f64::from(start.y) + projection * segment_y;
    let distance_x = f64::from(point.x) - nearest_x;
    let distance_y = f64::from(point.y) - nearest_y;
    distance_x * distance_x + distance_y * distance_y
}

fn route_clears_build_pads(points: &[Point], pads: &[Point], minimum_clearance: u16) -> bool {
    let required = f64::from(minimum_clearance).powi(2);
    pads.iter().all(|pad| {
        points
            .windows(2)
            .all(|edge| squared_distance_to_segment(*pad, edge[0], edge[1]) >= required)
    })
}

fn route_geometry_is_valid(points: &[Point], width: u16, height: u16) -> bool {
    if points.len() < 2
        || points
            .iter()
            .any(|point| point.x > width || point.y > height)
    {
        return false;
    }
    let mut unique = HashSet::with_capacity(points.len());
    if points
        .iter()
        .any(|point| !unique.insert((point.x, point.y)))
    {
        return false;
    }
    if points.windows(2).any(|edge| {
        let dx = i64::from(edge[1].x) - i64::from(edge[0].x);
        let dy = i64::from(edge[1].y) - i64::from(edge[0].y);
        dx * dx + dy * dy > 75_i64.pow(2)
    }) {
        return false;
    }
    for first in 0..points.len() - 1 {
        for second in first + 2..points.len() - 1 {
            if segments_intersect(
                points[first],
                points[first + 1],
                points[second],
                points[second + 1],
            ) {
                return false;
            }
        }
    }
    true
}

const fn upgrade_mechanic_is_valid(mechanic: UpgradeMechanic) -> bool {
    match mechanic {
        UpgradeMechanic::None => true,
        UpgradeMechanic::Chain {
            radius,
            extra_targets,
            secondary_damage_percent,
        } => {
            radius > 0
                && extra_targets > 0
                && extra_targets <= 4
                && secondary_damage_percent > 0
                && secondary_damage_percent <= 100
        }
        UpgradeMechanic::MissingHealth {
            max_bonus_percent,
            execute_percent,
        } => max_bonus_percent <= 200 && execute_percent <= 25,
        UpgradeMechanic::Knockback { progress } => progress > 0 && progress <= 80,
        UpgradeMechanic::DistanceDamage { max_bonus_percent } => max_bonus_percent <= 160,
        UpgradeMechanic::ArmorShred { armor } => armor > 0 && armor <= 60,
        UpgradeMechanic::TeamIncome { teammate_percent } => teammate_percent <= 100,
        UpgradeMechanic::BossDamage { bonus_percent } => bonus_percent <= 200,
        UpgradeMechanic::LeakGuard { damage } => damage > 0 && damage <= 4,
    }
}

fn upgrade_definition_is_valid(path: &UpgradePathDefinition) -> bool {
    if path.name.trim().is_empty() || path.description.trim().is_empty() {
        return false;
    }
    let mut previous_cost = 0;
    for (tier, mechanic) in path.tiers.iter().zip(path.mechanics) {
        if tier.name.trim().is_empty()
            || tier.effect.trim().is_empty()
            || tier.cost <= previous_cost
            || (tier.growth == UpgradeGrowth::default() && mechanic == UpgradeMechanic::None)
            || !upgrade_mechanic_is_valid(mechanic)
        {
            return false;
        }
        previous_cost = tier.cost;
    }
    true
}

pub fn validate() -> Result<(), ContentError> {
    let definitions = defenders();
    let defender_ids: HashSet<_> = definitions.iter().map(|defender| defender.id).collect();
    for defender in definitions {
        let first = upgrade_path(defender.id, defender.upgrade_paths[0])
            .ok_or(ContentError::InvalidUpgrade)?;
        let second = upgrade_path(defender.id, defender.upgrade_paths[1])
            .ok_or(ContentError::InvalidUpgrade)?;
        if !upgrade_definition_is_valid(&first)
            || !upgrade_definition_is_valid(&second)
            || first.name == second.name
            || (first.tiers == second.tiers && first.mechanics == second.mechanics)
        {
            return Err(ContentError::InvalidUpgrade);
        }
    }
    for level in levels() {
        if level.waves.is_empty() {
            return Err(ContentError::MissingWaves);
        }
        if level.scales.iter().any(|scale| {
            scale.width == 0
                || scale.height == 0
                || scale.paths == 0
                || scale.entrances == 0
                || scale.entrances > scale.paths
                || usize::from(scale.paths) > level.map.paths.len()
                || scale.build_slots == 0
                || scale.resource_per_player == 0
        }) {
            return Err(ContentError::InvalidScaling);
        }
        for (player_index, scale) in level.scales.iter().enumerate() {
            if scale.paths
                != active_route_count(level.id, u8::try_from(player_index + 1).unwrap_or(u8::MAX))
            {
                return Err(ContentError::InvalidScaling);
            }
            let active_paths = &level.map.paths[..usize::from(scale.paths)];
            let entrances: HashSet<_> = active_paths
                .iter()
                .filter_map(|path| path.first())
                .map(|point| (point.x, point.y))
                .collect();
            let goals: HashSet<_> = active_paths
                .iter()
                .filter_map(|path| path.last())
                .map(|point| (point.x, point.y))
                .collect();
            if entrances.len() != usize::from(scale.entrances) || goals.len() != 1 {
                return Err(ContentError::InvalidScaling);
            }
        }
        let Some(shared_zone) = level.map.build_zones.first() else {
            return Err(ContentError::InvalidMap);
        };
        if level.map.asset.is_empty()
            || level.map.logical_width == 0
            || level.map.logical_height == 0
            || level.map.paths.is_empty()
            || level.map.paths.iter().enumerate().any(|(lane, path)| {
                path.as_slice() != route(level.id, u8::try_from(lane).unwrap_or(u8::MAX))
                    || !route_geometry_is_valid(
                        path,
                        level.map.logical_width,
                        level.map.logical_height,
                    )
                    || !route_clears_build_pads(
                        path,
                        &shared_zone.pads,
                        if level.id == 1 { 40 } else { 18 },
                    )
            })
            || level
                .map
                .paths
                .iter()
                .enumerate()
                .any(|(first_index, first)| {
                    level.map.paths[first_index + 1..]
                        .iter()
                        .any(|second| !routes_merge_without_crossing(first, second))
                })
            || level.map.build_zones.len() != 1
            || shared_zone.id != "shared"
            || shared_zone.ownership != BuildZoneOwnership::Cooperative
            || shared_zone.pads != build_pads(level.id)
        {
            return Err(ContentError::InvalidMap);
        }
        if shared_zone.pads.len() < 8
            || level
                .scales
                .iter()
                .any(|scale| usize::from(scale.build_slots) > shared_zone.pads.len())
        {
            return Err(ContentError::MissingBuildPads);
        }
        let available: HashSet<_> = level.available_defenders.iter().copied().collect();
        if available.is_empty()
            || available.len() != level.available_defenders.len()
            || !available.is_subset(&defender_ids)
        {
            return Err(ContentError::InvalidAvailability);
        }
        let expected_unlock = if level.id == 1 {
            LevelUnlock::Initial
        } else {
            LevelUnlock::CompleteLevel(level.id - 1)
        };
        if level.unlock != expected_unlock
            || level.scoring.two_star_health_percent == 0
            || level.scoring.two_star_health_percent >= level.scoring.three_star_health_percent
            || level.scoring.three_star_health_percent > 100
        {
            return Err(ContentError::InvalidProgression);
        }
        let route_count = level.scales[3].paths;
        if level
            .waves
            .iter()
            .flat_map(|wave| &wave.spawns)
            .any(|spawn| spawn.path >= route_count)
        {
            return Err(ContentError::InvalidRoute);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_content_is_valid() {
        assert_eq!(validate(), Ok(()));
    }

    #[test]
    fn enemy_roster_preserves_stable_ids_and_authored_presentation() {
        let approved = [
            (
                EnemyKind::Basic,
                "basic",
                "Tralalero Tralala",
                "A steady all-rounder that advances without armor or special defenses.",
            ),
            (
                EnemyKind::Fast,
                "fast",
                "Cappuccino Assassino",
                "A fragile sprinter that trades durability for exceptional speed.",
            ),
            (
                EnemyKind::Armored,
                "armored",
                "Tung Tung Tung Sahur",
                "A slow, heavily armored bruiser that resists low-pierce attacks.",
            ),
            (
                EnemyKind::Swarm,
                "swarm",
                "Ballerina Cappuccina",
                "A lightweight rush unit that attacks in dense, fast-moving groups.",
            ),
            (
                EnemyKind::Disruption,
                "disruption",
                "Boneca Ambalabu",
                "A resilient mid-speed threat protected by light armor.",
            ),
            (
                EnemyKind::Boss,
                "boss",
                "La Vaca Saturno Saturnita",
                "The armored final boss shifts lanes below half health and deals severe leak damage.",
            ),
        ];

        let mut ids = HashSet::with_capacity(approved.len());
        for (kind, expected_id, expected_name, expected_description) in approved {
            let definition = enemy(kind);
            assert_eq!(kind.id(), expected_id);
            assert!(ids.insert(kind.id()));
            assert_eq!(definition.display_name, expected_name);
            assert_eq!(definition.description, expected_description);
        }
        assert_eq!(ids.len(), 6);
    }

    #[test]
    fn every_level_scales_all_player_counts() {
        for level in levels() {
            assert_eq!(level.scales.len(), 4);
            assert!(
                level
                    .scales
                    .windows(2)
                    .all(|pair| pair[1].width > pair[0].width)
            );
        }
    }

    #[test]
    fn authored_routes_have_stable_endpoints() {
        let approved = [
            (1, 0, Point { x: 62, y: 478 }, Point { x: 876, y: 91 }),
            (2, 0, Point { x: 52, y: 126 }, SCHOOL_HALLWAY_GOAL),
            (2, 1, Point { x: 0, y: 389 }, SCHOOL_HALLWAY_GOAL),
            (3, 0, Point { x: 68, y: 502 }, Point { x: 858, y: 67 }),
            (3, 1, Point { x: 814, y: 562 }, Point { x: 858, y: 67 }),
            (4, 0, Point { x: 253, y: 0 }, Point { x: 480, y: 270 }),
            (4, 1, Point { x: 714, y: 562 }, Point { x: 480, y: 270 }),
            (5, 0, Point { x: 70, y: 120 }, Point { x: 755, y: 65 }),
            (5, 1, Point { x: 230, y: 190 }, Point { x: 755, y: 65 }),
            (5, 2, Point { x: 700, y: 562 }, Point { x: 755, y: 65 }),
        ];
        for (level, lane, expected_start, expected_goal) in approved {
            assert_eq!(path_position(level, lane, 0), expected_start);
            assert_eq!(path_position(level, lane, 1000), expected_goal);
            assert_eq!(route(level, lane).first(), Some(&expected_start));
            assert_eq!(route(level, lane).last(), Some(&expected_goal));
        }
    }

    #[test]
    fn school_hallway_lanes_share_the_reviewed_server_room_tail() {
        let upper = route(2, 0);
        let lower = route(2, 1);
        let (upper_merge, lower_merge, merge) =
            common_suffix_start(upper, lower).expect("school lanes must merge");

        assert_eq!(merge, SCHOOL_HALLWAY_MERGE);
        assert_eq!(&upper[upper_merge..], &lower[lower_merge..]);
        assert!(upper.len() - upper_merge >= 5);
        assert_eq!(upper.last(), Some(&SCHOOL_HALLWAY_GOAL));
        assert_eq!(lower.last(), Some(&SCHOOL_HALLWAY_GOAL));

        let school = levels()
            .into_iter()
            .find(|level| level.id == 2)
            .expect("school level");
        assert_eq!(school.map.asset, "assets/maps/school-hallway-rush-v2.webp");
    }

    #[test]
    fn retired_school_routes_preserve_both_legacy_progress_metrics() {
        for (lane, entrance) in [(0, Point { x: 52, y: 126 }), (1, Point { x: 0, y: 389 })] {
            let entrance = PrecisePoint {
                x: u32::from(entrance.x) * PATH_POSITION_SCALE,
                y: u32::from(entrance.y) * PATH_POSITION_SCALE,
            };
            let retired_goal = PrecisePoint {
                x: 806 * PATH_POSITION_SCALE,
                y: 245 * PATH_POSITION_SCALE,
            };
            assert_eq!(
                legacy_school_v1_arc_position_precise(lane, 0),
                Some(entrance)
            );
            assert_eq!(
                legacy_school_v0_segment_position_precise(lane, 0),
                Some(entrance)
            );
            assert_eq!(
                legacy_school_v1_arc_position_precise(lane, 1000),
                Some(retired_goal)
            );
            assert_eq!(
                legacy_school_v0_segment_position_precise(lane, 1000),
                Some(retired_goal)
            );
        }
        assert_eq!(legacy_school_v1_arc_position_precise(2, 500), None);
        assert_eq!(legacy_school_v0_segment_position_precise(2, 500), None);
    }

    #[test]
    fn progress_follows_route_distance_instead_of_waypoint_count() {
        let points = [
            Point { x: 0, y: 0 },
            Point { x: 10, y: 0 },
            Point { x: 10, y: 90 },
        ];
        let metrics = RouteMetrics::new(&points);
        let at_join = precise_position_on_route(&points, &metrics, 100);
        let halfway = precise_position_on_route(&points, &metrics, 500);
        assert_eq!(
            at_join,
            PrecisePoint {
                x: 10 * PATH_POSITION_SCALE,
                y: 0,
            }
        );
        assert_eq!(
            halfway,
            PrecisePoint {
                x: 10 * PATH_POSITION_SCALE,
                y: 40 * PATH_POSITION_SCALE,
            }
        );
    }

    #[test]
    fn legacy_progress_migration_preserves_physical_location() {
        for level in levels() {
            for lane in 0..route_count(level.id) {
                let points = route(level.id, lane);
                let segments = u32::try_from(points.len() - 1).expect("authored route segments");
                for legacy_progress in (0_u32..=1000).step_by(17) {
                    let old_position = if legacy_progress >= 1000 {
                        *points.last().expect("route endpoint")
                    } else {
                        let scaled = legacy_progress * segments;
                        let index = usize::try_from((scaled / 1000).min(segments - 1))
                            .expect("route segment index");
                        let fraction = scaled % 1000;
                        let start = points[index];
                        let end = points[index + 1];
                        Point {
                            x: u16::try_from(
                                i32::from(start.x)
                                    + (i32::from(end.x) - i32::from(start.x))
                                        * i32::try_from(fraction).expect("fraction")
                                        / 1000,
                            )
                            .expect("legacy x"),
                            y: u16::try_from(
                                i32::from(start.y)
                                    + (i32::from(end.y) - i32::from(start.y))
                                        * i32::try_from(fraction).expect("fraction")
                                        / 1000,
                            )
                            .expect("legacy y"),
                        }
                    };
                    let migrated = legacy_progress_to_arc_progress(
                        level.id,
                        lane,
                        u16::try_from(legacy_progress).expect("normalized progress"),
                    );
                    let new_position = path_position(level.id, lane, migrated);
                    let dx = i64::from(old_position.x) - i64::from(new_position.x);
                    let dy = i64::from(old_position.y) - i64::from(new_position.y);
                    assert!(
                        dx * dx + dy * dy <= 9,
                        "level {} lane {lane} moved at {legacy_progress}: {old_position:?} -> {new_position:?}",
                        level.id
                    );
                }
            }
        }
    }

    #[test]
    fn precise_route_sampling_never_stalls_for_a_moving_enemy() {
        for level in levels() {
            for lane in 0..route_count(level.id) {
                let mut previous = path_position_precise(level.id, lane, 0);
                for progress in 1..1000 {
                    let current = path_position_precise(level.id, lane, progress);
                    assert_ne!(
                        current, previous,
                        "level {} lane {lane} stalled at progress {progress}",
                        level.id
                    );
                    previous = current;
                }
            }
        }
    }

    #[test]
    fn cached_route_lengths_match_their_authored_polylines() {
        for level in levels() {
            for lane in 0..route_count(level.id) {
                let expected = RouteMetrics::new(route(level.id, lane)).total_length();
                let actual = route_length_precise(level.id, lane);
                assert_eq!(actual, expected, "level {} lane {lane}", level.id);
                assert!(actual > u64::from(PATH_POSITION_SCALE));
            }
        }
        assert_eq!(route_length_precise(0, 0), 0);
        assert_eq!(route_length_precise(5, 3), 0);
    }

    #[test]
    fn route_projection_only_connects_lanes_at_a_physical_merge() {
        let distant = path_position_precise(5, 0, 200);
        let (_, distant_squared) =
            nearest_route_progress(5, 1, distant).expect("final level second lane");
        let tolerance = u64::from(PATH_POSITION_SCALE) * 5;
        assert!(distant_squared > tolerance * tolerance);

        let merged = path_position_precise(5, 0, 900);
        let (projected_progress, merged_squared) =
            nearest_route_progress(5, 1, merged).expect("final level shared tail");
        let projected = path_position_precise(5, 1, projected_progress);
        assert!(merged_squared <= tolerance * tolerance);
        let dx = i64::from(projected.x) - i64::from(merged.x);
        let dy = i64::from(projected.y) - i64::from(merged.y);
        assert!(dx * dx + dy * dy <= i64::try_from(tolerance * tolerance).unwrap_or(i64::MAX));
    }

    #[test]
    fn active_route_counts_and_endpoint_topology_match_every_scale() {
        for level in levels() {
            for (player_index, scale) in level.scales.iter().enumerate() {
                let players = u8::try_from(player_index + 1).expect("supported player count");
                assert_eq!(active_route_count(level.id, players), scale.paths);
                let active = &level.map.paths[..usize::from(scale.paths)];
                let entrances: HashSet<_> = active
                    .iter()
                    .map(|path| path.first().expect("route start"))
                    .map(|point| (point.x, point.y))
                    .collect();
                let goals: HashSet<_> = active
                    .iter()
                    .map(|path| path.last().expect("route goal"))
                    .map(|point| (point.x, point.y))
                    .collect();
                assert_eq!(entrances.len(), usize::from(scale.entrances));
                assert_eq!(goals.len(), 1, "level {} player scale {players}", level.id);
            }
        }
    }

    #[test]
    fn allocation_free_scale_lookup_matches_structured_level_content() {
        for level in levels() {
            for (player_index, expected) in level.scales.iter().enumerate() {
                let players = u8::try_from(player_index + 1).expect("supported player count");
                assert_eq!(level_scale(level.id, players), Some(*expected));
            }
        }
        assert_eq!(level_scale(1, 0), level_scale(1, 1));
        assert_eq!(level_scale(5, u8::MAX), level_scale(5, 4));
        assert_eq!(level_scale(0, 1), None);
        assert_eq!(level_scale(6, 1), None);
    }

    #[test]
    fn route_lookup_rejects_undeclared_levels_and_lanes() {
        for level in 1..=5 {
            for lane in 0..route_count(level) {
                assert!(try_route(level, lane).is_some());
            }
            assert!(try_route(level, route_count(level)).is_none());
            assert!(try_route(level, u8::MAX).is_none());
        }
        assert!(try_route(0, 0).is_none());
        assert!(try_route(6, 0).is_none());
        assert!(route(0, 0).is_empty());
    }

    #[test]
    fn backyard_contract_has_one_mailbox_to_shed_lane_and_nine_useful_pedestals() {
        let expected_pads = [
            Point { x: 357, y: 163 },
            Point { x: 257, y: 213 },
            Point { x: 267, y: 322 },
            Point { x: 528, y: 152 },
            Point { x: 593, y: 268 },
            Point { x: 690, y: 370 },
            Point { x: 403, y: 438 },
            Point { x: 906, y: 162 },
            Point { x: 926, y: 242 },
        ];
        assert_eq!(build_pads(1), expected_pads);
        assert_eq!(route_count(1), 1);
        assert!(try_route(1, 1).is_none());
        for players in 1..=4 {
            let scale = level_scale(1, players).expect("backyard scale");
            assert_eq!(scale.paths, 1);
            assert_eq!(scale.entrances, 1);
        }

        let backyard = route(1, 0);
        assert_eq!(backyard.len(), 54);
        for edge in backyard.windows(2) {
            let dx = f64::from(edge[1].x) - f64::from(edge[0].x);
            let dy = f64::from(edge[1].y) - f64::from(edge[0].y);
            let length = dx.hypot(dy);
            assert!(
                (18.0..=26.0).contains(&length),
                "backyard route segment {edge:?} is too sparse for a smooth bend at {length}"
            );
        }
        for pad in expected_pads {
            assert!((140..=470).contains(&pad.y), "HUD-safe pad {pad:?}");
            let nearest = backyard
                .windows(2)
                .map(|edge| squared_distance_to_segment(pad, edge[0], edge[1]).sqrt())
                .fold(f64::INFINITY, f64::min);
            assert!(
                nearest >= 40.,
                "pad {pad:?} overlaps the gravel at {nearest}"
            );
            assert!(
                nearest <= 110.,
                "pad {pad:?} cannot cover the lane at {nearest}"
            );
        }
        for (index, first) in expected_pads.iter().enumerate() {
            for second in &expected_pads[index + 1..] {
                let dx = f64::from(first.x) - f64::from(second.x);
                let dy = f64::from(first.y) - f64::from(second.y);
                assert!(
                    dx.hypot(dy) >= 80.,
                    "pedestals overlap: {first:?} {second:?}"
                );
            }
        }
    }

    #[test]
    fn route_geometry_is_dense_bounded_and_non_self_intersecting() {
        for level in levels() {
            for (lane_index, path) in level.map.paths.iter().enumerate() {
                assert!(route_geometry_is_valid(
                    path,
                    level.map.logical_width,
                    level.map.logical_height,
                ));
                let lane = u8::try_from(lane_index).expect("authored route index");
                let mut previous = path_position(level.id, lane, 0);
                for progress in 1..=1000 {
                    let current = path_position(level.id, lane, progress);
                    assert!(current.x <= level.map.logical_width);
                    assert!(current.y <= level.map.logical_height);
                    let dx = i64::from(current.x) - i64::from(previous.x);
                    let dy = i64::from(current.y) - i64::from(previous.y);
                    assert!(dx * dx + dy * dy <= 25, "level {} lane {lane}", level.id);
                    previous = current;
                }
            }
        }
    }

    #[test]
    fn route_geometry_rejects_crossings_overlaps_and_non_adjacent_touches() {
        let crossing = [
            Point { x: 0, y: 0 },
            Point { x: 20, y: 20 },
            Point { x: 0, y: 20 },
            Point { x: 20, y: 0 },
        ];
        let overlap = [
            Point { x: 0, y: 0 },
            Point { x: 20, y: 0 },
            Point { x: 5, y: 0 },
            Point { x: 25, y: 0 },
        ];
        let endpoint_on_segment = [
            Point { x: 0, y: 0 },
            Point { x: 20, y: 0 },
            Point { x: 20, y: 20 },
            Point { x: 10, y: 0 },
            Point { x: 30, y: 0 },
        ];
        assert!(!route_geometry_is_valid(&crossing, 30, 30));
        assert!(!route_geometry_is_valid(&overlap, 30, 30));
        assert!(!route_geometry_is_valid(&endpoint_on_segment, 30, 30));
    }

    #[test]
    fn authored_lanes_merge_without_crossing_and_clear_build_pads() {
        for level in levels() {
            for (first_index, first) in level.map.paths.iter().enumerate() {
                assert!(route_clears_build_pads(
                    first,
                    &level.map.build_zones[0].pads,
                    18
                ));
                for second in &level.map.paths[first_index + 1..] {
                    assert!(routes_merge_without_crossing(first, second));
                }
            }
        }

        let legal_merge = [
            Point { x: 0, y: 0 },
            Point { x: 10, y: 10 },
            Point { x: 20, y: 10 },
            Point { x: 30, y: 10 },
        ];
        let legal_second_lane = [
            Point { x: 0, y: 20 },
            Point { x: 10, y: 10 },
            Point { x: 20, y: 10 },
            Point { x: 30, y: 10 },
        ];
        let crossing_lane = [
            Point { x: 0, y: 20 },
            Point { x: 20, y: 0 },
            Point { x: 30, y: 10 },
        ];
        assert!(routes_merge_without_crossing(
            &legal_merge,
            &legal_second_lane
        ));
        assert!(!routes_merge_without_crossing(&legal_merge, &crossing_lane));

        let straight_route = [Point { x: 0, y: 0 }, Point { x: 100, y: 0 }];
        assert!(route_clears_build_pads(
            &straight_route,
            &[Point { x: 50, y: 18 }],
            18
        ));
        assert!(!route_clears_build_pads(
            &straight_route,
            &[Point { x: 50, y: 17 }],
            18
        ));
    }

    #[test]
    fn levels_expose_complete_structured_map_and_progression_metadata() {
        for (index, level) in levels().into_iter().enumerate() {
            let expected_id = u8::try_from(index + 1).expect("five authored levels");
            assert_eq!(level.id, expected_id);
            assert!(level.map.asset.starts_with("assets/maps/"));
            assert!(level.map.asset.ends_with(".webp"));
            assert_eq!(level.map.logical_width, 1000);
            assert_eq!(level.map.logical_height, 562);
            assert_eq!(level.map.paths.len(), usize::from(level.scales[3].paths));
            for (lane, path) in level.map.paths.iter().enumerate() {
                assert_eq!(
                    path.as_slice(),
                    route(level.id, u8::try_from(lane).expect("authored lane"))
                );
            }
            assert_eq!(level.map.build_zones.len(), 1);
            assert_eq!(level.map.build_zones[0].id, "shared");
            assert_eq!(level.map.build_zones[0].pads, build_pads(level.id));
            assert!(!level.available_defenders.is_empty());
            assert_eq!(
                level.unlock,
                if level.id == 1 {
                    LevelUnlock::Initial
                } else {
                    LevelUnlock::CompleteLevel(level.id - 1)
                }
            );
            assert_eq!(level.scoring.stars_for_health_percent(0), 1);
            assert_eq!(
                level
                    .scoring
                    .stars_for_health_percent(level.scoring.two_star_health_percent),
                2
            );
            assert_eq!(
                level
                    .scoring
                    .stars_for_health_percent(level.scoring.three_star_health_percent),
                3
            );
        }
    }

    #[test]
    fn every_defender_has_two_distinct_authored_upgrade_paths() {
        for defender in defenders() {
            let first =
                upgrade_path(defender.id, defender.upgrade_paths[0]).expect("first upgrade path");
            let second =
                upgrade_path(defender.id, defender.upgrade_paths[1]).expect("second upgrade path");
            assert_ne!(first.name, second.name, "{} path names", defender.id);
            assert!(
                first.tiers != second.tiers || first.mechanics != second.mechanics,
                "{} paths must make different mechanical choices",
                defender.id
            );
        }
    }

    #[test]
    fn every_upgrade_path_authors_four_escalating_purchases_through_level_five() {
        assert_eq!(MAX_DEFENDER_LEVEL, 5);
        for defender in defenders() {
            for path_name in defender.upgrade_paths {
                let path = upgrade_path(defender.id, path_name).expect("authored upgrade path");
                let mut prior_cost = 0;
                for (tier_index, tier) in path.tiers.iter().enumerate() {
                    assert!(
                        tier.cost > prior_cost,
                        "{} {} costs",
                        defender.id,
                        path_name
                    );
                    assert!(!tier.name.trim().is_empty());
                    assert!(!tier.effect.trim().is_empty());
                    assert_eq!(
                        next_upgrade_tier(
                            defender.id,
                            path_name,
                            u8::try_from(tier_index + 1).expect("tier level"),
                        ),
                        Some(*tier),
                    );
                    prior_cost = tier.cost;
                }
                assert_eq!(
                    next_upgrade_tier(defender.id, path_name, MAX_DEFENDER_LEVEL),
                    None,
                );
            }
        }
    }

    #[test]
    fn solo_final_form_max_is_explicitly_income_strategy_gated() {
        let level = levels()
            .into_iter()
            .find(|candidate| candidate.id == 5)
            .expect("final feed content");
        let scale = level.scales[0];
        let enemy_rewards = level
            .waves
            .iter()
            .flat_map(|wave| &wave.spawns)
            .map(|spawn| {
                let scaled_count =
                    (u32::from(spawn.count) * u32::from(scale.wave_percent)).div_ceil(100);
                scaled_count * enemy(spawn.kind).reward
            })
            .sum::<u32>();
        let non_final_waves = u32::try_from(level.waves.len().saturating_sub(1))
            .expect("authored wave count fits u32");
        let combat_only_budget =
            scale.resource_per_player + enemy_rewards + non_final_waves * WAVE_CLEAR_BONUS;
        let final_form = defenders()
            .into_iter()
            .find(|defender| defender.id == "final_form")
            .expect("final form content");

        for path_name in final_form.upgrade_paths {
            let path = upgrade_path(final_form.id, path_name).expect("final form upgrade path");
            let max_path_cost =
                final_form.cost + path.tiers.iter().map(|tier| tier.cost).sum::<u32>();
            assert_eq!(max_path_cost, 2_905);
            assert!(
                combat_only_budget < max_path_cost,
                "the most expensive solo path is intentionally not a passive unlock"
            );
        }
        assert_eq!(combat_only_budget, 2_481);

        let income_defender = defenders()
            .into_iter()
            .find(|defender| defender.id == "side_hustler")
            .expect("income strategy content");
        assert!(level.available_defenders.contains(&income_defender.id));
        assert!(income_defender.cost <= scale.resource_per_player);
        assert!(income_defender.income > 0);
    }

    #[test]
    fn balance_matrix_covers_all_levels_and_player_counts() {
        let mut cases = 0;
        for level in levels() {
            let mut prior_workload = 0_u64;
            let mut prior_team_resources = 0_u32;
            let mut prior_paths = 0_u8;
            for players in 1..=4 {
                cases += 1;
                let scale = &level.scales[players - 1];
                assert!((1..=3).contains(&scale.paths));
                assert_eq!(scale.entrances, scale.paths);
                assert!(scale.paths >= prior_paths);
                assert_eq!(
                    scaled_build_pads(level.id, players).len(),
                    usize::from(scale.build_slots)
                );
                assert!(scale.resource_per_player >= 90);
                assert!(scale.boss_phase_ticks > 0);
                for lane in 0..scale.paths {
                    assert!(route(level.id, lane).len() >= 2);
                }

                let team_resources = scale.resource_per_player
                    * u32::try_from(players).expect("supported player count");
                assert!(team_resources > prior_team_resources);
                prior_team_resources = team_resources;
                prior_paths = scale.paths;

                let workload = level
                    .waves
                    .iter()
                    .flat_map(|wave| &wave.spawns)
                    .map(|spawn| {
                        let count = (u64::from(spawn.count) * u64::from(scale.wave_percent))
                            .div_ceil(100)
                            .max(1);
                        let health = u64::try_from(enemy(spawn.kind).health)
                            .expect("enemy health is positive");
                        count * health * u64::from(scale.enemy_percent) / 100
                    })
                    .sum::<u64>();
                assert!(workload > prior_workload);
                prior_workload = workload;
            }
        }
        assert_eq!(cases, 20);
    }
}
