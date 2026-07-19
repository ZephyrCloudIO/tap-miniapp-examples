//! Allocation-conscious, presentation-only canvas rendering for game state.
use game_content::{
    MAX_DEFENDER_LEVEL, PATH_POSITION_SCALE, UpgradeGrowth, defenders, path_position,
    path_position_precise, route_length_precise, upgrade_path,
};
use game_protocol::{DefenderState, EnemyState, SessionSnapshot, SessionStatus, TargetPolicy};
use std::cell::{Cell, RefCell};
use std::f64::consts::{PI, TAU};
use wasm_bindgen::{JsCast, JsValue};
use web_sys::{CanvasRenderingContext2d, HtmlCanvasElement, HtmlImageElement};

#[derive(Clone)]
struct Assets {
    maps: [HtmlImageElement; 5],
    defenders: HtmlImageElement,
    enemies: HtmlImageElement,
}

thread_local! {
    static ASSETS: RefCell<Option<Assets>> = const { RefCell::new(None) };
    static REDUCED_MOTION: Cell<Option<bool>> = const { Cell::new(None) };
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProjectileStyle {
    Bolt,
    Burst,
    Frost,
    Tracer,
    Income,
    Beam,
}

const LOGICAL_WIDTH: f64 = 1000.;
const LOGICAL_HEIGHT: f64 = 562.;
const ENEMY_CELL_SIZE: f64 = 512.;
const ENEMY_GROUND_ANCHOR_Y: f64 = 494.;
const ENEMY_FRAME_COUNT: u8 = 4;
const TANGENT_SAMPLE_PROGRESS: f64 = 4.;
// The web presentation layer caps snapshot interpolation at ten simulation ticks.
// Eight progress units per tick covers the fastest authored enemy plus level bonuses.
const MAX_INTERPOLATED_PROGRESS_DELTA: u16 = 80;
#[derive(Clone, Copy)]
struct DefenderVisual {
    color: &'static str,
    soft_color: &'static str,
    projectile: ProjectileStyle,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct DefenderRenderStats {
    range: u16,
    cooldown: u16,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct DefenderSprite {
    index: u8,
    /// Foundation center inside the sprite's 512×512 atlas cell.
    ground_anchor_x: f64,
    ground_anchor_y: f64,
}

#[derive(Clone, Copy)]
struct VisualFrame {
    interpolation_alpha: f64,
    animation_tick: f64,
    reduced_motion: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EnemyFacing {
    Fixed,
    SourceFacesLeft,
    SourceFacesRight,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EnemyEffect {
    SneakerWake,
    BladeStreak,
    HeavyStomp,
    BalletSparkle,
    SignalRipple,
    OrbitTrail,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct EnemyVisual {
    index: u8,
    size: f64,
    stride_pixels: f64,
    lift: f64,
    squash: f64,
    sway: f64,
    heading_lean: f64,
    shadow_x: f64,
    shadow_y: f64,
    health_bar_lift: f64,
    facing: EnemyFacing,
    effect: EnemyEffect,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct EnemyPose {
    logical_x: f64,
    logical_y: f64,
    tangent_x: f64,
    tangent_y: f64,
    cycle: f64,
    frame: u8,
    lift: f64,
    scale_x: f64,
    scale_y: f64,
    rotation: f64,
    facing: f64,
    shadow_scale: f64,
    shadow_alpha: f64,
    hit_strength: f64,
}

fn image(url: &str) -> Result<HtmlImageElement, JsValue> {
    let image = HtmlImageElement::new()?;
    image.set_decoding("async");
    image.set_src(url);
    Ok(image)
}

/// Configures URLs emitted by the Rspack asset pipeline. Game logic never depends on them.
pub fn configure_asset_urls(
    map_urls: [&str; 5],
    defenders: &str,
    enemies: &str,
) -> Result<(), JsValue> {
    let maps = [
        image(map_urls[0])?,
        image(map_urls[1])?,
        image(map_urls[2])?,
        image(map_urls[3])?,
        image(map_urls[4])?,
    ];
    ASSETS.with(|slot| {
        *slot.borrow_mut() = Some(Assets {
            maps,
            defenders: image(defenders)?,
            enemies: image(enemies)?,
        });
        Ok(())
    })
}

fn prefers_reduced_motion() -> bool {
    REDUCED_MOTION.with(|cached| {
        if let Some(value) = cached.get() {
            return value;
        }
        let value = web_sys::window()
            .and_then(|window| {
                window
                    .match_media("(prefers-reduced-motion: reduce)")
                    .ok()
                    .flatten()
            })
            .is_some_and(|query| query.matches());
        cached.set(Some(value));
        value
    })
}

const fn defender_visual(kind: &str) -> Option<DefenderVisual> {
    match kind.as_bytes() {
        b"zip_zapper" => Some(DefenderVisual {
            color: "#7dd3fc",
            soft_color: "rgba(56, 189, 248, .15)",
            projectile: ProjectileStyle::Bolt,
        }),
        b"caps_lock" => Some(DefenderVisual {
            color: "#fb923c",
            soft_color: "rgba(251, 146, 60, .16)",
            projectile: ProjectileStyle::Burst,
        }),
        b"buffer_buddy" => Some(DefenderVisual {
            color: "#67e8f9",
            soft_color: "rgba(103, 232, 249, .15)",
            projectile: ProjectileStyle::Frost,
        }),
        b"deep_scroller" => Some(DefenderVisual {
            color: "#c4b5fd",
            soft_color: "rgba(167, 139, 250, .12)",
            projectile: ProjectileStyle::Tracer,
        }),
        b"side_hustler" => Some(DefenderVisual {
            color: "#fde047",
            soft_color: "rgba(250, 204, 21, .16)",
            projectile: ProjectileStyle::Income,
        }),
        b"final_form" => Some(DefenderVisual {
            color: "#f0abfc",
            soft_color: "rgba(232, 121, 249, .14)",
            projectile: ProjectileStyle::Beam,
        }),
        _ => None,
    }
}

const fn defender_sprite(kind: &str) -> Option<DefenderSprite> {
    match kind.as_bytes() {
        b"zip_zapper" => Some(DefenderSprite {
            index: 0,
            ground_anchor_x: 281.,
            ground_anchor_y: 378.,
        }),
        b"caps_lock" => Some(DefenderSprite {
            index: 1,
            ground_anchor_x: 239.,
            ground_anchor_y: 375.,
        }),
        b"buffer_buddy" => Some(DefenderSprite {
            index: 2,
            ground_anchor_x: 206.,
            ground_anchor_y: 388.,
        }),
        b"side_hustler" => Some(DefenderSprite {
            index: 3,
            ground_anchor_x: 286.,
            ground_anchor_y: 332.,
        }),
        b"final_form" => Some(DefenderSprite {
            index: 4,
            ground_anchor_x: 248.,
            ground_anchor_y: 331.,
        }),
        b"deep_scroller" => Some(DefenderSprite {
            index: 5,
            ground_anchor_x: 238.,
            ground_anchor_y: 381.,
        }),
        _ => None,
    }
}

fn defender_sprite_destination(
    sprite: DefenderSprite,
    center_x: f64,
    center_y: f64,
    size: f64,
) -> (f64, f64) {
    let scale = size / 512.;
    (
        center_x - sprite.ground_anchor_x * scale,
        center_y - sprite.ground_anchor_y * scale,
    )
}

const fn enemy_visual(kind: &str) -> Option<EnemyVisual> {
    match kind.as_bytes() {
        b"basic" => Some(EnemyVisual {
            index: 0,
            size: 66.,
            stride_pixels: 24.,
            lift: 5.2,
            squash: 0.075,
            sway: 0.045,
            heading_lean: 0.07,
            shadow_x: 19.,
            shadow_y: 6.,
            health_bar_lift: 0.88,
            facing: EnemyFacing::SourceFacesLeft,
            effect: EnemyEffect::SneakerWake,
        }),
        b"fast" => Some(EnemyVisual {
            index: 1,
            size: 64.,
            stride_pixels: 18.,
            lift: 6.4,
            squash: 0.085,
            sway: 0.055,
            heading_lean: 0.105,
            shadow_x: 17.,
            shadow_y: 5.,
            health_bar_lift: 0.92,
            facing: EnemyFacing::Fixed,
            effect: EnemyEffect::BladeStreak,
        }),
        b"armored" => Some(EnemyVisual {
            index: 2,
            size: 80.,
            stride_pixels: 34.,
            lift: 2.8,
            squash: 0.055,
            sway: 0.022,
            heading_lean: 0.035,
            shadow_x: 18.,
            shadow_y: 7.,
            health_bar_lift: 1.03,
            facing: EnemyFacing::Fixed,
            effect: EnemyEffect::HeavyStomp,
        }),
        b"swarm" => Some(EnemyVisual {
            index: 3,
            size: 74.,
            stride_pixels: 20.,
            lift: 7.2,
            squash: 0.045,
            sway: 0.105,
            heading_lean: 0.055,
            shadow_x: 14.,
            shadow_y: 4.5,
            health_bar_lift: 1.03,
            facing: EnemyFacing::Fixed,
            effect: EnemyEffect::BalletSparkle,
        }),
        b"disruption" => Some(EnemyVisual {
            index: 4,
            size: 68.,
            stride_pixels: 27.,
            lift: 4.4,
            squash: 0.07,
            sway: 0.065,
            heading_lean: 0.055,
            shadow_x: 17.,
            shadow_y: 6.,
            health_bar_lift: 1.03,
            facing: EnemyFacing::SourceFacesRight,
            effect: EnemyEffect::SignalRipple,
        }),
        b"boss" => Some(EnemyVisual {
            index: 5,
            size: 122.,
            stride_pixels: 44.,
            lift: 3.4,
            squash: 0.035,
            sway: 0.018,
            heading_lean: 0.018,
            shadow_x: 38.,
            shadow_y: 11.,
            health_bar_lift: 0.96,
            facing: EnemyFacing::Fixed,
            effect: EnemyEffect::OrbitTrail,
        }),
        _ => None,
    }
}

const fn enemy_speed(kind: &str) -> u16 {
    match kind.as_bytes() {
        b"fast" => 6,
        b"swarm" => 5,
        b"basic" | b"disruption" => 3,
        b"armored" => 2,
        b"boss" => 1,
        _ => 0,
    }
}

fn stable_hash(value: &str) -> u32 {
    value.as_bytes().iter().fold(2_166_136_261, |hash, byte| {
        (hash ^ u32::from(*byte)).wrapping_mul(16_777_619)
    })
}

fn animation_tick(previous_tick: u64, current_tick: u64, alpha: f64, reduced_motion: bool) -> f64 {
    if reduced_motion {
        0.
    } else {
        (previous_tick as f64).mul_add(
            1. - alpha.clamp(0., 1.),
            current_tick as f64 * alpha.clamp(0., 1.),
        )
    }
}

fn attack_progress(remaining: u16, expected_cooldown: u16) -> Option<f64> {
    if remaining == 0 || expected_cooldown == 0 {
        return None;
    }
    let elapsed = expected_cooldown.saturating_sub(remaining.min(expected_cooldown));
    (elapsed <= 4).then(|| f64::from(elapsed) / 4.)
}

fn interpolated_progress(
    enemy: &EnemyState,
    previous_enemy: Option<&EnemyState>,
    alpha: f64,
) -> f64 {
    let start_progress = match previous_enemy {
        Some(previous)
            if previous.path == enemy.path
                && enemy.progress >= previous.progress
                && enemy.progress - previous.progress <= MAX_INTERPOLATED_PROGRESS_DELTA =>
        {
            previous.progress
        }
        None if enemy.progress <= MAX_INTERPOLATED_PROGRESS_DELTA => 0,
        // Lane changes, rewinds, stale snapshots, and late-observed enemies snap
        // to authoritative state instead of sweeping across the battlefield.
        _ => return f64::from(enemy.progress),
    };
    let alpha = alpha.clamp(0., 1.);
    f64::from(start_progress).mul_add(1. - alpha, f64::from(enemy.progress) * alpha)
}

fn logical_position(
    level: u8,
    enemy: &EnemyState,
    previous_enemy: Option<&EnemyState>,
    alpha: f64,
) -> (f64, f64) {
    logical_path_position(
        level,
        enemy.path,
        interpolated_progress(enemy, previous_enemy, alpha),
    )
}

fn logical_path_position(level: u8, path: u8, progress: f64) -> (f64, f64) {
    let progress = progress.clamp(0., 1000.);
    let lower_progress = progress.floor() as u16;
    let upper_progress = progress.ceil() as u16;
    let lower = path_position_precise(level, path, lower_progress);
    let scale = f64::from(PATH_POSITION_SCALE);
    if lower_progress == upper_progress {
        return (f64::from(lower.x) / scale, f64::from(lower.y) / scale);
    }

    // Route progress is sampled before coordinates are blended. Blending only
    // adjacent 1/1000 route samples preserves authored bends while retaining
    // subpixel motion between authoritative simulation ticks.
    let upper = path_position_precise(level, path, upper_progress);
    let fraction = progress - f64::from(lower_progress);
    (
        f64::from(lower.x).mul_add(1. - fraction, f64::from(upper.x) * fraction) / scale,
        f64::from(lower.y).mul_add(1. - fraction, f64::from(upper.y) * fraction) / scale,
    )
}

fn physical_route_distance(level: u8, path: u8, progress: f64) -> f64 {
    let route_length = route_length_precise(level, path) as f64 / f64::from(PATH_POSITION_SCALE);
    route_length * progress.clamp(0., 1000.) / 1000.
}

fn route_tangent(level: u8, path: u8, progress: f64) -> (f64, f64) {
    let before = logical_path_position(level, path, progress - TANGENT_SAMPLE_PROGRESS);
    let after = logical_path_position(level, path, progress + TANGENT_SAMPLE_PROGRESS);
    let dx = after.0 - before.0;
    let dy = after.1 - before.1;
    let length = dx.hypot(dy);
    if length <= f64::EPSILON {
        (1., 0.)
    } else {
        (dx / length, dy / length)
    }
}

fn gait_cycle(distance: f64, stride_pixels: f64, seed: u32) -> f64 {
    let seeded_offset = f64::from(seed % 4096) / 4096.;
    (distance / stride_pixels.max(1.) + seeded_offset).rem_euclid(1.)
}

fn gait_frame(cycle: f64) -> u8 {
    ((cycle.rem_euclid(1.) * f64::from(ENEMY_FRAME_COUNT)).floor() as u8).min(ENEMY_FRAME_COUNT - 1)
}

fn motion_phase(cycle: f64, reduced_motion: bool) -> f64 {
    if reduced_motion {
        0.
    } else {
        cycle.rem_euclid(1.)
    }
}

fn locomotion_frame(kind_index: u8, cycle: f64) -> u8 {
    // Cappuccino, Tung, and La Vaca reserve frame 2 for an authored special pose rather than
    // flashing a weapon/stomp frame during every ordinary stride.
    if matches!(kind_index, 1 | 2 | 5) {
        const LOCOMOTION: [u8; 3] = [0, 1, 3];
        let index = ((cycle.rem_euclid(1.) * 3.).floor() as usize).min(LOCOMOTION.len() - 1);
        LOCOMOTION[index]
    } else {
        gait_frame(cycle)
    }
}

fn enemy_animation_frame(kind_index: u8, cycle: f64, hit_strength: f64) -> u8 {
    // These sheets reserve their most dramatic pose for a real combat event:
    // Cappuccino crosses its blades, Tung raises the bat, and La Vaca stomps.
    // A health delta is the authoritative signal, so the pose never fires as
    // ambient decoration or while an enemy is simply walking.
    if hit_strength > 0.08 && matches!(kind_index, 1 | 2 | 5) {
        2
    } else {
        locomotion_frame(kind_index, cycle)
    }
}

fn damage_hit_strength(enemy: &EnemyState, previous_enemy: Option<&EnemyState>, alpha: f64) -> f64 {
    let Some(previous) = previous_enemy.filter(|previous| previous.health > enemy.health) else {
        return 0.;
    };
    let damage = f64::from(previous.health.saturating_sub(enemy.health).max(0));
    let damage_ratio = damage / f64::from(enemy.max_health.max(1));
    let intensity = damage_ratio.mul_add(1.6, 0.55).clamp(0.55, 1.);
    let remaining = 1. - alpha.clamp(0., 1.);
    intensity * remaining * remaining
}

fn directional_facing(mode: EnemyFacing, tangent_x: f64) -> f64 {
    match mode {
        EnemyFacing::Fixed => 1.,
        EnemyFacing::SourceFacesLeft if tangent_x > 0.06 => -1.,
        EnemyFacing::SourceFacesRight if tangent_x < -0.06 => -1.,
        EnemyFacing::SourceFacesLeft | EnemyFacing::SourceFacesRight => 1.,
    }
}

fn enemy_pose(
    level: u8,
    enemy: &EnemyState,
    previous_enemy: Option<&EnemyState>,
    alpha: f64,
    reduced_motion: bool,
) -> Option<EnemyPose> {
    let visual = enemy_visual(&enemy.kind)?;
    let progress = interpolated_progress(enemy, previous_enemy, alpha);
    let (mut logical_x, mut logical_y) = logical_position(level, enemy, previous_enemy, alpha);
    let (tangent_x, tangent_y) = route_tangent(level, enemy.path, progress);
    let seed = stable_hash(&enemy.id.0);
    let cycle = gait_cycle(
        physical_route_distance(level, enemy.path, progress),
        visual.stride_pixels,
        seed,
    );
    let hit_strength = damage_hit_strength(enemy, previous_enemy, alpha);
    let facing = directional_facing(visual.facing, tangent_x);

    if reduced_motion {
        return Some(EnemyPose {
            logical_x,
            logical_y,
            tangent_x,
            tangent_y,
            cycle,
            frame: 0,
            lift: 0.,
            scale_x: 1.,
            scale_y: 1.,
            rotation: 0.,
            facing,
            shadow_scale: 1.,
            shadow_alpha: 0.28,
            hit_strength,
        });
    }

    let angle = cycle * TAU;
    let gait_wave = angle.sin();
    let contact = angle.cos().max(0.);
    let airborne = (1. - angle.cos()) * 0.5;
    let stretch = (-angle.cos()).max(0.);
    let enrage = if enemy.kind == "boss" && enemy.health * 2 < enemy.max_health {
        1.35
    } else {
        1.
    };
    let hit_direction = if seed.is_multiple_of(2) { 1. } else { -1. };

    // Recoil is presentation-only and follows the real damage delta between snapshots.
    logical_x -= tangent_x * hit_strength * 4.;
    logical_y -= tangent_y * hit_strength * 4.;

    Some(EnemyPose {
        logical_x,
        logical_y,
        tangent_x,
        tangent_y,
        cycle,
        frame: enemy_animation_frame(visual.index, cycle, hit_strength),
        lift: -visual.lift * airborne * enrage,
        scale_x: 1. + visual.squash * contact * 0.7 - visual.squash * stretch * 0.2
            + hit_strength * 0.08,
        scale_y: 1. - visual.squash * contact + visual.squash * stretch * 0.45
            - hit_strength * 0.065,
        rotation: tangent_x * visual.heading_lean
            + gait_wave * visual.sway * enrage
            + hit_direction * hit_strength * 0.075,
        facing,
        shadow_scale: 1. - airborne * 0.24,
        shadow_alpha: 0.30 - airborne * 0.12,
        hit_strength,
    })
}

fn enemy_atlas_source(visual: EnemyVisual, frame: u8) -> (f64, f64) {
    let frame = frame.min(ENEMY_FRAME_COUNT - 1);
    let sx = f64::from(visual.index % 3) * ENEMY_CELL_SIZE;
    let sy = f64::from(frame * 2 + visual.index / 3) * ENEMY_CELL_SIZE;
    (sx, sy)
}

fn previous_enemy<'a>(
    previous: Option<&'a SessionSnapshot>,
    current: &EnemyState,
) -> Option<&'a EnemyState> {
    previous?
        .enemies
        .iter()
        .find(|candidate| candidate.id == current.id)
}

fn target_for<'a>(
    state: &'a SessionSnapshot,
    defender: &DefenderState,
    range: u16,
) -> Option<&'a EnemyState> {
    let range_squared = i64::from(range) * i64::from(range);
    let mut selected: Option<&EnemyState> = None;
    for enemy in &state.enemies {
        let point = path_position(state.level, enemy.path, enemy.progress);
        let dx = i64::from(defender.x) - i64::from(point.x);
        let dy = i64::from(defender.y) - i64::from(point.y);
        if dx * dx + dy * dy > range_squared {
            continue;
        }
        let replace = selected.is_none_or(|current| match defender.target_policy {
            TargetPolicy::First => enemy.progress >= current.progress,
            TargetPolicy::Last => enemy.progress < current.progress,
            TargetPolicy::Strong => enemy.health >= current.health,
            TargetPolicy::Fast => enemy_speed(&enemy.kind) >= enemy_speed(&current.kind),
        });
        if replace {
            selected = Some(enemy);
        }
    }
    selected
}

fn defender_render_stats(defender: &DefenderState) -> Option<DefenderRenderStats> {
    let definition = defenders()
        .into_iter()
        .find(|definition| definition.id == defender.kind)?;
    let purchased_tiers = usize::from(defender.level.saturating_sub(1));
    let growth = if purchased_tiers == 0 {
        UpgradeGrowth::default()
    } else {
        upgrade_path(definition.id, &defender.path)?
            .tiers
            .iter()
            .take(purchased_tiers)
            .fold(UpgradeGrowth::default(), |total, tier| {
                total.saturating_add(tier.growth)
            })
    };
    Some(DefenderRenderStats {
        range: definition.range.saturating_add(growth.range),
        cooldown: definition
            .cooldown
            .saturating_sub(growth.cooldown_reduction)
            .max(2),
    })
}

fn defender_sprite_size(level: u8) -> f64 {
    let rendered_level = level.clamp(1, MAX_DEFENDER_LEVEL);
    98. + f64::from(rendered_level - 1) * 5.
}

fn defender_level_badge(level: u8) -> Option<String> {
    (2..=MAX_DEFENDER_LEVEL)
        .contains(&level)
        .then(|| format!("{level}★"))
}

fn scaled_point(x: f64, y: f64, width: f64, height: f64) -> (f64, f64) {
    (x * width / LOGICAL_WIDTH, y * height / LOGICAL_HEIGHT)
}

fn canvas_scale(width: f64, height: f64) -> f64 {
    ((width / LOGICAL_WIDTH) + (height / LOGICAL_HEIGHT)) * 0.5
}

fn circle(context: &CanvasRenderingContext2d, x: f64, y: f64, radius: f64) {
    context.begin_path();
    let _ = context.arc(x, y, radius.max(0.), 0., TAU);
}

fn ellipse(context: &CanvasRenderingContext2d, x: f64, y: f64, radius_x: f64, radius_y: f64) {
    context.begin_path();
    let _ = context.ellipse(x, y, radius_x.max(0.), radius_y.max(0.), 0., 0., TAU);
}

fn draw_defender_readability(
    context: &CanvasRenderingContext2d,
    state: &SessionSnapshot,
    defender: &DefenderState,
    width: f64,
    height: f64,
    reduced_motion: bool,
) {
    let Some(visual) = defender_visual(&defender.kind) else {
        return;
    };
    let Some(stats) = defender_render_stats(defender) else {
        return;
    };
    let (x, y) = scaled_point(f64::from(defender.x), f64::from(defender.y), width, height);
    let firing = attack_progress(defender.cooldown_ticks, stats.cooldown);
    let planning = state.status == SessionStatus::BetweenWaves;
    if visual.projectile == ProjectileStyle::Income {
        let phase = firing.unwrap_or(0.);
        let radius = (32. + phase * if reduced_motion { 0. } else { 28. }) * width / 1000.;
        circle(context, x, y, radius);
        context.set_fill_style_str(visual.soft_color);
        context.fill();
        context.set_stroke_style_str(visual.color);
        context.set_line_width(if firing.is_some() { 2.5 } else { 1. });
        context.stroke();
        return;
    }
    if !planning && firing.is_none() {
        return;
    }
    let radius = f64::from(stats.range) * ((width / 1000. + height / 562.) / 2.);
    circle(context, x, y, radius);
    context.set_fill_style_str(if planning {
        "rgba(125, 211, 252, .045)"
    } else {
        visual.soft_color
    });
    context.fill();
    context.set_stroke_style_str(if planning {
        "rgba(255, 255, 255, .42)"
    } else {
        visual.color
    });
    context.set_line_width(if planning { 1. } else { 1.8 });
    context.stroke();
}

fn draw_enemy_motion(
    context: &CanvasRenderingContext2d,
    state: &SessionSnapshot,
    enemy: &EnemyState,
    previous_enemy: Option<&EnemyState>,
    width: f64,
    height: f64,
    frame: VisualFrame,
) {
    let Some(visual) = enemy_visual(&enemy.kind) else {
        return;
    };
    let Some(pose) = enemy_pose(
        state.level,
        enemy,
        previous_enemy,
        frame.interpolation_alpha,
        frame.reduced_motion,
    ) else {
        return;
    };
    let scale = canvas_scale(width, height);
    let (x, ground_y) = scaled_point(pose.logical_x, pose.logical_y, width, height);
    let body_y = ground_y + pose.lift * scale;

    // The shadow remains grounded while the character lifts, stretches, or recoils.
    ellipse(
        context,
        x,
        ground_y + 5. * scale,
        visual.shadow_x * pose.shadow_scale * scale,
        visual.shadow_y * (2. - pose.shadow_scale) * scale,
    );
    context.set_global_alpha(pose.shadow_alpha);
    context.set_fill_style_str("rgb(5, 10, 18)");
    context.fill();
    context.set_global_alpha(1.);

    context.save();
    match visual.effect {
        EnemyEffect::SneakerWake => {
            if !frame.reduced_motion {
                for offset in [-5., 5.] {
                    let trail = 10. + pose.cycle * 14.;
                    context.begin_path();
                    context.move_to(
                        x - pose.tangent_x * trail * scale - pose.tangent_y * offset * scale,
                        ground_y - pose.tangent_y * trail * scale + pose.tangent_x * offset * scale,
                    );
                    context.line_to(
                        x - pose.tangent_x * (trail + 9.) * scale - pose.tangent_y * offset * scale,
                        ground_y - pose.tangent_y * (trail + 9.) * scale
                            + pose.tangent_x * offset * scale,
                    );
                    context.set_stroke_style_str("rgba(56, 189, 248, .68)");
                    context.set_line_width(2.2 * scale);
                    context.set_line_cap("round");
                    context.stroke();
                }
            }
        }
        EnemyEffect::BladeStreak => {
            if !frame.reduced_motion {
                for offset in [-8., 8.] {
                    context.begin_path();
                    context.move_to(
                        x - pose.tangent_x * 13. * scale - pose.tangent_y * offset * scale,
                        body_y - pose.tangent_y * 13. * scale + pose.tangent_x * offset * scale,
                    );
                    context.line_to(
                        x - pose.tangent_x * 34. * scale - pose.tangent_y * offset * scale,
                        body_y - pose.tangent_y * 34. * scale + pose.tangent_x * offset * scale,
                    );
                    context.set_stroke_style_str("rgba(251, 191, 36, .68)");
                    context.set_line_width(2. * scale);
                    context.stroke();
                }
            }
        }
        EnemyEffect::HeavyStomp => {
            let contact = (pose.cycle * TAU).cos().max(0.);
            if !frame.reduced_motion && contact > 0.55 {
                for direction in [-1., 1.] {
                    circle(
                        context,
                        x + direction * (12. + contact * 8.) * scale,
                        ground_y + 3. * scale,
                        (2. + contact * 3.) * scale,
                    );
                    context.set_fill_style_str("rgba(226, 232, 240, .42)");
                    context.fill();
                }
            }
        }
        EnemyEffect::BalletSparkle => {
            let angle = motion_phase(pose.cycle, frame.reduced_motion) * TAU;
            let sparkle_x = x - pose.tangent_x * 16. * scale + angle.cos() * 10. * scale;
            let sparkle_y = body_y - pose.tangent_y * 16. * scale + angle.sin() * 8. * scale;
            context.begin_path();
            context.move_to(sparkle_x, sparkle_y - 5. * scale);
            context.line_to(sparkle_x + 3. * scale, sparkle_y);
            context.line_to(sparkle_x, sparkle_y + 5. * scale);
            context.line_to(sparkle_x - 3. * scale, sparkle_y);
            context.close_path();
            context.set_fill_style_str("rgba(251, 207, 232, .86)");
            context.fill();
        }
        EnemyEffect::SignalRipple => {
            let pulse = motion_phase(pose.cycle, frame.reduced_motion);
            circle(context, x, body_y - 8. * scale, (23. + pulse * 17.) * scale);
            context.set_stroke_style_str("rgba(167, 139, 250, .62)");
            context.set_global_alpha(1. - pulse * 0.72);
            context.set_line_width((2.2 - pulse) * scale);
            context.stroke();
            context.set_global_alpha(1.);
        }
        EnemyEffect::OrbitTrail => {
            ellipse(context, x, body_y - 12. * scale, 48. * scale, 17. * scale);
            context.set_stroke_style_str("rgba(125, 211, 252, .48)");
            context.set_line_width(1.5 * scale);
            context.stroke();
            if !frame.reduced_motion {
                let angle = pose.cycle * TAU;
                circle(
                    context,
                    x + angle.cos() * 48. * scale,
                    body_y - 12. * scale + angle.sin() * 17. * scale,
                    3.2 * scale,
                );
                context.set_fill_style_str("#a5f3fc");
                context.fill();
            }
        }
    }
    context.restore();

    if pose.hit_strength > 0.04 {
        circle(
            context,
            x,
            body_y - visual.size * 0.36 * scale,
            (visual.size * 0.34 + pose.hit_strength * 12.) * scale,
        );
        context.set_global_alpha((pose.hit_strength * 0.88).min(0.9));
        context.set_stroke_style_str("#fff7ed");
        context.set_line_width(2.4 * scale);
        context.stroke();
        context.set_global_alpha(1.);
    }

    if enemy.armor > 0 {
        circle(
            context,
            x,
            body_y - 8. * scale,
            if enemy.kind == "boss" {
                47. * scale
            } else {
                29. * scale
            },
        );
        context.set_stroke_style_str("rgba(226, 232, 240, .67)");
        context.set_line_width(1.5 * scale);
        context.stroke();
    }
}

fn draw_enemy_status(
    context: &CanvasRenderingContext2d,
    enemy: &EnemyState,
    x: f64,
    y: f64,
    size: f64,
    tick: f64,
    reduced_motion: bool,
) {
    if enemy.slowed_ticks > 0 {
        let radius = size * 0.39;
        circle(context, x, y - size * 0.17, radius);
        context.set_stroke_style_str("rgba(103, 232, 249, .92)");
        context.set_line_width(2.);
        context.stroke();
        context.begin_path();
        context.move_to(x - 5., y - size * 0.17);
        context.line_to(x + 5., y - size * 0.17);
        context.move_to(x, y - size * 0.17 - 5.);
        context.line_to(x, y - size * 0.17 + 5.);
        context.set_stroke_style_str("#cffafe");
        context.set_line_width(1.5);
        context.stroke();
    }
    if enemy.kind == "boss" && enemy.health * 2 < enemy.max_health {
        let pulse = if reduced_motion {
            0.
        } else {
            (tick * 0.4).sin().mul_add(3., 5.)
        };
        circle(context, x, y - size * 0.14, size * 0.48 + pulse);
        context.set_stroke_style_str("rgba(244, 114, 182, .9)");
        context.set_line_width(3.);
        context.stroke();
    }
}

#[allow(clippy::too_many_arguments)]
fn draw_projectile(
    context: &CanvasRenderingContext2d,
    style: ProjectileStyle,
    color: &str,
    soft_color: &str,
    start_x: f64,
    start_y: f64,
    target_x: f64,
    target_y: f64,
    phase: f64,
    reduced_motion: bool,
    seed: u32,
) {
    let phase = if reduced_motion {
        1.
    } else {
        phase.clamp(0., 1.)
    };
    let dx = target_x - start_x;
    let dy = target_y - start_y;
    let perpendicular_x = -dy;
    let perpendicular_y = dx;
    let length = dx.hypot(dy).max(1.);
    let arc = if seed.is_multiple_of(2) { 1. } else { -1. } * 24.;
    let control_x = (start_x + target_x) / 2. + perpendicular_x / length * arc;
    let control_y = (start_y + target_y) / 2. + perpendicular_y / length * arc - 14.;
    let one_minus = 1. - phase;
    let projectile_x = one_minus * one_minus * start_x
        + 2. * one_minus * phase * control_x
        + phase * phase * target_x;
    let projectile_y = one_minus * one_minus * start_y
        + 2. * one_minus * phase * control_y
        + phase * phase * target_y;

    match style {
        ProjectileStyle::Tracer | ProjectileStyle::Beam => {
            context.begin_path();
            context.move_to(start_x, start_y);
            context.line_to(target_x, target_y);
            context.set_stroke_style_str(soft_color);
            context.set_line_width(if style == ProjectileStyle::Beam {
                7.
            } else {
                4.
            });
            context.set_line_cap("round");
            context.stroke();
            context.begin_path();
            context.move_to(start_x, start_y);
            context.line_to(target_x, target_y);
            context.set_stroke_style_str(color);
            context.set_line_width(if style == ProjectileStyle::Beam {
                2.5
            } else {
                1.5
            });
            context.stroke();
        }
        ProjectileStyle::Bolt | ProjectileStyle::Burst | ProjectileStyle::Frost => {
            context.begin_path();
            context.move_to(start_x, start_y);
            context.quadratic_curve_to(control_x, control_y, projectile_x, projectile_y);
            context.set_stroke_style_str(soft_color);
            context.set_line_width(if style == ProjectileStyle::Burst {
                4.
            } else {
                2.5
            });
            context.set_line_cap("round");
            context.stroke();
            circle(
                context,
                projectile_x,
                projectile_y,
                if style == ProjectileStyle::Burst {
                    5.5
                } else {
                    4.
                },
            );
            context.set_fill_style_str(color);
            context.fill();
        }
        ProjectileStyle::Income => return,
    }

    if phase >= 0.58 {
        let impact = ((phase - 0.58) / 0.42).clamp(0., 1.);
        let radius = if reduced_motion {
            11.
        } else {
            5. + impact * 18.
        };
        circle(context, target_x, target_y, radius);
        context.set_stroke_style_str(color);
        context.set_line_width((3. - impact * 2.).max(1.));
        context.stroke();
        for angle_index in 0..4 {
            let angle = f64::from(angle_index) * PI / 2. + f64::from(seed % 7) / 10.;
            let inner = radius + 2.;
            let outer = radius + 7.;
            context.begin_path();
            context.move_to(
                target_x + angle.cos() * inner,
                target_y + angle.sin() * inner,
            );
            context.line_to(
                target_x + angle.cos() * outer,
                target_y + angle.sin() * outer,
            );
            context.set_stroke_style_str(color);
            context.set_line_width(1.5);
            context.stroke();
        }
    }
}

fn draw_attack_feedback(
    context: &CanvasRenderingContext2d,
    state: &SessionSnapshot,
    previous: Option<&SessionSnapshot>,
    defender: &DefenderState,
    width: f64,
    height: f64,
    frame: VisualFrame,
) {
    let Some(visual) = defender_visual(&defender.kind) else {
        return;
    };
    let Some(stats) = defender_render_stats(defender) else {
        return;
    };
    let Some(phase) = attack_progress(defender.cooldown_ticks, stats.cooldown) else {
        return;
    };
    let (start_x, start_y) = scaled_point(
        f64::from(defender.x),
        f64::from(defender.y) - 32.,
        width,
        height,
    );
    if visual.projectile == ProjectileStyle::Income {
        circle(
            context,
            start_x,
            start_y + 23.,
            if frame.reduced_motion {
                22.
            } else {
                18. + phase * 22.
            },
        );
        context.set_stroke_style_str(visual.color);
        context.set_line_width(2.);
        context.stroke();
        context.set_fill_style_str("#fff7a8");
        context.set_font("800 14px system-ui");
        context.set_text_align("center");
        let _ = context.fill_text("+◈", start_x, start_y - phase * 14.);
        return;
    }
    let Some(target) = target_for(state, defender, stats.range) else {
        return;
    };
    let prior_target = previous_enemy(previous, target);
    let Some(target_pose) = enemy_pose(
        state.level,
        target,
        prior_target,
        frame.interpolation_alpha,
        frame.reduced_motion,
    ) else {
        return;
    };
    let (target_x, target_y) = scaled_point(
        target_pose.logical_x,
        target_pose.logical_y + target_pose.lift,
        width,
        height,
    );
    draw_projectile(
        context,
        visual.projectile,
        visual.color,
        visual.soft_color,
        start_x,
        start_y,
        target_x,
        target_y - 12.,
        phase,
        frame.reduced_motion,
        stable_hash(&defender.id.0),
    );

    // A compact reticle makes targeting intent understandable without persistent clutter.
    circle(context, target_x, target_y - 12., 12.);
    context.set_stroke_style_str(visual.color);
    context.set_line_width(1.);
    context.stroke();
}

#[allow(clippy::too_many_arguments)]
fn draw_enemy_sprite(
    context: &CanvasRenderingContext2d,
    state: &SessionSnapshot,
    enemy: &EnemyState,
    previous_enemy: Option<&EnemyState>,
    width: f64,
    height: f64,
    frame: VisualFrame,
) {
    let Some(visual) = enemy_visual(&enemy.kind) else {
        return;
    };
    let Some(pose) = enemy_pose(
        state.level,
        enemy,
        previous_enemy,
        frame.interpolation_alpha,
        frame.reduced_motion,
    ) else {
        return;
    };
    let scale = canvas_scale(width, height);
    let size = visual.size * scale;
    let (x, body_y) = scaled_point(pose.logical_x, pose.logical_y + pose.lift, width, height);
    let (source_x, source_y) = enemy_atlas_source(visual, pose.frame);

    context.save();
    let _ = context.translate(x, body_y);
    let _ = context.rotate(pose.rotation);
    let _ = context.scale(pose.facing * pose.scale_x, pose.scale_y);
    if pose.hit_strength > 0.08 {
        context.set_filter(
            "brightness(1.75) saturate(.45) drop-shadow(0px 0px 6px rgba(255,247,237,.95))",
        );
    }
    ASSETS.with(|slot| {
        if let Some(assets) = slot.borrow().as_ref() {
            let _ = context
                .draw_image_with_html_image_element_and_sw_and_sh_and_dx_and_dy_and_dw_and_dh(
                    &assets.enemies,
                    source_x,
                    source_y,
                    ENEMY_CELL_SIZE,
                    ENEMY_CELL_SIZE,
                    -size / 2.,
                    -ENEMY_GROUND_ANCHOR_Y * size / ENEMY_CELL_SIZE,
                    size,
                    size,
                );
        }
    });
    context.restore();

    draw_enemy_status(
        context,
        enemy,
        x,
        body_y,
        size,
        frame.animation_tick,
        frame.reduced_motion,
    );
    let bar_width = if enemy.kind == "boss" {
        90. * scale
    } else {
        44. * scale
    };
    let bar_height = 4. * scale;
    let bar_y = body_y - size * visual.health_bar_lift;
    context.set_fill_style_str("rgba(11, 18, 32, .9)");
    context.fill_rect(
        x - bar_width / 2. - 2. * scale,
        bar_y - 2. * scale,
        bar_width + 4. * scale,
        bar_height + 4. * scale,
    );
    context.set_fill_style_str(if enemy.slowed_ticks > 0 {
        "#67e8f9"
    } else if enemy.health * 4 <= enemy.max_health {
        "#f43f5e"
    } else {
        "#fb7185"
    });
    context.fill_rect(
        x - bar_width / 2.,
        bar_y,
        bar_width * f64::from(enemy.health.max(0)) / f64::from(enemy.max_health.max(1)),
        bar_height,
    );
    if enemy.armor > 0 {
        context.set_fill_style_str("#cbd5e1");
        context.fill_rect(
            x + bar_width / 2. - 7. * scale,
            bar_y - scale,
            7. * scale,
            6. * scale,
        );
    }
}

fn draw_departing_enemy(
    context: &CanvasRenderingContext2d,
    level: u8,
    enemy: &EnemyState,
    width: f64,
    height: f64,
    frame: VisualFrame,
) {
    let opacity = 1. - frame.interpolation_alpha.clamp(0., 1.);
    if opacity <= f64::EPSILON {
        return;
    }
    let Some(visual) = enemy_visual(&enemy.kind) else {
        return;
    };
    let Some(pose) = enemy_pose(level, enemy, Some(enemy), 1., frame.reduced_motion) else {
        return;
    };
    let canvas_scale = canvas_scale(width, height);
    let size = visual.size * canvas_scale;
    let (x, y) = scaled_point(pose.logical_x, pose.logical_y + pose.lift, width, height);
    let (source_x, source_y) = enemy_atlas_source(visual, pose.frame);
    let departure_scale = if frame.reduced_motion {
        1.
    } else {
        opacity.mul_add(0.24, 0.76)
    };
    let direction = if stable_hash(&enemy.id.0).is_multiple_of(2) {
        1.
    } else {
        -1.
    };

    context.save();
    context.set_global_alpha(opacity * opacity);
    let _ = context.translate(x, y);
    if !frame.reduced_motion {
        let _ = context.rotate(direction * (1. - opacity) * 0.16);
    }
    let _ = context.scale(pose.facing * departure_scale, departure_scale);
    ASSETS.with(|slot| {
        if let Some(assets) = slot.borrow().as_ref() {
            let _ = context
                .draw_image_with_html_image_element_and_sw_and_sh_and_dx_and_dy_and_dw_and_dh(
                    &assets.enemies,
                    source_x,
                    source_y,
                    ENEMY_CELL_SIZE,
                    ENEMY_CELL_SIZE,
                    -size / 2.,
                    -ENEMY_GROUND_ANCHOR_Y * size / ENEMY_CELL_SIZE,
                    size,
                    size,
                );
        }
    });
    context.restore();
}

fn draw_modifier_overlay(
    context: &CanvasRenderingContext2d,
    state: &SessionSnapshot,
    width: f64,
    height: f64,
    animation_tick: f64,
    reduced_motion: bool,
) {
    let outage =
        state.level == 4 && state.status == SessionStatus::Running && state.tick % 300 < 35;
    if outage {
        context.set_fill_style_str("rgba(4, 9, 19, .28)");
        context.fill_rect(0., 0., width, height);
        if !reduced_motion {
            let scan_y = animation_tick.rem_euclid(24.) * height / 24.;
            context.set_fill_style_str("rgba(103, 232, 249, .12)");
            context.fill_rect(0., scan_y, width, 3.);
        }
        context.set_fill_style_str("rgba(9, 18, 34, .88)");
        context.fill_rect(width / 2. - 146., 18., 292., 34.);
        context.set_fill_style_str("#a5f3fc");
        context.set_font("800 13px system-ui");
        context.set_text_align("center");
        let _ = context.fill_text("SIGNAL OUTAGE  •  DEFENDERS BUFFERING", width / 2., 40.);
    }

    let boss_shift = state.level == 5
        && state
            .enemies
            .iter()
            .any(|enemy| enemy.kind == "boss" && enemy.health * 2 < enemy.max_health);
    if boss_shift {
        context.set_fill_style_str("rgba(244, 114, 182, .42)");
        context.fill_rect(0., 0., width, 4.);
        context.fill_rect(0., height - 4., width, 4.);
        context.set_fill_style_str("rgba(42, 15, 45, .84)");
        context.fill_rect(width - 238., 18., 220., 30.);
        context.set_fill_style_str("#fbcfe8");
        context.set_font("800 12px system-ui");
        context.set_text_align("center");
        let _ = context.fill_text("ALGORITHM SHIFT  •  ROUTE CHANGED", width - 128., 38.);
    }

    if state.status == SessionStatus::BetweenWaves {
        context.set_fill_style_str("rgba(8, 18, 31, .82)");
        context.fill_rect(width - 216., 18., 198., 30.);
        context.set_fill_style_str("#d1fae5");
        context.set_font("800 12px system-ui");
        context.set_text_align("center");
        let _ = context.fill_text("BUILD WINDOW  •  PLAN & UPGRADE", width - 117., 38.);
    }

    if state.base_health <= 5 && !matches!(state.status, SessionStatus::Defeat) {
        let opacity = if reduced_motion {
            0.72
        } else {
            (animation_tick * 0.35).sin().mul_add(0.18, 0.64)
        };
        context.set_global_alpha(opacity);
        context.set_stroke_style_str("rgb(251, 113, 133)");
        context.set_line_width(8.);
        context.stroke_rect(4., 4., width - 8., height - 8.);
        context.set_global_alpha(1.);
    }
}

fn draw_status_overlay(
    context: &CanvasRenderingContext2d,
    state: &SessionSnapshot,
    width: f64,
    height: f64,
) {
    if !matches!(
        state.status,
        SessionStatus::Paused | SessionStatus::Victory | SessionStatus::Defeat
    ) {
        return;
    }
    context.set_fill_style_str("rgba(8, 10, 18, .72)");
    context.fill_rect(0., 0., width, height);
    context.set_fill_style_str("#fff");
    context.set_font("800 30px system-ui");
    context.set_text_align("center");
    let (label, detail) = match state.status {
        SessionStatus::Paused => ("Paused", "The simulation is safely frozen"),
        SessionStatus::Victory => ("Feed defended!", "Every wave cleared"),
        _ => ("Signal lost", "The base ran out of health"),
    };
    let _ = context.fill_text(label, width / 2., height / 2. - 6.);
    context.set_fill_style_str("rgba(255, 255, 255, .78)");
    context.set_font("600 14px system-ui");
    let _ = context.fill_text(detail, width / 2., height / 2. + 24.);
}

pub struct Renderer {
    canvas: HtmlCanvasElement,
    context: CanvasRenderingContext2d,
}

impl Renderer {
    pub fn new(canvas: HtmlCanvasElement) -> Result<Self, JsValue> {
        let context = canvas
            .get_context("2d")?
            .ok_or_else(|| JsValue::from_str("2D canvas unavailable"))?
            .dyn_into::<CanvasRenderingContext2d>()?;
        context.set_image_smoothing_enabled(true);
        Ok(Self { canvas, context })
    }

    pub fn draw(&self, state: &SessionSnapshot) {
        self.draw_interpolated(state, None, 1.);
    }

    /// Draws the current authoritative snapshot at a presentation-only point between ticks.
    ///
    /// Enemy identity and progress remain authoritative. Interpolation only supplies sub-frame
    /// canvas coordinates and never feeds back into targeting, persistence, or game outcomes.
    pub fn draw_interpolated(
        &self,
        state: &SessionSnapshot,
        previous: Option<&SessionSnapshot>,
        interpolation_alpha: f64,
    ) {
        let width = f64::from(self.canvas.width());
        let height = f64::from(self.canvas.height());
        let reduced_motion = prefers_reduced_motion();
        let interpolation_alpha = interpolation_alpha.clamp(0., 1.);
        let previous_tick = previous.map_or(state.tick, |snapshot| snapshot.tick);
        let tick = animation_tick(
            previous_tick,
            state.tick,
            interpolation_alpha,
            reduced_motion,
        );
        let frame = VisualFrame {
            interpolation_alpha,
            animation_tick: tick,
            reduced_motion,
        };
        self.context.set_fill_style_str("#111827");
        self.context.fill_rect(0., 0., width, height);
        ASSETS.with(|slot| {
            if let Some(assets) = slot.borrow().as_ref() {
                let map = &assets.maps[usize::from(state.level.saturating_sub(1).min(4))];
                let _ = self
                    .context
                    .draw_image_with_html_image_element_and_dw_and_dh(map, 0., 0., width, height);
            }
        });

        // A restrained edge shade preserves HUD and health-bar contrast on bright maps.
        self.context.set_fill_style_str("rgba(4, 11, 22, 0.10)");
        self.context.fill_rect(0., 0., width, 18.);
        self.context.fill_rect(0., height - 18., width, 18.);

        for defender in &state.defenders {
            draw_defender_readability(
                &self.context,
                state,
                defender,
                width,
                height,
                reduced_motion,
            );
        }
        for enemy in &state.enemies {
            let prior = previous_enemy(previous, enemy);
            draw_enemy_motion(&self.context, state, enemy, prior, width, height, frame);
        }

        for defender in &state.defenders {
            let Some(sprite) = defender_sprite(&defender.kind) else {
                continue;
            };
            let size = defender_sprite_size(defender.level);
            let center_x = f64::from(defender.x) * width / 1000.;
            let center_y = f64::from(defender.y) * height / 562.;
            circle(&self.context, center_x, center_y + 5., size * 0.26);
            self.context.set_fill_style_str("rgba(3, 8, 16, .24)");
            self.context.fill();
            let (dx, dy) = defender_sprite_destination(sprite, center_x, center_y, size);
            ASSETS.with(|slot| {
                if let Some(assets) = slot.borrow().as_ref() {
                    let sx = f64::from(sprite.index % 3) * 512.;
                    let sy = f64::from(sprite.index / 3) * 512.;
                    let _ = self.context.draw_image_with_html_image_element_and_sw_and_sh_and_dx_and_dy_and_dw_and_dh(
                        &assets.defenders, sx, sy, 512., 512., dx, dy, size, size,
                    );
                }
            });
            if let Some(label) = defender_level_badge(defender.level) {
                self.context.set_fill_style_str("rgba(10, 15, 24, .86)");
                circle(&self.context, center_x, center_y + 7., 14.);
                self.context.fill();
                self.context.set_fill_style_str("#fef08a");
                self.context.set_font("800 12px system-ui");
                self.context.set_text_align("center");
                let _ = self.context.fill_text(&label, center_x, center_y + 11.);
            }
        }

        if let Some(previous) = previous.filter(|previous| {
            previous.session_id == state.session_id && previous.level == state.level
        }) {
            for departed in previous.enemies.iter().filter(|departed| {
                !state
                    .enemies
                    .iter()
                    .any(|current| current.id == departed.id)
            }) {
                // A neutral prior-only fade represents an authoritative entity departure. The
                // renderer deliberately does not guess whether the simulation killed or leaked it.
                draw_departing_enemy(&self.context, state.level, departed, width, height, frame);
            }
        }

        for enemy in &state.enemies {
            let prior = previous_enemy(previous, enemy);
            draw_enemy_sprite(&self.context, state, enemy, prior, width, height, frame);
        }

        for defender in &state.defenders {
            draw_attack_feedback(
                &self.context,
                state,
                previous,
                defender,
                width,
                height,
                frame,
            );
        }
        draw_modifier_overlay(&self.context, state, width, height, tick, reduced_motion);
        draw_status_overlay(&self.context, state, width, height);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use game_protocol::{EntityId, PlayerId};

    fn assert_near(actual: f64, expected: f64) {
        assert!((actual - expected).abs() < 0.001, "{actual} != {expected}");
    }

    #[test]
    fn stable_hash_is_repeatable_and_sensitive_to_ids() {
        assert_eq!(stable_hash("enemy-42"), stable_hash("enemy-42"));
        assert_ne!(stable_hash("enemy-42"), stable_hash("enemy-43"));
    }

    #[test]
    fn every_enemy_kind_has_a_distinct_authored_visual_profile() {
        let expected = [
            ("basic", 0, EnemyEffect::SneakerWake),
            ("fast", 1, EnemyEffect::BladeStreak),
            ("armored", 2, EnemyEffect::HeavyStomp),
            ("swarm", 3, EnemyEffect::BalletSparkle),
            ("disruption", 4, EnemyEffect::SignalRipple),
            ("boss", 5, EnemyEffect::OrbitTrail),
        ];
        for (kind, index, effect) in expected {
            let visual = enemy_visual(kind).expect("authored enemy visual");
            assert_eq!(visual.index, index);
            assert_eq!(visual.effect, effect);
            assert!(visual.size >= 64.);
            assert!(visual.stride_pixels > 0.);
            assert!(visual.shadow_x > visual.shadow_y);
        }
        assert!(enemy_visual("unknown").is_none());
        assert!(enemy_visual("swarm").expect("ballerina").size >= 52.);
        assert!(enemy_visual("armored").expect("tung").size >= 68.);
    }

    #[test]
    fn four_frame_stacked_atlas_coordinates_stay_inside_the_contract() {
        for kind in ["basic", "fast", "armored", "swarm", "disruption", "boss"] {
            let visual = enemy_visual(kind).expect("authored enemy visual");
            for frame in 0..ENEMY_FRAME_COUNT {
                let (source_x, source_y) = enemy_atlas_source(visual, frame);
                assert!(source_x >= 0. && source_x + ENEMY_CELL_SIZE <= 1536.);
                assert!(source_y >= 0. && source_y + ENEMY_CELL_SIZE <= 4096.);
                assert_eq!(
                    source_y,
                    f64::from(frame * 2 + visual.index / 3) * ENEMY_CELL_SIZE
                );
            }
        }
    }

    #[test]
    fn locomotion_sequences_reserve_authored_special_frames() {
        for index in [1, 2, 5] {
            let frames = [
                locomotion_frame(index, 0.01),
                locomotion_frame(index, 0.35),
                locomotion_frame(index, 0.69),
                locomotion_frame(index, 0.99),
            ];
            assert_eq!(frames, [0, 1, 3, 3]);
            assert!(!frames.contains(&2));
        }
        for index in [0, 3, 4] {
            assert_eq!(
                [
                    locomotion_frame(index, 0.01),
                    locomotion_frame(index, 0.26),
                    locomotion_frame(index, 0.51),
                    locomotion_frame(index, 0.76),
                ],
                [0, 1, 2, 3]
            );
        }
    }

    #[test]
    fn dramatic_enemy_poses_require_a_real_hit_reaction() {
        for index in [1, 2, 5] {
            assert_ne!(enemy_animation_frame(index, 0.4, 0.), 2);
            assert_ne!(enemy_animation_frame(index, 0.4, 0.08), 2);
            assert_eq!(enemy_animation_frame(index, 0.4, 0.081), 2);
        }
        for index in [0, 3, 4] {
            assert_eq!(
                enemy_animation_frame(index, 0.4, 1.),
                locomotion_frame(index, 0.4)
            );
        }
    }

    #[test]
    fn gait_phase_is_repeatable_and_entity_ids_desynchronize_frames() {
        let distance = 381.5;
        let stride = enemy_visual("basic").expect("basic visual").stride_pixels;
        let phase = gait_cycle(distance, stride, stable_hash("enemy-repeat"));
        assert_near(
            phase,
            gait_cycle(distance, stride, stable_hash("enemy-repeat")),
        );

        let frames: std::collections::HashSet<_> = (0..32)
            .map(|index| {
                let id = format!("enemy-{index}");
                locomotion_frame(0, gait_cycle(distance, stride, stable_hash(&id)))
            })
            .collect();
        assert!(
            frames.len() > 1,
            "stable entity phases remained synchronized"
        );
    }

    #[test]
    fn reduced_motion_freezes_the_visual_clock() {
        assert_near(animation_tick(846, 847, 0.5, true), 0.);
        assert_near(animation_tick(846, 847, 0.5, false), 846.5);
        assert_near(motion_phase(0.625, true), 0.);
        assert_near(motion_phase(1.625, false), 0.625);
    }

    fn enemy_kind(id: &str, kind: &str, path: u8, progress: u16) -> EnemyState {
        EnemyState {
            id: EntityId(id.into()),
            kind: kind.into(),
            path,
            progress,
            health: 10,
            max_health: 10,
            slowed_ticks: 0,
            control_resistance_ticks: 0,
            armor: 0,
            reward: 1,
            leak_damage: 1,
        }
    }

    fn enemy(id: &str, path: u8, progress: u16) -> EnemyState {
        enemy_kind(id, "basic", path, progress)
    }

    fn defender(kind: &str, path: &str, level: u8) -> DefenderState {
        DefenderState {
            id: EntityId(format!("{kind}-{path}-{level}")),
            owner: PlayerId("player".into()),
            kind: kind.into(),
            x: 0,
            y: 0,
            level,
            path: path.into(),
            cooldown_ticks: 0,
            target_policy: TargetPolicy::First,
        }
    }

    #[test]
    fn physical_gait_distance_advances_in_proportion_to_route_progress() {
        let start = physical_route_distance(1, 0, 100.);
        let slow_step = physical_route_distance(1, 0, 101.) - start;
        let fast_step = physical_route_distance(1, 0, 106.) - start;
        assert!(slow_step > 0.);
        assert_near(fast_step / slow_step, 6.);
    }

    #[test]
    fn sampled_tangent_points_toward_increasing_route_progress() {
        for progress in [0., 100., 300., 500., 700., 900., 1000.] {
            let tangent = route_tangent(1, 0, progress);
            assert_near(tangent.0.hypot(tangent.1), 1.);
            let before = logical_path_position(1, 0, progress - 2.);
            let after = logical_path_position(1, 0, progress + 2.);
            let dot = tangent.0 * (after.0 - before.0) + tangent.1 * (after.1 - before.1);
            assert!(dot > 0., "tangent reversed at progress {progress}");
        }
    }

    #[test]
    fn hit_reaction_requires_a_real_health_drop_and_decays() {
        let mut previous = enemy("hit", 0, 300);
        previous.max_health = 100;
        previous.health = 100;
        let mut current = previous.clone();
        current.health = 70;
        let initial = damage_hit_strength(&current, Some(&previous), 0.);
        let middle = damage_hit_strength(&current, Some(&previous), 0.5);
        assert!(initial > middle && middle > 0.);
        assert_near(damage_hit_strength(&current, Some(&previous), 1.), 0.);
        assert_near(damage_hit_strength(&previous, Some(&previous), 0.), 0.);
        let mut healed = previous.clone();
        healed.health = 110;
        assert_near(damage_hit_strength(&healed, Some(&previous), 0.), 0.);
    }

    #[test]
    fn reduced_motion_keeps_translation_but_neutralizes_the_pose() {
        let previous = enemy_kind("reduced", "fast", 0, 240);
        let mut current = enemy_kind("reduced", "fast", 0, 246);
        current.health = 7;
        let pose = enemy_pose(1, &current, Some(&previous), 0.5, true).expect("known enemy");
        let expected = logical_position(1, &current, Some(&previous), 0.5);
        assert_near(pose.logical_x, expected.0);
        assert_near(pose.logical_y, expected.1);
        assert_eq!(pose.frame, 0);
        assert_near(pose.lift, 0.);
        assert_near(pose.scale_x, 1.);
        assert_near(pose.scale_y, 1.);
        assert_near(pose.rotation, 0.);
        assert_near(pose.shadow_scale, 1.);
    }

    #[test]
    fn enemy_sprite_ground_pivot_registers_on_the_route() {
        for size in [52., 68., 122.] {
            let destination_y = -ENEMY_GROUND_ANCHOR_Y * size / ENEMY_CELL_SIZE;
            let rendered_anchor = destination_y + ENEMY_GROUND_ANCHOR_Y * size / ENEMY_CELL_SIZE;
            assert_near(rendered_anchor, 0.);
        }
    }

    #[test]
    fn enemy_positions_interpolate_at_subpixel_precision_between_ticks() {
        let previous = enemy("enemy-1", 0, 240);
        let current = enemy("enemy-1", 0, 246);
        let start = path_position_precise(1, 0, previous.progress);
        let end = path_position_precise(1, 0, current.progress);
        let middle_start = path_position_precise(1, 0, 241);
        let middle_end = path_position_precise(1, 0, 242);
        let scale = f64::from(PATH_POSITION_SCALE);

        let (start_x, start_y) = logical_position(1, &current, Some(&previous), 0.);
        let (middle_x, middle_y) = logical_position(1, &current, Some(&previous), 0.25);
        let (end_x, end_y) = logical_position(1, &current, Some(&previous), 1.);

        assert_near(start_x, f64::from(start.x) / scale);
        assert_near(start_y, f64::from(start.y) / scale);
        assert_near(
            middle_x,
            f64::from(middle_start.x + middle_end.x) / (2. * scale),
        );
        assert_near(
            middle_y,
            f64::from(middle_start.y + middle_end.y) / (2. * scale),
        );
        assert_near(end_x, f64::from(end.x) / scale);
        assert_near(end_y, f64::from(end.y) / scale);
    }

    #[test]
    fn school_enemies_on_both_lanes_reach_the_shared_road_terminus() {
        let expected_x = 1_000_u32 * PATH_POSITION_SCALE;
        let expected_y = 250_u32 * PATH_POSITION_SCALE;

        for lane in 0..=1 {
            let endpoint = path_position_precise(2, lane, 1_000);
            assert_eq!(endpoint.x, expected_x, "school lane {lane} endpoint x");
            assert_eq!(endpoint.y, expected_y, "school lane {lane} endpoint y");

            let current = enemy(&format!("school-end-{lane}"), lane, 1_000);
            let (x, y) = logical_position(2, &current, None, 1.);
            assert_near(x, 1_000.);
            assert_near(y, 250.);
        }
    }

    #[test]
    fn school_final_progress_approaches_the_goal_monotonically_on_both_lanes() {
        let scale = f64::from(PATH_POSITION_SCALE);

        for lane in 0..=1 {
            let goal = path_position_precise(2, lane, 1_000);
            let goal_x = f64::from(goal.x) / scale;
            let goal_y = f64::from(goal.y) / scale;
            let previous = enemy(&format!("school-approach-{lane}"), lane, 996);
            let current = enemy(&format!("school-approach-{lane}"), lane, 1_000);
            let mut previous_distance = f64::INFINITY;

            for alpha in [0., 0.25, 0.5, 0.75, 1.] {
                let (x, y) = logical_position(2, &current, Some(&previous), alpha);
                let distance = (goal_x - x).hypot(goal_y - y);
                assert!(
                    distance < previous_distance,
                    "school lane {lane} moved away from its goal at alpha {alpha}: {distance} >= {previous_distance}"
                );
                previous_distance = distance;
            }

            assert_near(previous_distance, 0.);
        }
    }

    #[test]
    fn school_goal_scaling_stays_aligned_at_native_and_compact_sizes() {
        let scale = f64::from(PATH_POSITION_SCALE);
        let compact_width = 390.;
        let compact_height = compact_width * LOGICAL_HEIGHT / LOGICAL_WIDTH;

        for lane in 0..=1 {
            let endpoint = path_position_precise(2, lane, 1_000);
            let logical_x = f64::from(endpoint.x) / scale;
            let logical_y = f64::from(endpoint.y) / scale;

            for (width, height) in [
                (LOGICAL_WIDTH, LOGICAL_HEIGHT),
                (compact_width, compact_height),
            ] {
                let (x, y) = scaled_point(logical_x, logical_y, width, height);
                assert_near(x, width);
                assert_near(y, height * 250. / LOGICAL_HEIGHT);
            }
        }
    }

    #[test]
    fn same_lane_interpolation_resamples_a_curved_route_instead_of_cutting_the_bend() {
        let previous = enemy("enemy-curve", 0, 300);
        let current = enemy("enemy-curve", 0, 380);
        let start = path_position_precise(1, 0, previous.progress);
        let route_middle = path_position_precise(1, 0, 340);
        let end = path_position_precise(1, 0, current.progress);
        let scale = f64::from(PATH_POSITION_SCALE);

        let (x, y) = logical_position(1, &current, Some(&previous), 0.5);
        let chord_x = f64::from(start.x + end.x) / (2. * scale);
        let chord_y = f64::from(start.y + end.y) / (2. * scale);

        assert_near(x, f64::from(route_middle.x) / scale);
        assert_near(y, f64::from(route_middle.y) / scale);
        assert!(
            (x - chord_x).hypot(y - chord_y) > 2.,
            "curved route midpoint unexpectedly matched the coordinate chord"
        );
    }

    #[test]
    fn newly_spawned_enemy_animates_out_of_the_route_entrance() {
        let current = enemy("enemy-new", 0, 6);
        let entrance = path_position_precise(1, 0, 0);
        let scale = f64::from(PATH_POSITION_SCALE);
        let (x, y) = logical_position(1, &current, None, 0.);
        assert_near(x, f64::from(entrance.x) / scale);
        assert_near(y, f64::from(entrance.y) / scale);
    }

    #[test]
    fn late_observed_enemy_snaps_to_its_authoritative_route_position() {
        let current = enemy("enemy-late", 0, 400);
        let expected = path_position_precise(1, 0, current.progress);
        let scale = f64::from(PATH_POSITION_SCALE);
        let (x, y) = logical_position(1, &current, None, 0.);
        assert_near(x, f64::from(expected.x) / scale);
        assert_near(y, f64::from(expected.y) / scale);
    }

    #[test]
    fn large_same_lane_progress_gap_snaps_instead_of_speed_warping() {
        let previous = enemy("enemy-stale", 0, 100);
        let current = enemy("enemy-stale", 0, 400);
        let expected = path_position_precise(1, 0, current.progress);
        let scale = f64::from(PATH_POSITION_SCALE);
        let (x, y) = logical_position(1, &current, Some(&previous), 0.);
        assert_near(x, f64::from(expected.x) / scale);
        assert_near(y, f64::from(expected.y) / scale);
    }

    #[test]
    fn gameplay_rewind_snaps_to_the_authoritative_route_position() {
        let previous = enemy("enemy-rewound", 0, 400);
        let current = enemy("enemy-rewound", 0, 360);
        let expected = path_position_precise(1, 0, current.progress);
        let scale = f64::from(PATH_POSITION_SCALE);
        let (x, y) = logical_position(1, &current, Some(&previous), 0.);
        assert_near(x, f64::from(expected.x) / scale);
        assert_near(y, f64::from(expected.y) / scale);
    }

    #[test]
    fn route_changes_do_not_cut_across_the_map_during_interpolation() {
        let previous = enemy("boss", 0, 600);
        let current = enemy("boss", 1, 601);
        let expected = path_position_precise(5, 1, current.progress);
        let scale = f64::from(PATH_POSITION_SCALE);
        let (x, y) = logical_position(5, &current, Some(&previous), 0.);
        assert_near(x, f64::from(expected.x) / scale);
        assert_near(y, f64::from(expected.y) / scale);
    }

    #[test]
    fn attack_feedback_only_covers_the_recent_cooldown_window() {
        assert_eq!(attack_progress(7, 7), Some(0.));
        assert_eq!(attack_progress(5, 7), Some(0.5));
        assert_eq!(attack_progress(2, 7), None);
        assert_eq!(attack_progress(0, 7), None);
    }

    #[test]
    fn upgrade_rendering_uses_authored_path_stats_through_level_five() {
        assert_eq!(
            defender_render_stats(&defender("zip_zapper", "base", 1)),
            Some(DefenderRenderStats {
                range: 135,
                cooldown: 7,
            })
        );
        assert_eq!(
            defender_render_stats(&defender("zip_zapper", "Overclock", 5)),
            Some(DefenderRenderStats {
                range: 163,
                cooldown: 2,
            })
        );
        assert_eq!(
            defender_render_stats(&defender("zip_zapper", "Chain Ping", 5)),
            Some(DefenderRenderStats {
                range: 171,
                cooldown: 7,
            })
        );
        assert_eq!(
            defender_render_stats(&defender("deep_scroller", "Zoom Lens", 5)),
            Some(DefenderRenderStats {
                range: 365,
                cooldown: 30,
            })
        );
        assert_eq!(
            defender_render_stats(&defender("side_hustler", "Passive Income", 5)),
            Some(DefenderRenderStats {
                range: 0,
                cooldown: 45,
            })
        );
    }

    #[test]
    fn upgrade_badges_and_sprite_scale_cover_every_authored_level() {
        assert_eq!(defender_level_badge(1), None);
        for (level, expected) in [(2, "2★"), (3, "3★"), (4, "4★"), (5, "5★")] {
            assert_eq!(defender_level_badge(level).as_deref(), Some(expected));
        }
        assert_eq!(defender_level_badge(MAX_DEFENDER_LEVEL + 1), None);

        assert_near(defender_sprite_size(1), 98.);
        assert_near(defender_sprite_size(2), 103.);
        assert_near(defender_sprite_size(3), 108.);
        assert_near(defender_sprite_size(4), 113.);
        assert_near(defender_sprite_size(5), 118.);
        assert_near(defender_sprite_size(MAX_DEFENDER_LEVEL + 1), 118.);
    }

    #[test]
    fn canonical_coordinates_scale_without_changing_endpoints() {
        let (origin_x, origin_y) = scaled_point(0., 0., 500., 281.);
        let (middle_x, middle_y) = scaled_point(500., 281., 500., 281.);
        let (end_x, end_y) = scaled_point(1000., 562., 500., 281.);
        assert_near(origin_x, 0.);
        assert_near(origin_y, 0.);
        assert_near(middle_x, 250.);
        assert_near(middle_y, 140.5);
        assert_near(end_x, 500.);
        assert_near(end_y, 281.);
    }

    #[test]
    fn every_tower_foundation_registers_exactly_on_the_authoritative_pad() {
        for (kind, expected) in [
            (
                "zip_zapper",
                DefenderSprite {
                    index: 0,
                    ground_anchor_x: 281.,
                    ground_anchor_y: 378.,
                },
            ),
            (
                "caps_lock",
                DefenderSprite {
                    index: 1,
                    ground_anchor_x: 239.,
                    ground_anchor_y: 375.,
                },
            ),
            (
                "buffer_buddy",
                DefenderSprite {
                    index: 2,
                    ground_anchor_x: 206.,
                    ground_anchor_y: 388.,
                },
            ),
            (
                "side_hustler",
                DefenderSprite {
                    index: 3,
                    ground_anchor_x: 286.,
                    ground_anchor_y: 332.,
                },
            ),
            (
                "final_form",
                DefenderSprite {
                    index: 4,
                    ground_anchor_x: 248.,
                    ground_anchor_y: 331.,
                },
            ),
            (
                "deep_scroller",
                DefenderSprite {
                    index: 5,
                    ground_anchor_x: 238.,
                    ground_anchor_y: 381.,
                },
            ),
        ] {
            let sprite = defender_sprite(kind).expect("known defender sprite");
            assert_eq!(sprite, expected, "authored atlas anchor changed for {kind}");
            for (width, height) in [(1000., 562.), (500., 281.), (390., 219.18)] {
                let center_x = 420. * width / LOGICAL_WIDTH;
                let center_y = 365. * height / LOGICAL_HEIGHT;
                let size = 98. * width / LOGICAL_WIDTH;
                let (dx, dy) = defender_sprite_destination(sprite, center_x, center_y, size);
                assert_near(dx + sprite.ground_anchor_x * size / 512., center_x);
                assert_near(dy + sprite.ground_anchor_y * size / 512., center_y);
            }
        }
    }
}
