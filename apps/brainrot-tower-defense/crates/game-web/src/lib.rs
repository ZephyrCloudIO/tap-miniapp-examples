//! Browser lifecycle and UI entry point for the all-Rust WASM miniapp.
use game_content::{
    Defender, MAX_DEFENDER_LEVEL, WAVE_CLEAR_BONUS, defenders, levels, next_upgrade_tier,
    scaled_build_pads, upgrade_path,
};
use game_core::{Simulation, record_completions};
use game_protocol::{
    AudioSettings, ChannelIndex, CommandAck, CommandId, CommandKind, CommandQueue, EntityId,
    Member, MemberRole, PendingGameEvent, PlayerCommand, PlayerId, Progress, QueuedCommand,
    SessionId, SessionSnapshot, SessionStatus, TargetPolicy,
};
use game_renderer::Renderer;
use js_sys::Reflect;
use serde::{Deserialize, Serialize};
use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    rc::{Rc, Weak},
};
use tap_bridge::{PresenceSnapshot, PresenceSubscription, Runtime};
use wasm_bindgen::{JsCast, closure::Closure, prelude::*};
use wasm_bindgen_futures::spawn_local;
use web_sys::{
    AudioContext, CanvasRenderingContext2d, Document, Element, Event, GainNode, HtmlCanvasElement,
    HtmlElement, HtmlInputElement, HtmlSelectElement, MouseEvent, Node, OscillatorType, Storage,
};

const PREVIEW_KEY: &str = "tap-example.brainrot-td.preview.v1";
const SIMULATION_STEP_MS: f64 = 100.;
const MAX_CATCH_UP_STEPS: u8 = 5;
type EventClosure = Closure<dyn FnMut(Event)>;
type AnimationClosure = Closure<dyn FnMut(f64)>;
thread_local! {
    static ACTIVE: RefCell<Option<Rc<App>>> = const { RefCell::new(None) };
    static PHASE: RefCell<&'static str> = const { RefCell::new("created") };
    static DEFENDER_SPRITE_URL: RefCell<Option<String>> = const { RefCell::new(None) };
}

#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn configure_assets(
    backyard: String,
    school: String,
    food_court: String,
    suburb: String,
    final_feed: String,
    defenders: String,
    enemies: String,
) -> Result<(), JsValue> {
    game_renderer::configure_asset_urls(
        [&backyard, &school, &food_court, &suburb, &final_feed],
        &defenders,
        &enemies,
    )?;
    DEFENDER_SPRITE_URL.with(|slot| *slot.borrow_mut() = Some(defenders));
    for delay in [80, 240, 700] {
        let redraw = Closure::<dyn FnMut()>::once(|| {
            ACTIVE.with(|active| {
                if let Some(app) = active.borrow().as_ref() {
                    let _ = render(app);
                }
            });
        });
        if let Some(window) = web_sys::window() {
            let _ = window.set_timeout_with_callback_and_timeout_and_arguments_0(
                redraw.as_ref().unchecked_ref(),
                delay,
            );
            redraw.forget();
        }
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct PreviewSave {
    schema_version: u16,
    player_id: PlayerId,
    #[serde(default)]
    display_name: String,
    progress: Progress,
    sessions: Vec<SessionSnapshot>,
    master: u8,
    music: u8,
    effects: u8,
    #[serde(default)]
    muted: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct LifecycleCheckpoint {
    schema_version: u16,
    channel_id: String,
    player_id: PlayerId,
    active_session_id: Option<SessionId>,
    last_sequence: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum PlacementMode {
    New(String),
    Move(EntityId),
}

#[derive(Debug, Default)]
struct FixedStepClock {
    last_ms: Option<f64>,
    accumulated_ms: f64,
}

impl FixedStepClock {
    fn restart(&mut self, now_ms: f64) {
        self.last_ms = now_ms.is_finite().then_some(now_ms);
        self.accumulated_ms = 0.;
    }

    fn reset(&mut self) {
        self.last_ms = None;
        self.accumulated_ms = 0.;
    }

    fn steps_due(&mut self, now_ms: f64) -> u8 {
        if !now_ms.is_finite() {
            self.reset();
            return 0;
        }
        let Some(previous_ms) = self.last_ms.replace(now_ms) else {
            return 0;
        };
        let elapsed_ms = now_ms - previous_ms;
        if !elapsed_ms.is_finite() || elapsed_ms < 0. {
            self.restart(now_ms);
            return 0;
        }
        self.accumulated_ms += elapsed_ms.min(SIMULATION_STEP_MS * f64::from(MAX_CATCH_UP_STEPS));
        let steps = (self.accumulated_ms / SIMULATION_STEP_MS)
            .floor()
            .clamp(0., f64::from(MAX_CATCH_UP_STEPS)) as u8;
        self.accumulated_ms -= f64::from(steps) * SIMULATION_STEP_MS;
        steps
    }
}

#[derive(Clone, Debug)]
struct PresentationFrame {
    session_id: SessionId,
    previous: SessionSnapshot,
    current_tick: u64,
    started_ms: f64,
    duration_ms: f64,
}

impl PresentationFrame {
    fn alpha(&self, now_ms: f64) -> f64 {
        if !now_ms.is_finite() || self.duration_ms <= 0. {
            return 1.;
        }
        ((now_ms - self.started_ms) / self.duration_ms).clamp(0., 1.)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DefenderShopState {
    Ready,
    Selected,
    Locked,
    Unaffordable,
    NoOpenPad,
    PlayerSlotRequired,
    StatusUnavailable,
    AuthorityUnavailable,
    AuthoritativeActionPending,
}

impl DefenderShopState {
    const fn label(self) -> &'static str {
        match self {
            Self::Ready => "Ready to place",
            Self::Selected => "Selected for placement",
            Self::Locked => "Locked",
            Self::Unaffordable => "Not enough resources",
            Self::NoOpenPad => "No open build pad",
            Self::PlayerSlotRequired => "A player slot is required",
            Self::StatusUnavailable => "Placement is unavailable in the current game state",
            Self::AuthorityUnavailable => "TAP host authority is unavailable",
            Self::AuthoritativeActionPending => {
                "Waiting for the pending authoritative action to synchronize"
            }
        }
    }

    const fn data_value(self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::Selected => "selected",
            Self::Locked => "locked",
            Self::Unaffordable => "unaffordable",
            Self::NoOpenPad => "no-pad",
            Self::PlayerSlotRequired => "no-slot",
            Self::StatusUnavailable => "unavailable",
            Self::AuthorityUnavailable => "no-authority",
            Self::AuthoritativeActionPending => "pending",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct LiveEconomyState {
    resources: u32,
    open_pads: usize,
    has_player_slot: bool,
    status: SessionStatus,
    has_authority: bool,
    authoritative_command_pending: bool,
}

impl LiveEconomyState {
    const fn defender_state(self, selected: bool, unlocked: bool, cost: u32) -> DefenderShopState {
        if selected {
            DefenderShopState::Selected
        } else if !unlocked {
            DefenderShopState::Locked
        } else if !self.has_player_slot {
            DefenderShopState::PlayerSlotRequired
        } else if !matches!(
            self.status,
            SessionStatus::BetweenWaves | SessionStatus::Running
        ) {
            DefenderShopState::StatusUnavailable
        } else if !self.has_authority {
            DefenderShopState::AuthorityUnavailable
        } else if self.authoritative_command_pending {
            DefenderShopState::AuthoritativeActionPending
        } else if self.open_pads == 0 {
            DefenderShopState::NoOpenPad
        } else if self.resources < cost {
            DefenderShopState::Unaffordable
        } else {
            DefenderShopState::Ready
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct DefenderShopPresentation {
    state: DefenderShopState,
    selected: bool,
    disabled: bool,
    description: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum UpgradeBranchState {
    Available,
    Committed,
    Locked,
    Maxed,
}

impl UpgradeBranchState {
    const fn data_value(self) -> &'static str {
        match self {
            Self::Available => "available",
            Self::Committed => "committed",
            Self::Locked => "locked",
            Self::Maxed => "maxed",
        }
    }

    const fn label(self) -> &'static str {
        match self {
            Self::Available => "Choose path",
            Self::Committed => "Active path",
            Self::Locked => "Locked",
            Self::Maxed => "Max level",
        }
    }

    const fn can_purchase(self) -> bool {
        matches!(self, Self::Available | Self::Committed)
    }
}

fn upgrade_branch_state(
    current_level: u8,
    committed_path: &str,
    candidate_path: &str,
) -> UpgradeBranchState {
    if current_level <= 1 {
        UpgradeBranchState::Available
    } else if committed_path != candidate_path {
        UpgradeBranchState::Locked
    } else if current_level >= MAX_DEFENDER_LEVEL {
        UpgradeBranchState::Maxed
    } else {
        UpgradeBranchState::Committed
    }
}

fn completed_upgrade_tiers(current_level: u8, committed_path: &str, candidate_path: &str) -> u8 {
    if current_level <= 1 || committed_path != candidate_path {
        0
    } else {
        current_level
            .saturating_sub(1)
            .min(MAX_DEFENDER_LEVEL.saturating_sub(1))
    }
}

fn upgrade_disabled_reason(
    branch_state: UpgradeBranchState,
    status: SessionStatus,
    has_player_slot: bool,
    has_authority: bool,
    authoritative_command_pending: bool,
    resources: u32,
    cost: u32,
) -> Option<String> {
    match branch_state {
        UpgradeBranchState::Locked => return Some("This upgrade branch is locked".into()),
        UpgradeBranchState::Maxed => {
            return Some("This defender is already at max level".into());
        }
        UpgradeBranchState::Available | UpgradeBranchState::Committed => {}
    }
    if authoritative_command_pending {
        Some("Wait for the pending authoritative action to synchronize".into())
    } else if !matches!(status, SessionStatus::BetweenWaves | SessionStatus::Running) {
        Some("Upgrades are unavailable in the current game state".into())
    } else if !has_player_slot {
        Some("Claim a player slot before upgrading".into())
    } else if !has_authority {
        Some("TAP host authority is unavailable".into())
    } else if resources < cost {
        Some(format!(
            "Need {} more resources",
            cost.saturating_sub(resources)
        ))
    } else {
        None
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PresenceCursor {
    x: u16,
    y: u16,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct GamePresenceState {
    schema_version: u16,
    game_id: Option<SessionId>,
    activity: String,
    ready: bool,
    cursor: Option<PresenceCursor>,
    placement: Option<String>,
    #[serde(default)]
    recent_action: Option<String>,
}

#[derive(Clone, Debug)]
struct AwaitingCommand {
    session_id: String,
    command: PlayerCommand,
}

struct App {
    root: Element,
    document: Document,
    runtime: Runtime,
    channel: String,
    player: PlayerId,
    display_name: RefCell<String>,
    authority: RefCell<bool>,
    progress: RefCell<Progress>,
    sessions: RefCell<Vec<SessionSnapshot>>,
    active: RefCell<Option<usize>>,
    index_revision: RefCell<Option<u64>>,
    session_revisions: RefCell<HashMap<String, u64>>,
    progress_revision: RefCell<Option<u64>>,
    settings_revision: RefCell<Option<u64>>,
    loading: RefCell<bool>,
    saving: RefCell<bool>,
    pending_sessions: RefCell<HashSet<String>>,
    pending_index: RefCell<bool>,
    pending_progress: RefCell<bool>,
    pending_settings: RefCell<bool>,
    awaiting_commands: RefCell<HashMap<String, AwaitingCommand>>,
    pending_command_started: RefCell<HashMap<String, f64>>,
    own_cued_sequences: RefCell<HashSet<u64>>,
    processing_sessions: RefCell<HashSet<String>>,
    poll_counter: RefCell<u8>,
    error: RefCell<Option<String>>,
    notice: RefCell<Option<String>>,
    placement: RefCell<Option<PlacementMode>>,
    inspected_defender: RefCell<Option<EntityId>>,
    pending_focus_id: RefCell<Option<String>>,
    master: RefCell<u8>,
    music: RefCell<u8>,
    effects: RefCell<u8>,
    muted: RefCell<bool>,
    audio: RefCell<Option<AudioEngine>>,
    cursor: RefCell<Option<PresenceCursor>>,
    last_presence_update_ms: RefCell<f64>,
    presence: RefCell<Option<PresenceSnapshot<GamePresenceState>>>,
    presence_subscription: RefCell<Option<PresenceSubscription>>,
    events: Option<JsValue>,
    presentation: RefCell<Option<PresentationFrame>>,
    simulation_clock: RefCell<FixedStepClock>,
    animation: RefCell<Option<AnimationClosure>>,
    animation_frame_id: RefCell<Option<i32>>,
    closures: RefCell<Vec<EventClosure>>,
    timer: RefCell<Option<Closure<dyn FnMut()>>>,
    timer_id: RefCell<Option<i32>>,
}

struct AudioEngine {
    context: AudioContext,
    master: GainNode,
    music: GainNode,
    effects: GainNode,
}

fn normalize_display_name(value: &str) -> String {
    value
        .trim()
        .chars()
        .filter(|character| !character.is_control())
        .take(40)
        .collect::<String>()
        .trim()
        .to_string()
}

fn set_text_by_id(app: &App, id: &str, value: String) {
    if let Some(element) = app.document.get_element_by_id(id) {
        element.set_text_content(Some(&value));
    }
}

fn set_text_by_id_if_changed(app: &App, id: &str, value: String) {
    if let Some(element) = app.document.get_element_by_id(id)
        && element.text_content().as_deref() != Some(value.as_str())
    {
        element.set_text_content(Some(&value));
    }
}

fn focus_by_id(document: &Document, id: &str) -> bool {
    if let Some(element) = document
        .get_element_by_id(id)
        .and_then(|element| element.dyn_into::<HtmlElement>().ok())
    {
        let _ = element.focus();
        element.matches(":focus").unwrap_or(false)
    } else {
        false
    }
}

fn focus_first_available_pad(document: &Document) {
    if let Ok(Some(element)) = document.query_selector(".hud-pad:not(:disabled)")
        && let Ok(element) = element.dyn_into::<HtmlElement>()
    {
        let _ = element.focus();
    }
}

fn preserve_active_focus(app: &App) {
    if app.pending_focus_id.borrow().is_some() {
        return;
    }
    let Some(id) = app
        .document
        .active_element()
        .map(|element| element.id())
        .filter(|id| !id.is_empty())
    else {
        return;
    };
    *app.pending_focus_id.borrow_mut() = Some(id);
}

fn placement_completion_focus_id(kind: &CommandKind) -> Option<String> {
    match kind {
        CommandKind::Place { .. } => Some("btd-game-stage".into()),
        CommandKind::Move { entity_id, .. } => {
            Some(format!("btd-defender-hotspot-{}", entity_id.0))
        }
        CommandKind::Upgrade { .. } => Some("btd-defender-inspector".into()),
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum VictoryActionAvailability {
    Enabled,
    HostOnly,
    AuthorityUnavailable,
    Pending,
    FinalLevel,
}

impl VictoryActionAvailability {
    const fn is_enabled(self) -> bool {
        matches!(self, Self::Enabled)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct VictoryActionsAvailability {
    restart: VictoryActionAvailability,
    advance: VictoryActionAvailability,
}

fn victory_actions_availability(
    is_host: bool,
    authority_available: bool,
    pending: bool,
    current_level: u8,
    max_level: u8,
) -> VictoryActionsAvailability {
    let shared = if !is_host {
        VictoryActionAvailability::HostOnly
    } else if !authority_available {
        VictoryActionAvailability::AuthorityUnavailable
    } else if pending {
        VictoryActionAvailability::Pending
    } else {
        VictoryActionAvailability::Enabled
    };
    let advance = if shared != VictoryActionAvailability::Enabled {
        shared
    } else if current_level >= max_level {
        VictoryActionAvailability::FinalLevel
    } else {
        VictoryActionAvailability::Enabled
    };
    VictoryActionsAvailability {
        restart: shared,
        advance,
    }
}

const fn restart_action_description(availability: VictoryActionAvailability) -> &'static str {
    match availability {
        VictoryActionAvailability::Enabled => "Restart level",
        VictoryActionAvailability::HostOnly => "Only the host can restart the level",
        VictoryActionAvailability::AuthorityUnavailable => {
            "Restart unavailable because TAP host authority is unavailable"
        }
        VictoryActionAvailability::Pending => {
            "Restart unavailable while an action is synchronizing"
        }
        VictoryActionAvailability::FinalLevel => "Restart level",
    }
}

const fn advance_action_description(availability: VictoryActionAvailability) -> &'static str {
    match availability {
        VictoryActionAvailability::Enabled => "Continue to next level",
        VictoryActionAvailability::HostOnly => "Only the host can continue to the next level",
        VictoryActionAvailability::AuthorityUnavailable => {
            "Next level unavailable because TAP host authority is unavailable"
        }
        VictoryActionAvailability::Pending => {
            "Next level unavailable while an action is synchronizing"
        }
        VictoryActionAvailability::FinalLevel => "No next level; final level completed",
    }
}

fn battlefield_live_summary(
    base_health: u16,
    wave: u8,
    status: SessionStatus,
    is_host: bool,
) -> String {
    let progress = format!("Core health {base_health}. Wave {wave}.");
    match status {
        SessionStatus::Victory if is_host => format!(
            "{progress} Feed defended. Every wave cleared. Victory controls are shown below."
        ),
        SessionStatus::Victory => format!(
            "{progress} Feed defended. Every wave cleared. Waiting for the host to choose the next action."
        ),
        SessionStatus::Defeat if is_host => {
            format!("{progress} Signal lost. Restart level is available.")
        }
        SessionStatus::Defeat => {
            format!("{progress} Signal lost. Waiting for the host to restart the level.")
        }
        SessionStatus::Paused => format!("{progress} The simulation is paused."),
        _ => progress,
    }
}

fn monotonic_now() -> f64 {
    web_sys::window()
        .and_then(|window| window.performance())
        .map_or_else(js_sys::Date::now, |performance| performance.now())
}

fn record_presentation_transition(
    app: &App,
    previous: &SessionSnapshot,
    current: &SessionSnapshot,
) {
    let is_active = app
        .active
        .borrow()
        .and_then(|index| app.sessions.borrow().get(index).cloned())
        .is_some_and(|snapshot| snapshot.session_id == current.session_id);
    let tick_span = current.tick.saturating_sub(previous.tick);
    if !is_active
        || current.status != SessionStatus::Running
        || previous.session_id != current.session_id
        || previous.level != current.level
        || tick_span == 0
    {
        if is_active {
            app.presentation.borrow_mut().take();
        }
        return;
    }
    let bounded_tick_span = tick_span.min(10);
    *app.presentation.borrow_mut() = Some(PresentationFrame {
        session_id: current.session_id.clone(),
        previous: previous.clone(),
        current_tick: current.tick,
        started_ms: monotonic_now(),
        duration_ms: bounded_tick_span as f64 * SIMULATION_STEP_MS,
    });
}

fn draw_canvas_frame(
    app: &App,
    canvas: &HtmlCanvasElement,
    snapshot: &SessionSnapshot,
    now_ms: f64,
) -> Result<(), JsValue> {
    let renderer = Renderer::new(canvas.clone())?;
    let presentation = app.presentation.borrow();
    if let Some(frame) = presentation.as_ref().filter(|frame| {
        frame.session_id == snapshot.session_id
            && frame.current_tick == snapshot.tick
            && snapshot.status == SessionStatus::Running
    }) {
        renderer.draw_interpolated(snapshot, Some(&frame.previous), frame.alpha(now_ms));
    } else {
        renderer.draw(snapshot);
    }
    draw_presence_cursors(app, canvas, &snapshot.session_id);
    Ok(())
}

fn render_animation_frame(app: &Rc<App>, now_ms: f64) -> Result<(), JsValue> {
    if PHASE.with(|phase| *phase.borrow() != "active") || !*app.authority.borrow() {
        return Ok(());
    }
    let Some(index) = *app.active.borrow() else {
        return Ok(());
    };
    let Some(snapshot) = app.sessions.borrow().get(index).cloned() else {
        return Ok(());
    };
    if snapshot.status != SessionStatus::Running {
        return Ok(());
    }
    let Some(canvas) = app
        .document
        .get_element_by_id("btd-game-canvas")
        .and_then(|element| element.dyn_into::<HtmlCanvasElement>().ok())
    else {
        return Ok(());
    };
    draw_canvas_frame(app, &canvas, &snapshot, now_ms)
}

fn request_next_animation_frame(app: &Rc<App>) -> Result<(), JsValue> {
    let animation = app.animation.borrow();
    let Some(animation) = animation.as_ref() else {
        return Ok(());
    };
    let id = web_sys::window()
        .ok_or_else(|| JsValue::from_str("window unavailable"))?
        .request_animation_frame(animation.as_ref().unchecked_ref())?;
    *app.animation_frame_id.borrow_mut() = Some(id);
    Ok(())
}

fn install_animation_loop(app: &Rc<App>) -> Result<(), JsValue> {
    let weak = Rc::downgrade(app);
    let animation = Closure::<dyn FnMut(f64)>::new(move |_timestamp| {
        let Some(app) = weak.upgrade() else {
            return;
        };
        let _ = render_animation_frame(&app, monotonic_now());
        let _ = request_next_animation_frame(&app);
    });
    *app.animation.borrow_mut() = Some(animation);
    request_next_animation_frame(app)
}

fn stop_animation_loop(app: &App) {
    if let Some(id) = app.animation_frame_id.borrow_mut().take()
        && let Some(window) = web_sys::window()
    {
        let _ = window.cancel_animation_frame(id);
    }
    app.animation.borrow_mut().take();
}

fn stop_simulation_timer(app: &App) {
    if let Some(id) = app.timer_id.borrow_mut().take()
        && let Some(window) = web_sys::window()
    {
        window.clear_interval_with_handle(id);
    }
    app.timer.borrow_mut().take();
}

fn pause_simulation_clock(app: &App) {
    app.simulation_clock.borrow_mut().reset();
    app.presentation.borrow_mut().take();
}

fn resume_simulation_clock(app: &App) {
    app.simulation_clock.borrow_mut().restart(monotonic_now());
    app.presentation.borrow_mut().take();
}

fn member_can_manage_defenders(member: Option<&Member>) -> bool {
    member.is_some_and(|member| {
        member.slot.is_some() && matches!(member.role, MemberRole::Host | MemberRole::Player)
    })
}

fn live_economy_state(app: &App, snapshot: &SessionSnapshot) -> LiveEconomyState {
    let member = snapshot
        .members
        .iter()
        .find(|member| member.player_id == app.player);
    let active_players = usize::from(snapshot.scale_players).clamp(1, 4);
    let open_pads = scaled_build_pads(snapshot.level, active_players)
        .iter()
        .filter(|pad| {
            !snapshot
                .defenders
                .iter()
                .any(|defender| defender.x == pad.x && defender.y == pad.y)
        })
        .count();
    LiveEconomyState {
        resources: member.map_or(0, |member| member.resources),
        open_pads,
        has_player_slot: member_can_manage_defenders(member),
        status: snapshot.status,
        has_authority: defender_authority_available(app),
        authoritative_command_pending: !app.awaiting_commands.borrow().is_empty(),
    }
}

fn defender_shop_presentation(
    definition: &Defender,
    selected: bool,
    unlocked: bool,
    collapsed: bool,
    economy: LiveEconomyState,
) -> DefenderShopPresentation {
    let state = economy.defender_state(selected, unlocked, definition.cost);
    DefenderShopPresentation {
        state,
        selected,
        disabled: collapsed
            || !matches!(
                state,
                DefenderShopState::Ready | DefenderShopState::Selected
            ),
        description: format!(
            "{}, {}, costs {} resources. {}.",
            definition.name,
            definition.role,
            definition.cost,
            state.label()
        ),
    }
}

fn sync_defender_shop_button(
    button: &Element,
    presentation: &DefenderShopPresentation,
) -> Result<(), JsValue> {
    button.set_class_name(if presentation.selected {
        "defender-shop-button is-selected"
    } else {
        "defender-shop-button"
    });
    button.set_attribute("data-state", presentation.state.data_value())?;
    button.set_attribute(
        "aria-pressed",
        if presentation.selected {
            "true"
        } else {
            "false"
        },
    )?;
    button.set_attribute("aria-label", &presentation.description)?;
    button.set_attribute("title", &presentation.description)?;
    if presentation.disabled {
        button.set_attribute("disabled", "")?;
        button.set_attribute("aria-disabled", "true")?;
    } else {
        button.remove_attribute("disabled")?;
        button.remove_attribute("aria-disabled")?;
    }
    Ok(())
}

fn update_live_defender_shop_controls(
    app: &Rc<App>,
    snapshot: &SessionSnapshot,
    economy: LiveEconomyState,
) -> Result<(), JsValue> {
    if app.document.query_selector(".defender-dock")?.is_none() {
        return Ok(());
    }
    let available_defenders = levels()
        .into_iter()
        .find(|level| level.id == snapshot.level)
        .ok_or_else(|| JsValue::from_str("level unavailable"))?
        .available_defenders;
    let placement = app.placement.borrow().clone();
    let collapsed = placement.is_some();
    for definition in defenders()
        .into_iter()
        .filter(|definition| available_defenders.contains(&definition.id))
    {
        let Some(button) = app
            .document
            .get_element_by_id(&format!("btd-shop-{}", definition.id))
        else {
            continue;
        };
        let unlocked = app
            .progress
            .borrow()
            .unlocked_defenders
            .iter()
            .any(|id| id == definition.id);
        let selected = matches!(
            placement.as_ref(),
            Some(PlacementMode::New(kind)) if kind == definition.id
        );
        let presentation =
            defender_shop_presentation(&definition, selected, unlocked, collapsed, economy);
        sync_defender_shop_button(&button, &presentation)?;
    }
    Ok(())
}

fn render_live(app: &Rc<App>) -> Result<(), JsValue> {
    let Some(index) = *app.active.borrow() else {
        return Ok(());
    };
    let Some(snapshot) = app.sessions.borrow().get(index).cloned() else {
        return Ok(());
    };
    let economy = live_economy_state(app, &snapshot);
    set_text_by_id(
        app,
        "btd-base-health",
        format!("♥ {}", snapshot.base_health),
    );
    set_text_by_id(app, "btd-wave", format!("Wave {}", snapshot.wave));
    set_text_by_id(app, "btd-score", format!("Score {}", snapshot.score));
    set_text_by_id(app, "btd-resources", format!("◈ {}", economy.resources));
    update_live_defender_shop_controls(app, &snapshot, economy)?;
    update_live_upgrade_controls(app, &snapshot, economy)?;
    set_text_by_id_if_changed(
        app,
        "btd-live-summary",
        battlefield_live_summary(
            snapshot.base_health,
            snapshot.wave,
            snapshot.status,
            snapshot.host == app.player,
        ),
    );
    if let Some(canvas) = app
        .document
        .get_element_by_id("btd-game-canvas")
        .and_then(|element| element.dyn_into::<HtmlCanvasElement>().ok())
    {
        draw_canvas_frame(app, &canvas, &snapshot, monotonic_now())?;
    }
    update_presence_dom(app);
    update_save_status(app);
    Ok(())
}

fn update_live_upgrade_controls(
    app: &Rc<App>,
    snapshot: &SessionSnapshot,
    economy: LiveEconomyState,
) -> Result<(), JsValue> {
    let Some(selected_id) = app.inspected_defender.borrow().clone() else {
        return Ok(());
    };
    let Some(defender) = snapshot
        .defenders
        .iter()
        .find(|defender| defender.id == selected_id && defender.owner == app.player)
    else {
        return Ok(());
    };
    let Some(definition) = defenders()
        .into_iter()
        .find(|candidate| candidate.id == defender.kind)
    else {
        return Ok(());
    };
    for (path_index, path) in definition.upgrade_paths.into_iter().enumerate() {
        let branch_state = upgrade_branch_state(defender.level, &defender.path, path);
        if !branch_state.can_purchase() {
            continue;
        }
        let Some(next_tier) = next_upgrade_tier(definition.id, path, defender.level) else {
            continue;
        };
        let Some(upgrade) = app
            .document
            .get_element_by_id(&format!("btd-upgrade-{path_index}-button"))
        else {
            continue;
        };
        let Some(reason_element) = app
            .document
            .get_element_by_id(&format!("btd-upgrade-{path_index}-reason"))
        else {
            continue;
        };
        let effect_id = format!("btd-upgrade-{path_index}-effect");
        if let Some(reason) = upgrade_disabled_reason(
            branch_state,
            snapshot.status,
            economy.has_player_slot,
            economy.has_authority,
            economy.authoritative_command_pending,
            economy.resources,
            next_tier.cost,
        ) {
            upgrade.set_attribute("disabled", "")?;
            upgrade.set_attribute("aria-disabled", "true")?;
            upgrade.set_attribute("title", &reason)?;
            upgrade.set_attribute(
                "aria-describedby",
                &format!("{effect_id} btd-upgrade-{path_index}-reason"),
            )?;
            reason_element.remove_attribute("hidden")?;
            reason_element.set_text_content(Some(&reason));
        } else {
            upgrade.remove_attribute("disabled")?;
            upgrade.remove_attribute("aria-disabled")?;
            upgrade.set_attribute("title", next_tier.effect)?;
            upgrade.set_attribute("aria-describedby", &effect_id)?;
            reason_element.set_attribute("hidden", "")?;
            reason_element.set_text_content(Some(""));
        }
    }
    Ok(())
}

fn update_save_status(app: &App) {
    let Some(status) = app.document.get_element_by_id("btd-save-status") else {
        return;
    };
    let (label, class_name) = if *app.loading.borrow() {
        ("Loading…", "badge status busy")
    } else if *app.saving.borrow() {
        ("Saving…", "badge status busy")
    } else if has_pending_saves(app) {
        ("Changes pending", "badge warning")
    } else if app.error.borrow().is_some() {
        ("Save unavailable", "badge error-badge")
    } else {
        ("Saved", "badge subtle")
    };
    status.set_text_content(Some(label));
    status.set_class_name(class_name);
}

fn update_audio_levels(app: &App) {
    let audio = app.audio.borrow();
    let Some(engine) = audio.as_ref() else {
        return;
    };
    engine.master.gain().set_value(if *app.muted.borrow() {
        0.0
    } else {
        f32::from(*app.master.borrow()) / 100.0
    });
    engine
        .music
        .gain()
        .set_value(f32::from(*app.music.borrow()) / 100.0);
    engine
        .effects
        .gain()
        .set_value(f32::from(*app.effects.borrow()) / 100.0);
}

fn enable_audio(app: &Rc<App>) -> Result<(), JsValue> {
    *app.muted.borrow_mut() = false;
    if let Some(engine) = app.audio.borrow().as_ref() {
        let _ = engine.context.resume();
        return Ok(());
    }
    let context = AudioContext::new()?;
    let master = context.create_gain()?;
    let music = context.create_gain()?;
    let effects = context.create_gain()?;
    music.connect_with_audio_node(&master)?;
    effects.connect_with_audio_node(&master)?;
    master.connect_with_audio_node(&context.destination())?;
    *app.audio.borrow_mut() = Some(AudioEngine {
        context,
        master,
        music,
        effects,
    });
    update_audio_levels(app);
    play_tone(app, 392.0, 0.12, false);
    Ok(())
}

fn disable_audio(app: &App) {
    *app.muted.borrow_mut() = true;
    close_audio(app);
}

fn close_audio(app: &App) {
    if let Some(engine) = app.audio.borrow_mut().take() {
        let _ = engine.context.close();
    }
}

fn suspend_audio(app: &App) {
    if let Some(engine) = app.audio.borrow().as_ref() {
        let _ = engine.context.suspend();
    }
}

fn resume_audio(app: &App) {
    if !*app.muted.borrow()
        && let Some(engine) = app.audio.borrow().as_ref()
    {
        let _ = engine.context.resume();
    }
}

fn current_presence_state(app: &App) -> GamePresenceState {
    let active = app.active.borrow().and_then(|index| {
        app.sessions
            .borrow()
            .get(index)
            .map(|session| (session.session_id.clone(), session.clone()))
    });
    let (game_id, activity, ready, recent_action) = active.map_or_else(
        || (None, "channel".to_string(), false, None),
        |(session_id, session)| {
            let member = session
                .members
                .iter()
                .find(|member| member.player_id == app.player);
            let activity = if member
                .is_some_and(|member| member.role == game_protocol::MemberRole::Disconnected)
            {
                "disconnected"
            } else if session.host == app.player {
                "hosting"
            } else if member.is_some_and(|member| member.slot.is_some()) {
                "playing"
            } else {
                "watching"
            };
            let recent_action = session
                .recent_actions
                .last()
                .map(|action| format!("{} {}", action.actor, action.label));
            (
                Some(session_id),
                activity.to_string(),
                member.is_some_and(|member| member.ready),
                recent_action,
            )
        },
    );
    let placement = app.placement.borrow().as_ref().map(|mode| match mode {
        PlacementMode::New(kind) => format!("placing:{kind}"),
        PlacementMode::Move(_) => "moving:defender".to_string(),
    });
    GamePresenceState {
        schema_version: 1,
        game_id,
        activity,
        ready,
        cursor: app.cursor.borrow().clone(),
        placement,
        recent_action,
    }
}

fn validate_presence(snapshot: &PresenceSnapshot<GamePresenceState>) -> Result<(), String> {
    if snapshot.participants.len() > 512 {
        return Err("presence participant limit exceeded".into());
    }
    for participant in &snapshot.participants {
        let state = &participant.state;
        if state.schema_version != 1
            || !matches!(
                state.activity.as_str(),
                "channel" | "hosting" | "playing" | "watching" | "disconnected"
            )
            || state
                .game_id
                .as_ref()
                .is_some_and(|game_id| game_id.0.trim().is_empty() || game_id.0.len() > 128)
            || state
                .placement
                .as_ref()
                .is_some_and(|placement| placement.len() > 80)
            || state.recent_action.as_ref().is_some_and(|action| {
                action.chars().count() > 160 || action.chars().any(char::is_control)
            })
            || state
                .cursor
                .as_ref()
                .is_some_and(|cursor| cursor.x > 1000 || cursor.y > 562)
        {
            return Err("presence state failed application validation".into());
        }
    }
    Ok(())
}

fn presence_color(participant_id: &str) -> &'static str {
    const COLORS: [&str; 6] = [
        "#67e8f9", "#f472b6", "#facc15", "#a78bfa", "#4ade80", "#fb923c",
    ];
    let hash = participant_id.bytes().fold(0_usize, |hash, byte| {
        hash.wrapping_mul(31).wrapping_add(usize::from(byte))
    });
    COLORS[hash % COLORS.len()]
}

fn draw_presence_cursors(app: &App, canvas: &HtmlCanvasElement, session_id: &SessionId) {
    let Some(snapshot) = app.presence.borrow().as_ref().cloned() else {
        return;
    };
    let Ok(Some(context)) = canvas.get_context("2d") else {
        return;
    };
    let Ok(context) = context.dyn_into::<CanvasRenderingContext2d>() else {
        return;
    };
    for participant in snapshot.participants.iter().filter(|participant| {
        participant.state.game_id.as_ref() == Some(session_id) && participant.state.cursor.is_some()
    }) {
        let Some(cursor) = participant.state.cursor.as_ref() else {
            continue;
        };
        let color = presence_color(&participant.participant_id);
        context.begin_path();
        context.set_fill_style_str(color);
        let _ = context.arc(
            f64::from(cursor.x),
            f64::from(cursor.y),
            7.0,
            0.0,
            std::f64::consts::TAU,
        );
        context.fill();
        context.set_font("600 13px system-ui, sans-serif");
        context.set_fill_style_str("#ffffff");
        context.set_shadow_color("rgba(0,0,0,.85)");
        context.set_shadow_blur(4.0);
        let _ = context.fill_text(
            &participant.display_name,
            f64::from(cursor.x) + 11.0,
            f64::from(cursor.y) - 9.0,
        );
        context.set_shadow_blur(0.0);
    }
}

fn update_presence_dom(app: &App) {
    let Some(container) = app.document.get_element_by_id("btd-live-presence") else {
        return;
    };
    container.set_inner_html("");
    let Some(snapshot) = app.presence.borrow().as_ref().cloned() else {
        container.set_text_content(Some("Presence unavailable"));
        return;
    };
    let active_id = app.active.borrow().and_then(|index| {
        app.sessions
            .borrow()
            .get(index)
            .map(|session| session.session_id.clone())
    });
    let participants: Vec<_> = snapshot
        .participants
        .iter()
        .filter(|participant| participant.state.game_id == active_id)
        .collect();
    if participants.is_empty() {
        container.set_text_content(Some("No live presence reported for this game."));
        return;
    }
    for participant in participants {
        let Ok(row) = app.document.create_element("div") else {
            return;
        };
        row.set_class_name("presence-row");
        let placement =
            participant
                .state
                .placement
                .as_deref()
                .map_or_else(String::new, |selection| {
                    selection.strip_prefix("placing:").map_or_else(
                        || " · moving a defender".into(),
                        |kind| format!(" · placing {}", kind.replace('_', " ")),
                    )
                });
        let recent = participant
            .state
            .recent_action
            .as_ref()
            .map_or_else(String::new, |action| format!(" · last: {action}"));
        row.set_text_content(Some(&format!(
            "● {} · {}{}{}",
            participant.display_name, participant.state.activity, placement, recent
        )));
        let _ = row.set_attribute(
            "style",
            &format!(
                "--presence-color:{}",
                presence_color(&participant.participant_id)
            ),
        );
        let _ = container.append_child(&row);
    }
}

fn accept_presence(
    app: &Weak<App>,
    result: Result<PresenceSnapshot<GamePresenceState>, tap_bridge::BridgeError>,
) {
    let Some(app) = app.upgrade() else {
        return;
    };
    match result {
        Ok(snapshot) => match validate_presence(&snapshot) {
            Ok(()) => {
                *app.presence.borrow_mut() = Some(snapshot);
                update_presence_dom(&app);
                let _ = render_live(&app);
            }
            Err(error) => {
                *app.error.borrow_mut() = Some(format!("Invalid TAP presence update: {error}"));
                let _ = render(&app);
            }
        },
        Err(error) => {
            *app.error.borrow_mut() = Some(format!("Could not receive TAP presence: {error}"));
            let _ = render(&app);
        }
    }
}

fn install_presence_subscription(app: &Rc<App>) -> Result<(), tap_bridge::BridgeError> {
    if app.presence_subscription.borrow().is_some() {
        return Ok(());
    }
    let weak = Rc::downgrade(app);
    let subscription =
        tap_bridge::subscribe_presence::<GamePresenceState, _>(&app.channel, move |result| {
            accept_presence(&weak, result)
        })?;
    *app.presence_subscription.borrow_mut() = Some(subscription);
    Ok(())
}

fn push_presence(app: Rc<App>) {
    if !matches!(app.runtime, Runtime::Tap) || !*app.authority.borrow() {
        return;
    }
    let channel = app.channel.clone();
    let state = current_presence_state(&app);
    spawn_local(async move {
        match tap_bridge::update_presence(&channel, &state).await {
            Ok(snapshot) => accept_presence(&Rc::downgrade(&app), Ok(snapshot)),
            Err(error) => accept_presence(&Rc::downgrade(&app), Err(error)),
        }
    });
}

fn play_tone(app: &App, frequency: f32, duration: f64, music: bool) {
    let audio = app.audio.borrow();
    let Some(engine) = audio.as_ref() else {
        return;
    };
    let Ok(oscillator) = engine.context.create_oscillator() else {
        return;
    };
    let Ok(envelope) = engine.context.create_gain() else {
        return;
    };
    oscillator.set_type(if music {
        OscillatorType::Triangle
    } else {
        OscillatorType::Sine
    });
    oscillator.frequency().set_value(frequency);
    let now = engine.context.current_time();
    let peak = if music { 0.12 } else { 0.24 };
    let _ = envelope.gain().set_value_at_time(0.0001, now);
    let _ = envelope
        .gain()
        .linear_ramp_to_value_at_time(peak, now + 0.018);
    let _ = envelope
        .gain()
        .exponential_ramp_to_value_at_time(0.0001, now + duration.max(0.04));
    if oscillator.connect_with_audio_node(&envelope).is_err() {
        return;
    }
    let destination = if music {
        &engine.music
    } else {
        &engine.effects
    };
    if envelope.connect_with_audio_node(destination).is_err() {
        return;
    }
    let _ = oscillator.start_with_when(now);
    let _ = oscillator.stop_with_when(now + duration.max(0.04) + 0.02);
}

fn play_command_cue(app: &App, kind: &CommandKind) {
    let (frequency, duration) = match kind {
        CommandKind::Join { .. } => (523.25, 0.14),
        CommandKind::Ready { ready: true } => (659.25, 0.11),
        CommandKind::Place { .. } => (440.0, 0.09),
        CommandKind::Upgrade { .. } => (783.99, 0.18),
        CommandKind::Sell { .. } => (293.66, 0.14),
        CommandKind::StartWave => (587.33, 0.24),
        CommandKind::Pause => (246.94, 0.16),
        CommandKind::Resume => (493.88, 0.14),
        _ => (349.23, 0.08),
    };
    play_tone(app, frequency, duration, false);
}

fn play_music_tick(app: &App, level: u8, tick: u64) {
    if !tick.is_multiple_of(20) {
        return;
    }
    let notes = match level {
        1 => [220.0, 277.18, 329.63, 277.18],
        2 => [246.94, 311.13, 369.99, 311.13],
        3 => [196.0, 246.94, 293.66, 369.99],
        4 => [174.61, 220.0, 261.63, 207.65],
        _ => [164.81, 246.94, 329.63, 392.0],
    };
    let index = usize::try_from((tick / 20) % 4).unwrap_or(0);
    play_tone(app, notes[index], 0.42, true);
}

fn play_snapshot_audio(app: &App, previous: &SessionSnapshot, next: &SessionSnapshot) {
    if next.tick / 20 > previous.tick / 20 {
        play_music_tick(app, next.level, (next.tick / 20) * 20);
    }
    if next.tick / 5 > previous.tick / 5 && !next.enemies.is_empty() && !next.defenders.is_empty() {
        play_tone(app, 698.46, 0.045, false);
    }
    if next.enemies.len() < previous.enemies.len() {
        play_tone(app, 880.0, 0.08, false);
    }
    if next.base_health < previous.base_health {
        play_tone(app, 130.81, 0.24, false);
    }
    let previous_resources = previous
        .members
        .iter()
        .find(|member| member.player_id == app.player)
        .map_or(0, |member| member.resources);
    let next_resources = next
        .members
        .iter()
        .find(|member| member.player_id == app.player)
        .map_or(0, |member| member.resources);
    if next_resources > previous_resources {
        play_tone(app, 987.77, 0.07, false);
    }
    if previous.status == SessionStatus::Running && next.status == SessionStatus::Victory {
        play_tone(app, 1046.5, 0.5, false);
    } else if previous.status == SessionStatus::Running && next.status == SessionStatus::Defeat {
        play_tone(app, 110.0, 0.6, false);
    }
    let own_action_was_already_cued = app
        .own_cued_sequences
        .borrow_mut()
        .remove(&next.last_sequence);
    if next.last_sequence != previous.last_sequence && !own_action_was_already_cued {
        if next.members.len() > previous.members.len() {
            play_tone(app, 523.25, 0.14, false);
        } else if next.members.iter().any(|member| {
            member.ready
                && previous
                    .members
                    .iter()
                    .find(|previous| previous.player_id == member.player_id)
                    .is_some_and(|previous| !previous.ready)
        }) {
            play_tone(app, 659.25, 0.11, false);
        } else if next.defenders.iter().any(|defender| {
            previous
                .defenders
                .iter()
                .find(|previous| previous.id == defender.id)
                .is_some_and(|previous| defender.level > previous.level)
        }) {
            play_tone(app, 783.99, 0.18, false);
        } else if next.wave > previous.wave {
            play_tone(app, 587.33, 0.24, false);
        }
    }
}

fn observed_wave_clear_bonus(previous: &SessionSnapshot, next: &SessionSnapshot) -> Option<String> {
    if previous.status != SessionStatus::Running
        || next.status != SessionStatus::BetweenWaves
        || previous.wave != next.wave
    {
        return None;
    }
    let mut eligible_players = 0_usize;
    let payout_is_proven = previous
        .members
        .iter()
        .filter(|member| member.slot.is_some())
        .all(|member| {
            eligible_players += 1;
            next.members
                .iter()
                .find(|next_member| next_member.player_id == member.player_id)
                .is_some_and(|next_member| {
                    next_member.resources >= member.resources.saturating_add(WAVE_CLEAR_BONUS)
                })
        });
    (eligible_players > 0 && payout_is_proven).then(|| {
        format!(
            "Wave {} cleared · ◈{} non-final-wave bonus paid to each player.",
            next.wave, WAVE_CLEAR_BONUS
        )
    })
}

fn document() -> Result<Document, JsValue> {
    web_sys::window()
        .and_then(|w| w.document())
        .ok_or_else(|| JsValue::from_str("document unavailable"))
}

const STYLE_ELEMENT_ID: &str = "brainrot-td-styles";
const UPGRADE_STYLE_ELEMENT_ID: &str = "brainrot-td-upgrade-styles";
const EMBEDDED_STYLES: &str = include_str!("../../../assets/styles.css");
const UPGRADE_INSPECTOR_STYLES: &str = r#"
.defender-inspector-upgrades { display: block; }
.upgrade-branch-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  min-width: 0;
}
.upgrade-branch-card {
  min-width: 0;
  display: grid;
  align-content: start;
  gap: 6px;
  border: 1px solid #ffffff24;
  border-radius: 10px;
  padding: 8px;
  background: #101d2de8;
}
.upgrade-branch-card[data-state="committed"] { border-color: #75efd199; background: #12332ee8; }
.upgrade-branch-card[data-state="locked"] { border-color: #ffffff18; background: #0b1522e8; color: #aab6c5; }
.upgrade-branch-card[data-state="maxed"] { border-color: #ffe08299; background: #2c2719e8; }
.upgrade-branch-heading {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
}
.upgrade-branch-name { margin: 0; color: #f7fbff; font-size: 12px; line-height: 1.2; overflow-wrap: anywhere; }
.upgrade-branch-state {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 2px 5px;
  background: #ffffff17;
  color: #dbe7f5;
  font-size: 8px;
  font-weight: 900;
  letter-spacing: .035em;
  line-height: 1.25;
  text-transform: uppercase;
}
.upgrade-branch-card[data-state="committed"] .upgrade-branch-state { background: #3de0b82b; color: #9ff5df; }
.upgrade-branch-card[data-state="maxed"] .upgrade-branch-state { background: #ffe08225; color: #ffe082; }
.upgrade-branch-description { margin: 0; color: #aebdce; font-size: 9px; line-height: 1.3; }
.upgrade-tier-progress { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 3px; }
.upgrade-tier-segment { height: 5px; border-radius: 999px; background: #ffffff1c; }
.upgrade-tier-segment.is-complete { background: #5ee3c2; box-shadow: 0 0 7px #5ee3c266; }
.upgrade-next-tier { min-width: 0; display: grid; gap: 3px; }
.upgrade-next-name { margin: 0; color: #f7fbff; font-size: 11px; font-weight: 850; line-height: 1.2; overflow-wrap: anywhere; }
.upgrade-next-effect { margin: 0; color: #bdcbda; font-size: 9px; line-height: 1.3; overflow-wrap: anywhere; }
.upgrade-next-meta { color: #ffe082; font-size: 9px; font-weight: 800; }
.defender-inspector .upgrade-purchase { width: 100%; min-height: 38px; padding: 5px 7px; font-size: 10px; }
.upgrade-disabled-reason,
.upgrade-locked-message,
.upgrade-max-message { margin: 0; font-size: 9px; font-weight: 750; line-height: 1.25; overflow-wrap: anywhere; }
.upgrade-disabled-reason { color: #ff9bad; }
.upgrade-locked-message { color: #aab6c5; }
.upgrade-max-message { color: #ffe082; }

@media (max-width: 680px) {
  .game-stage:has(.game-hud.has-inspector) { height: calc(56.2vw + 356px); }
  .game-stage:has(.hud-menu[open]):has(.game-hud.has-inspector) { height: calc(56.2vw + 530px); }
  .defender-inspector { height: 242px; }
  .defender-inspector-body {
    grid-template-rows: 44px minmax(0, 1fr);
    overflow: hidden;
  }
  .defender-inspector-upgrades { min-height: 0; overflow: auto; overscroll-behavior: contain; }
  .upgrade-branch-grid { gap: 5px; }
  .upgrade-branch-card { gap: 3px; padding: 5px; border-radius: 8px; }
  .upgrade-branch-description { display: none; }
  .upgrade-next-effect {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
  .defender-inspector .upgrade-purchase { min-height: 44px; white-space: normal; }
}
"#;

#[cfg(test)]
fn embedded_styles_are_current(current: Option<&str>) -> bool {
    current == Some(EMBEDDED_STYLES)
}

fn install_style_element(document: &Document, id: &str, styles: &str) -> Result<(), JsValue> {
    if let Some(existing) = document.get_element_by_id(id) {
        if existing.tag_name().eq_ignore_ascii_case("style") {
            let current = existing.text_content();
            if current.as_deref() != Some(styles) {
                // TAP can remount a newly loaded federated surface into a document that still
                // contains CSS from the previous release. Refreshing the existing node keeps new
                // in-canvas controls visible without disturbing another mounted app instance.
                existing.set_text_content(Some(styles));
            }
            return Ok(());
        }

        let replacement = document.create_element("style")?;
        replacement.set_id(id);
        replacement.set_text_content(Some(styles));
        if let Some(parent) = existing.parent_node() {
            parent.replace_child(&replacement, &existing)?;
            return Ok(());
        }
    }

    let style = document.create_element("style")?;
    style.set_id(id);
    style.set_text_content(Some(styles));
    document
        .document_element()
        .ok_or_else(|| JsValue::from_str("document root unavailable"))?
        .append_child(&style)?;
    Ok(())
}

fn install_styles(document: &Document) -> Result<(), JsValue> {
    install_style_element(document, STYLE_ELEMENT_ID, EMBEDDED_STYLES)?;
    install_style_element(document, UPGRADE_STYLE_ELEMENT_ID, UPGRADE_INSPECTOR_STYLES)
}
trait AppendElement {
    fn append_text(&self, child: Element) -> Result<Node, JsValue>;
}
impl AppendElement for Element {
    fn append_text(&self, child: Element) -> Result<Node, JsValue> {
        self.append_child(&child)
    }
}
fn text(document: &Document, tag: &str, value: &str, class: &str) -> Result<Element, JsValue> {
    let e = document.create_element(tag)?;
    e.set_class_name(class);
    e.set_text_content(Some(value));
    Ok(e)
}
fn button(document: &Document, label: &str, class: &str) -> Result<Element, JsValue> {
    let e = text(document, "button", label, class)?;
    e.set_attribute("type", "button")?;
    Ok(e)
}

fn icon_button(
    document: &Document,
    glyph: &str,
    accessible_label: &str,
    class: &str,
) -> Result<Element, JsValue> {
    let control = button(document, "", class)?;
    control.set_attribute("aria-label", accessible_label)?;
    control.set_attribute("title", accessible_label)?;
    let icon = text(document, "span", glyph, "victory-action-glyph")?;
    icon.set_attribute("aria-hidden", "true")?;
    control.append_child(&icon)?;
    Ok(control)
}

const fn defender_sprite_index(kind: &str) -> Option<u8> {
    match kind.as_bytes() {
        b"zip_zapper" => Some(0),
        b"caps_lock" => Some(1),
        b"buffer_buddy" => Some(2),
        b"side_hustler" => Some(3),
        b"final_form" => Some(4),
        b"deep_scroller" => Some(5),
        _ => None,
    }
}

fn defender_sprite_style(kind: &str) -> Option<String> {
    let index = defender_sprite_index(kind)?;
    DEFENDER_SPRITE_URL.with(|slot| {
        slot.borrow().as_ref().map(|url| {
            let safe_url = url
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
                .replace(['\n', '\r'], "");
            format!(
                "--defender-sprite:url(\"{safe_url}\");--sprite-x:{}%;--sprite-y:{}%",
                (index % 3) * 50,
                (index / 3) * 100
            )
        })
    })
}

fn defender_icon(document: &Document, kind: &str, class: &str) -> Result<Element, JsValue> {
    let icon = document.create_element("span")?;
    icon.set_class_name(class);
    icon.set_attribute("aria-hidden", "true")?;
    if let Some(style) = defender_sprite_style(kind) {
        icon.set_attribute("style", &style)?;
    }
    Ok(icon)
}

fn logical_position_percent(x: u16, y: u16) -> (f64, f64) {
    (f64::from(x) / 10., f64::from(y) * 100. / 562.)
}

fn battlefield_aria_label(level_id: u8, placement: bool) -> String {
    let level_name = levels()
        .into_iter()
        .find(|level| level.id == level_id)
        .map(|level| level.name)
        .unwrap_or("Unknown level");
    if placement {
        return format!("{level_name} battlefield placement map. Select an open stone pedestal.");
    }
    if level_id == 1 {
        return "Live Backyard Wi-Fi battlefield. Enemies follow the gravel path from the lower-left mailbox to the upper-right garden shed.".into();
    }
    if level_id == 2 {
        return "Live School Hallway Rush battlefield. Enemies enter from the two left corridors, merge at the east junction, and finish inside the illuminated server room.".into();
    }
    format!(
        "Live {level_name} battlefield. Enemies follow the marked paths toward the defended core."
    )
}

fn on(
    app: &Rc<App>,
    element: &Element,
    event: &str,
    mut action: impl FnMut() + 'static,
) -> Result<(), JsValue> {
    let closure = Closure::<dyn FnMut(Event)>::new(move |_| action());
    element.add_event_listener_with_callback(event, closure.as_ref().unchecked_ref())?;
    app.closures.borrow_mut().push(closure);
    Ok(())
}

fn on_event(
    app: &Rc<App>,
    element: &Element,
    event: &str,
    action: impl FnMut(Event) + 'static,
) -> Result<(), JsValue> {
    let closure = Closure::<dyn FnMut(Event)>::new(action);
    element.add_event_listener_with_callback(event, closure.as_ref().unchecked_ref())?;
    app.closures.borrow_mut().push(closure);
    Ok(())
}
fn preview_storage() -> Option<Storage> {
    web_sys::window()?.local_storage().ok().flatten()
}
fn default_progress(player: PlayerId) -> Progress {
    Progress {
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
    }
}

fn prepare_loaded_snapshot(
    mut snapshot: SessionSnapshot,
    expected_channel: &str,
) -> Result<(SessionSnapshot, bool), game_core::ValidationError> {
    let migrated = game_core::migrate_snapshot_content(&mut snapshot);
    game_core::validate_snapshot(&snapshot, expected_channel)?;
    Ok((snapshot, migrated))
}

fn migrated_snapshot_needs_host_persistence(
    snapshot: &SessionSnapshot,
    local_player: &PlayerId,
    migrated: bool,
) -> bool {
    migrated && snapshot.host == *local_player
}

fn load_preview() -> Result<Option<PreviewSave>, String> {
    let Some(storage) = preview_storage() else {
        return Err("browser preview storage is unavailable".into());
    };
    let Some(raw) = storage
        .get_item(PREVIEW_KEY)
        .map_err(|error| format!("could not read browser preview storage: {error:?}"))?
    else {
        return Ok(None);
    };
    let mut value: PreviewSave = serde_json::from_str(&raw)
        .map_err(|error| format!("saved browser preview is not valid JSON: {error}"))?;
    let mut migrated = false;
    for session in &mut value.sessions {
        migrated |= game_core::migrate_snapshot_content(session);
    }
    let session_ids: HashSet<_> = value
        .sessions
        .iter()
        .map(|session| session.session_id.0.as_str())
        .collect();
    if value.schema_version != 1
        || value.player_id.0.trim().is_empty()
        || value.display_name.chars().count() > 40
        || (!value.display_name.is_empty()
            && normalize_display_name(&value.display_name) != value.display_name)
        || value.master > 100
        || value.music > 100
        || value.effects > 100
        || value.sessions.len() > 64
        || session_ids.len() != value.sessions.len()
        || value.progress.player_id != value.player_id
        || game_core::validate_progress(&value.progress, &value.player_id).is_err()
        || value
            .sessions
            .iter()
            .any(|session| game_core::validate_snapshot(session, "preview-channel").is_err())
    {
        return Err(
            "saved browser preview failed schema, scope, identity, or bounds validation".into(),
        );
    }
    if migrated {
        let migrated_raw = serde_json::to_string(&value)
            .map_err(|error| format!("could not serialize migrated browser preview: {error}"))?;
        storage
            .set_item(PREVIEW_KEY, &migrated_raw)
            .map_err(|error| format!("could not persist migrated browser preview: {error:?}"))?;
    }
    Ok(Some(value))
}
fn save_preview(app: &App) -> Result<(), String> {
    let value = PreviewSave {
        schema_version: 1,
        player_id: app.player.clone(),
        display_name: app.display_name.borrow().clone(),
        progress: app.progress.borrow().clone(),
        sessions: app.sessions.borrow().clone(),
        master: *app.master.borrow(),
        music: *app.music.borrow(),
        effects: *app.effects.borrow(),
        muted: *app.muted.borrow(),
    };
    let raw = serde_json::to_string(&value).map_err(|e| e.to_string())?;
    preview_storage()
        .ok_or_else(|| "browser preview storage is unavailable".to_string())?
        .set_item(PREVIEW_KEY, &raw)
        .map_err(|e| format!("{e:?}"))
}
#[derive(Clone, Copy)]
enum SaveScope {
    IndexAndActive,
    Progress,
    Settings,
    All,
}

fn has_pending_saves(app: &App) -> bool {
    !app.pending_sessions.borrow().is_empty()
        || *app.pending_index.borrow()
        || *app.pending_progress.borrow()
        || *app.pending_settings.borrow()
}

fn request_save(app: Rc<App>, scope: SaveScope) {
    if matches!(app.runtime, Runtime::Preview) {
        if let Err(error) = save_preview(&app) {
            *app.error.borrow_mut() = Some(error);
            let _ = render(&app);
        }
        return;
    }
    if !*app.authority.borrow() {
        *app.error.borrow_mut() =
            Some("TAP host authority is unavailable; no changes were saved.".into());
        let _ = render(&app);
        return;
    }
    if matches!(scope, SaveScope::IndexAndActive | SaveScope::All)
        && let Some(index) = *app.active.borrow()
        && let Some(session) = app.sessions.borrow().get(index)
    {
        app.pending_sessions
            .borrow_mut()
            .insert(session.session_id.0.clone());
    }
    if matches!(scope, SaveScope::IndexAndActive | SaveScope::All) {
        *app.pending_index.borrow_mut() = true;
    }
    if matches!(scope, SaveScope::Progress | SaveScope::All) {
        *app.pending_progress.borrow_mut() = true;
    }
    if matches!(scope, SaveScope::Settings | SaveScope::All) {
        *app.pending_settings.borrow_mut() = true;
    }
    flush_saves(app);
}

fn merge_progress(target: &mut Progress, incoming: &Progress) {
    let target_coop_floor = target
        .cooperative_completions
        .saturating_sub(u32::try_from(target.completed_cooperative_runs.len()).unwrap_or(u32::MAX));
    let incoming_coop_floor = incoming.cooperative_completions.saturating_sub(
        u32::try_from(incoming.completed_cooperative_runs.len()).unwrap_or(u32::MAX),
    );
    target.unlocked_level = target.unlocked_level.max(incoming.unlocked_level);
    for index in 0..target.best_stars.len() {
        target.best_stars[index] = target.best_stars[index].max(incoming.best_stars[index]);
        target.best_scores[index] = target.best_scores[index].max(incoming.best_scores[index]);
    }
    for defender in &incoming.unlocked_defenders {
        if !target.unlocked_defenders.contains(defender) {
            target.unlocked_defenders.push(defender.clone());
        }
    }
    for session in &incoming.completed_sessions {
        if !target.completed_sessions.contains(session) {
            target.completed_sessions.push(session.clone());
        }
    }
    for session in &incoming.completed_cooperative_runs {
        if !target.completed_cooperative_runs.contains(session) {
            target.completed_cooperative_runs.push(session.clone());
        }
    }
    for incoming_cursor in &incoming.completion_cursors {
        if let Some(target_cursor) = target
            .completion_cursors
            .iter_mut()
            .find(|cursor| cursor.session_id == incoming_cursor.session_id)
        {
            target_cursor.attempt = target_cursor.attempt.max(incoming_cursor.attempt);
        } else {
            target.completion_cursors.push(incoming_cursor.clone());
        }
    }
    if target.completed_sessions.len() > 256 {
        let remove = target.completed_sessions.len() - 256;
        target.completed_sessions.drain(..remove);
    }
    target
        .completed_cooperative_runs
        .retain(|run_id| target.completed_sessions.contains(run_id));
    if target.completed_cooperative_runs.len() > 256 {
        let remove = target.completed_cooperative_runs.len() - 256;
        target.completed_cooperative_runs.drain(..remove);
    }
    if target.completion_cursors.len() > 256 {
        let remove = target.completion_cursors.len() - 256;
        target.completion_cursors.drain(..remove);
    }
    target.cooperative_completions = target_coop_floor
        .max(incoming_coop_floor)
        .saturating_add(u32::try_from(target.completed_cooperative_runs.len()).unwrap_or(u32::MAX));
}

fn validate_channel_index(index: &ChannelIndex) -> Result<(), tap_bridge::BridgeError> {
    let unique: HashSet<_> = index
        .session_ids
        .iter()
        .map(|session| session.0.as_str())
        .collect();
    if index.schema_version != 1
        || index.session_ids.len() > 64
        || unique.len() != index.session_ids.len()
        || unique
            .iter()
            .any(|session| session.trim().is_empty() || session.len() > 128)
    {
        return Err(tap_bridge::BridgeError::Invalid(
            "invalid channel game index".into(),
        ));
    }
    Ok(())
}

fn merge_channel_indexes(
    remote: ChannelIndex,
    candidate: &ChannelIndex,
    desired_ids: &HashSet<String>,
    locally_known: &HashSet<String>,
) -> Result<ChannelIndex, tap_bridge::BridgeError> {
    validate_channel_index(&remote)?;
    let mut merged = Vec::new();
    let mut seen = HashSet::new();
    for session in remote.session_ids {
        let keep_remote = !locally_known.contains(&session.0) || desired_ids.contains(&session.0);
        if keep_remote && seen.insert(session.0.clone()) {
            merged.push(session);
        }
    }
    for session in &candidate.session_ids {
        if seen.insert(session.0.clone()) {
            merged.push(session.clone());
        }
    }
    if merged.len() > 64 {
        return Err(tap_bridge::BridgeError::Invalid(
            "channel reached its 64-game limit during a concurrent create; leave an old game and retry"
                .into(),
        ));
    }
    Ok(ChannelIndex {
        schema_version: 1,
        session_ids: merged,
    })
}

async fn save_channel_index_merged(
    channel: &str,
    desired: ChannelIndex,
    locally_known: &HashSet<String>,
    revision: Option<u64>,
) -> Result<(u64, ChannelIndex), tap_bridge::BridgeError> {
    validate_channel_index(&desired)?;
    let desired_ids: HashSet<_> = desired
        .session_ids
        .iter()
        .map(|session| session.0.clone())
        .collect();
    let mut candidate = desired;
    let mut expected_revision = revision;
    for _ in 0..6 {
        match tap_bridge::save_channel_index(&Runtime::Tap, channel, &candidate, expected_revision)
            .await
        {
            Ok(next) => return Ok((next, candidate)),
            Err(tap_bridge::BridgeError::Conflict) => {
                let stored = tap_bridge::load_channel_index(&Runtime::Tap, channel).await?;
                let remote = stored.value.unwrap_or(ChannelIndex {
                    schema_version: 1,
                    session_ids: vec![],
                });
                candidate = merge_channel_indexes(remote, &candidate, &desired_ids, locally_known)?;
                expected_revision = stored.revision;
            }
            Err(error) => return Err(error),
        }
    }
    Err(tap_bridge::BridgeError::Conflict)
}

fn flush_saves(app: Rc<App>) {
    if *app.saving.borrow() || !has_pending_saves(&app) {
        return;
    }
    *app.saving.borrow_mut() = true;
    let session_ids = std::mem::take(&mut *app.pending_sessions.borrow_mut());
    let save_index = std::mem::take(&mut *app.pending_index.borrow_mut());
    let save_progress = std::mem::take(&mut *app.pending_progress.borrow_mut());
    let save_settings = std::mem::take(&mut *app.pending_settings.borrow_mut());
    let sessions: Vec<_> = app
        .sessions
        .borrow()
        .iter()
        .filter(|session| session_ids.contains(&session.session_id.0))
        .cloned()
        .collect();
    let channel = app.channel.clone();
    let mut index_ids: Vec<_> = app
        .sessions
        .borrow()
        .iter()
        .filter(|session| session.status != SessionStatus::Abandoned)
        .map(|session| session.session_id.clone())
        .collect();
    if index_ids.len() > 64 {
        index_ids.drain(..index_ids.len() - 64);
    }
    let index = ChannelIndex {
        schema_version: 1,
        session_ids: index_ids,
    };
    let index_revision = *app.index_revision.borrow();
    let locally_known: HashSet<_> = app
        .sessions
        .borrow()
        .iter()
        .map(|session| session.session_id.0.clone())
        .collect();
    let player = app.player.0.clone();
    let progress = app.progress.borrow().clone();
    let progress_revision = *app.progress_revision.borrow();
    let settings = AudioSettings {
        schema_version: 1,
        player_id: app.player.clone(),
        master: *app.master.borrow(),
        music: *app.music.borrow(),
        effects: *app.effects.borrow(),
        muted: *app.muted.borrow(),
    };
    let settings_revision = *app.settings_revision.borrow();
    update_save_status(&app);
    spawn_local(async move {
        let mut failures = Vec::new();
        let mut persisted_event_sessions = Vec::new();
        let mut reload_index = false;
        let mut session_write_failed = false;
        for session in sessions {
            let revision = app
                .session_revisions
                .borrow()
                .get(&session.session_id.0)
                .copied();
            match tap_bridge::save_session(&Runtime::Tap, &channel, &session, revision).await {
                Ok(next) => {
                    app.session_revisions
                        .borrow_mut()
                        .insert(session.session_id.0.clone(), next);
                    if !session.pending_events.is_empty() {
                        persisted_event_sessions.push(session.clone());
                    }
                }
                Err(tap_bridge::BridgeError::Conflict) => {
                    failures.push(format!(
                        "game {} changed on another client; your conflicting action was rejected",
                        session.name
                    ));
                    if let Ok(stored) =
                        tap_bridge::load_session(&Runtime::Tap, &channel, &session.session_id.0)
                            .await
                        && let Some(canonical) = stored.value
                        && let Ok((canonical, migrated)) =
                            prepare_loaded_snapshot(canonical, &channel)
                    {
                        if let Some(position) = app
                            .sessions
                            .borrow()
                            .iter()
                            .position(|candidate| candidate.session_id == canonical.session_id)
                        {
                            app.sessions.borrow_mut()[position] = canonical.clone();
                        }
                        if let Some(revision) = stored.revision {
                            app.session_revisions
                                .borrow_mut()
                                .insert(canonical.session_id.0.clone(), revision);
                        }
                        if migrated && canonical.host == app.player {
                            app.pending_sessions
                                .borrow_mut()
                                .insert(canonical.session_id.0.clone());
                        }
                    }
                }
                Err(error) => {
                    session_write_failed = true;
                    failures.push(format!("game {}: {error}", session.name));
                    app.pending_sessions
                        .borrow_mut()
                        .insert(session.session_id.0);
                }
            }
        }
        if save_index && session_write_failed {
            *app.pending_index.borrow_mut() = true;
            failures.push(
                "channel game index was deferred until every referenced game is safely stored"
                    .into(),
            );
        } else if save_index {
            match save_channel_index_merged(&channel, index.clone(), &locally_known, index_revision)
                .await
            {
                Ok((next, merged)) => {
                    *app.index_revision.borrow_mut() = Some(next);
                    reload_index = merged
                        .session_ids
                        .iter()
                        .any(|session| !locally_known.contains(&session.0));
                }
                Err(error) => {
                    failures.push(format!("channel game index: {error}"));
                    *app.pending_index.borrow_mut() = true;
                }
            }
        }
        if save_progress {
            match tap_bridge::save_progress(&Runtime::Tap, &player, &progress, progress_revision)
                .await
            {
                Ok(next) => *app.progress_revision.borrow_mut() = Some(next),
                Err(tap_bridge::BridgeError::Conflict) => {
                    if let Ok(stored) = tap_bridge::load_progress(&Runtime::Tap, &player).await
                        && let Some(canonical) = stored.value
                        && game_core::validate_progress(&canonical, &app.player).is_ok()
                    {
                        merge_progress(&mut app.progress.borrow_mut(), &canonical);
                        *app.progress_revision.borrow_mut() = stored.revision;
                        *app.pending_progress.borrow_mut() = true;
                    }
                    failures.push("personal progression changed in another surface; merged values are ready to retry".into());
                }
                Err(error) => {
                    failures.push(format!("personal progression: {error}"));
                    *app.pending_progress.borrow_mut() = true;
                }
            }
        }
        if save_settings {
            match tap_bridge::save_audio_settings(
                &Runtime::Tap,
                &player,
                &settings,
                settings_revision,
            )
            .await
            {
                Ok(next) => *app.settings_revision.borrow_mut() = Some(next),
                Err(tap_bridge::BridgeError::Conflict) => {
                    if let Ok(stored) =
                        tap_bridge::load_audio_settings(&Runtime::Tap, &player).await
                    {
                        *app.settings_revision.borrow_mut() = stored.revision;
                    }
                    *app.pending_settings.borrow_mut() = true;
                    failures.push(
                        "audio settings changed in another surface; retry to keep these values"
                            .into(),
                    );
                }
                Err(error) => {
                    failures.push(format!("audio settings: {error}"));
                    *app.pending_settings.borrow_mut() = true;
                }
            }
        }
        if failures.is_empty() {
            for snapshot in persisted_event_sessions {
                if let Err(error) = deliver_pending_events(&app, &snapshot).await {
                    app.pending_sessions
                        .borrow_mut()
                        .insert(snapshot.session_id.0.clone());
                    failures.push(format!("durable game activity: {error}"));
                }
            }
        }
        *app.saving.borrow_mut() = false;
        *app.error.borrow_mut() = if failures.is_empty() {
            None
        } else {
            Some(format!(
                "Could not save {}. Reload authoritative TAP data or retry the pending save.",
                failures.join("; ")
            ))
        };
        let retry_immediately = failures.is_empty() && has_pending_saves(&app);
        if failures.is_empty() {
            let _ = render_live(&app);
        } else {
            let _ = render(&app);
        }
        if retry_immediately {
            flush_saves(app);
        } else if reload_index && failures.is_empty() {
            load_tap_data(app);
        }
    });
}

fn load_tap_data(app: Rc<App>) {
    *app.loading.borrow_mut() = true;
    let _ = render(&app);
    let channel = app.channel.clone();
    let player = app.player.0.clone();
    spawn_local(async move {
        let presence_state = current_presence_state(&app);
        let presence_result =
            tap_bridge::join_presence_typed::<GamePresenceState>(&channel, &presence_state).await;
        let index_result = tap_bridge::load_channel_index(&Runtime::Tap, &channel).await;
        let progress_result = tap_bridge::load_progress(&Runtime::Tap, &player).await;
        let settings_result = tap_bridge::load_audio_settings(&Runtime::Tap, &player).await;
        let mut failures = Vec::new();
        match presence_result {
            Ok(snapshot) => match validate_presence(&snapshot) {
                Ok(()) => {
                    *app.presence.borrow_mut() = Some(snapshot);
                    if let Err(error) = install_presence_subscription(&app) {
                        failures.push(format!("channel presence subscription: {error}"));
                    }
                }
                Err(error) => failures.push(format!("channel presence: {error}")),
            },
            Err(error) => failures.push(format!("channel presence: {error}")),
        }
        match index_result {
            Ok(stored) => {
                let index = stored.value.unwrap_or(ChannelIndex {
                    schema_version: 1,
                    session_ids: vec![],
                });
                let unique: HashSet<_> = index
                    .session_ids
                    .iter()
                    .map(|session| session.0.as_str())
                    .collect();
                if index.schema_version != 1
                    || index.session_ids.len() > 64
                    || unique.len() != index.session_ids.len()
                    || unique.iter().any(|session| session.trim().is_empty())
                {
                    failures.push("invalid channel game index".into());
                } else {
                    let active_id = app.active.borrow().and_then(|position| {
                        app.sessions
                            .borrow()
                            .get(position)
                            .map(|session| session.session_id.clone())
                    });
                    let mut sessions = Vec::new();
                    let mut revisions = HashMap::new();
                    let mut migrated_sessions = Vec::new();
                    for session_id in &index.session_ids {
                        match tap_bridge::load_session(&Runtime::Tap, &channel, &session_id.0).await
                        {
                            Ok(session) => match session.value.and_then(|snapshot| {
                                prepare_loaded_snapshot(snapshot, &channel).ok()
                            }) {
                                Some((snapshot, migrated)) => {
                                    if let Some(revision) = session.revision {
                                        revisions.insert(session_id.0.clone(), revision);
                                    }
                                    if migrated && snapshot.host == app.player {
                                        migrated_sessions.push(session_id.0.clone());
                                    }
                                    sessions.push(snapshot);
                                }
                                _ => failures
                                    .push(format!("game {} is missing or invalid", session_id.0)),
                            },
                            Err(error) => failures
                                .push(format!("game {} could not load: {error}", session_id.0)),
                        }
                    }
                    *app.sessions.borrow_mut() = sessions;
                    *app.session_revisions.borrow_mut() = revisions;
                    *app.index_revision.borrow_mut() = stored.revision;
                    *app.active.borrow_mut() = active_id.and_then(|id| {
                        app.sessions
                            .borrow()
                            .iter()
                            .position(|session| session.session_id == id)
                    });
                    for session_id in migrated_sessions {
                        app.pending_sessions.borrow_mut().insert(session_id);
                    }
                }
            }
            Err(error) => failures.push(format!("channel games: {error}")),
        }
        match progress_result {
            Ok(stored) => {
                let progress = stored
                    .value
                    .unwrap_or_else(|| default_progress(app.player.clone()));
                match game_core::validate_progress(&progress, &app.player) {
                    Ok(()) => {
                        *app.progress.borrow_mut() = progress;
                        *app.progress_revision.borrow_mut() = stored.revision;
                    }
                    Err(error) => {
                        failures.push(format!("invalid personal progression: {error}"));
                    }
                }
            }
            Err(error) => failures.push(format!("personal progression: {error}")),
        }
        match settings_result {
            Ok(stored) => {
                if let Some(settings) = stored.value {
                    if settings.schema_version == 1
                        && settings.player_id == app.player
                        && settings.master <= 100
                        && settings.music <= 100
                        && settings.effects <= 100
                    {
                        *app.master.borrow_mut() = settings.master;
                        *app.music.borrow_mut() = settings.music;
                        *app.effects.borrow_mut() = settings.effects;
                        *app.muted.borrow_mut() = settings.muted;
                        update_audio_levels(&app);
                        *app.settings_revision.borrow_mut() = stored.revision;
                    } else {
                        failures.push("invalid personal audio settings".into());
                    }
                } else {
                    *app.settings_revision.borrow_mut() = stored.revision;
                }
            }
            Err(error) => failures.push(format!("audio settings: {error}")),
        }
        let mut progress_changed = false;
        for session in app.sessions.borrow().iter() {
            progress_changed |=
                record_completions(&mut app.progress.borrow_mut(), session).progress_changed;
        }
        let pending_event_sessions: Vec<_> = app
            .sessions
            .borrow()
            .iter()
            .filter(|session| session.host == app.player && !session.pending_events.is_empty())
            .map(|session| session.session_id.0.clone())
            .collect();
        for session_id in &pending_event_sessions {
            app.pending_sessions.borrow_mut().insert(session_id.clone());
        }
        *app.loading.borrow_mut() = false;
        *app.error.borrow_mut() = if failures.is_empty() {
            None
        } else {
            Some(format!(
                "Could not load {}. Retry when TAP is available.",
                failures.join(" and ")
            ))
        };
        let _ = render(&app);
        if progress_changed {
            request_save(app, SaveScope::Progress);
        } else if !pending_event_sessions.is_empty() || has_pending_saves(&app) {
            flush_saves(app);
        }
    });
}

fn poll_tap_state(app: Rc<App>) {
    if *app.loading.borrow() || *app.saving.borrow() || !*app.authority.borrow() {
        return;
    }
    let active_session = app.active.borrow().and_then(|index| {
        app.sessions
            .borrow()
            .get(index)
            .map(|session| session.session_id.clone())
    });
    let channel = app.channel.clone();
    spawn_local(async move {
        if let Some(session_id) = active_session {
            match tap_bridge::load_session(&Runtime::Tap, &channel, &session_id.0).await {
                Ok(stored) => {
                    let known = app.session_revisions.borrow().get(&session_id.0).copied();
                    if stored.revision != known
                        && let Some(snapshot) = stored.value
                    {
                        let Ok((snapshot, migrated)) = prepare_loaded_snapshot(snapshot, &channel)
                        else {
                            *app.error.borrow_mut() =
                                Some("Received invalid synchronized game state.".into());
                            let _ = render(&app);
                            return;
                        };
                        if let Some(position) = {
                            let sessions = app.sessions.borrow();
                            sessions
                                .iter()
                                .position(|session| session.session_id == session_id)
                        } {
                            let migration_needs_save = migrated_snapshot_needs_host_persistence(
                                &snapshot,
                                &app.player,
                                migrated,
                            );
                            let previous = app.sessions.borrow()[position].clone();
                            play_snapshot_audio(&app, &previous, &snapshot);
                            if let Some(notice) = observed_wave_clear_bonus(&previous, &snapshot) {
                                *app.notice.borrow_mut() = Some(notice);
                            }
                            let previous_presence = previous
                                .members
                                .iter()
                                .find(|member| member.player_id == app.player)
                                .map(|member| (member.slot, member.ready));
                            let next_presence = snapshot
                                .members
                                .iter()
                                .find(|member| member.player_id == app.player)
                                .map(|member| (member.slot, member.ready));
                            let needs_full_render = previous.last_sequence
                                != snapshot.last_sequence
                                || previous.status != snapshot.status;
                            let progress_changed =
                                record_completions(&mut app.progress.borrow_mut(), &snapshot)
                                    .progress_changed;
                            record_presentation_transition(&app, &previous, &snapshot);
                            app.sessions.borrow_mut()[position] = snapshot;
                            if let Some(revision) = stored.revision {
                                app.session_revisions
                                    .borrow_mut()
                                    .insert(session_id.0.clone(), revision);
                            }
                            if needs_full_render {
                                preserve_active_focus(&app);
                                let _ = render(&app);
                            } else {
                                let _ = render_live(&app);
                            }
                            if previous_presence != next_presence {
                                push_presence(app.clone());
                            }
                            if migration_needs_save {
                                app.pending_sessions
                                    .borrow_mut()
                                    .insert(session_id.0.clone());
                            }
                            if progress_changed {
                                request_save(app, SaveScope::Progress);
                            } else if migration_needs_save {
                                flush_saves(app.clone());
                            }
                        }
                    }
                }
                Err(error) => {
                    *app.error.borrow_mut() =
                        Some(format!("Could not synchronize this game: {error}"));
                    let _ = render(&app);
                }
            }
        } else {
            match tap_bridge::load_channel_index(&Runtime::Tap, &channel).await {
                Ok(stored) if stored.revision != *app.index_revision.borrow() => {
                    load_tap_data(app);
                }
                Ok(_) => {}
                Err(error) => {
                    *app.error.borrow_mut() =
                        Some(format!("Could not refresh channel games: {error}"));
                    let _ = render(&app);
                }
            }
        }
    });
}
fn queue_snapshot_event(snapshot: &mut SessionSnapshot, name: &str) {
    let id = format!(
        "{name}:{}:{}:{}",
        snapshot.session_id.0, snapshot.attempt, snapshot.last_sequence
    );
    if !snapshot.pending_events.iter().any(|event| event.id == id) {
        snapshot.pending_events.push(PendingGameEvent {
            id,
            name: name.to_string(),
        });
    }
}

async fn deliver_pending_events(
    app: &Rc<App>,
    snapshot: &SessionSnapshot,
) -> Result<(), tap_bridge::BridgeError> {
    let events = app
        .events
        .clone()
        .ok_or(tap_bridge::BridgeError::Unavailable)?;
    for event in snapshot.pending_events.clone() {
        let mut payload_snapshot = snapshot.clone();
        payload_snapshot.pending_events.clear();
        let mut payload_value = serde_json::to_value(payload_snapshot)
            .map_err(|error| tap_bridge::BridgeError::Invalid(error.to_string()))?;
        let Some(object) = payload_value.as_object_mut() else {
            return Err(tap_bridge::BridgeError::Invalid(
                "event payload is not an object".into(),
            ));
        };
        object.insert(
            "eventDeliveryId".into(),
            serde_json::Value::String(event.id.clone()),
        );
        let json = serde_json::to_string(&payload_value)
            .map_err(|error| tap_bridge::BridgeError::Invalid(error.to_string()))?;
        let payload = js_sys::JSON::parse(&json)
            .map_err(|error| tap_bridge::BridgeError::Invalid(format!("{error:?}")))?;
        tap_bridge::publish(&events, &event.name, &payload).await?;
        tap_bridge::send_channel_activity(&app.channel, &event.name, snapshot).await?;
        if let Some(position) = app
            .sessions
            .borrow()
            .iter()
            .position(|candidate| candidate.session_id == snapshot.session_id)
        {
            app.sessions.borrow_mut()[position]
                .pending_events
                .retain(|pending| pending.id != event.id);
            app.pending_sessions
                .borrow_mut()
                .insert(snapshot.session_id.0.clone());
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AcknowledgementBinding {
    Bound,
    LegacyUnbound,
    Substituted,
}

fn acknowledgement_binding(
    expected: &PlayerCommand,
    entry: &QueuedCommand,
) -> AcknowledgementBinding {
    let Some(acknowledgement) = entry.acknowledgement.as_ref() else {
        return AcknowledgementBinding::LegacyUnbound;
    };
    if entry.command != *expected || acknowledgement.command_id != expected.id {
        return AcknowledgementBinding::Substituted;
    }
    match acknowledgement.command_fingerprint.as_deref() {
        Some(fingerprint) if fingerprint == expected.fingerprint() => AcknowledgementBinding::Bound,
        Some(_) => AcknowledgementBinding::Substituted,
        None => AcknowledgementBinding::LegacyUnbound,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PersistedAckReconciliation {
    Reconciled,
    AwaitingAuthoritativeState,
    LegacyUnbound,
    Substituted,
    MissingAuthoritativeResult,
}

fn reconcile_persisted_ack(
    expected: &PlayerCommand,
    entry: &QueuedCommand,
    snapshot: &SessionSnapshot,
) -> PersistedAckReconciliation {
    let Some(acknowledgement) = entry.acknowledgement.as_ref() else {
        return PersistedAckReconciliation::AwaitingAuthoritativeState;
    };
    match acknowledgement_binding(expected, entry) {
        AcknowledgementBinding::Bound => {}
        AcknowledgementBinding::LegacyUnbound => {
            return PersistedAckReconciliation::LegacyUnbound;
        }
        AcknowledgementBinding::Substituted => {
            return PersistedAckReconciliation::Substituted;
        }
    }
    if !acknowledgement.accepted {
        return PersistedAckReconciliation::MissingAuthoritativeResult;
    }
    if snapshot.last_sequence < acknowledgement.sequence {
        return PersistedAckReconciliation::AwaitingAuthoritativeState;
    }
    let Some(receipt) = snapshot
        .processed_command_receipts
        .iter()
        .find(|receipt| receipt.command_id == expected.id)
    else {
        return PersistedAckReconciliation::MissingAuthoritativeResult;
    };
    if receipt.command_fingerprint != expected.fingerprint() {
        PersistedAckReconciliation::Substituted
    } else if receipt.sequence != acknowledgement.sequence {
        PersistedAckReconciliation::MissingAuthoritativeResult
    } else {
        PersistedAckReconciliation::Reconciled
    }
}

fn acknowledgement_for_queue_entry(
    command: &PlayerCommand,
    acknowledgement: &CommandAck,
) -> CommandAck {
    if acknowledgement.command_id == command.id
        && acknowledgement.command_fingerprint.as_deref() == Some(command.fingerprint().as_str())
    {
        return acknowledgement.clone();
    }
    CommandAck {
        command_id: command.id.clone(),
        sequence: acknowledgement.sequence,
        accepted: false,
        reason: Some(
            "Command ID payload changed before acknowledgement; the substituted action was not accepted."
                .into(),
        ),
        command_fingerprint: Some(command.fingerprint()),
    }
}

fn processed_command_acknowledgement(
    snapshot: &SessionSnapshot,
    command: &PlayerCommand,
) -> Option<CommandAck> {
    if !snapshot.processed_commands.contains(&command.id) {
        return None;
    }
    let fingerprint = command.fingerprint();
    match snapshot
        .processed_command_receipts
        .iter()
        .find(|receipt| receipt.command_id == command.id)
    {
        Some(receipt) if receipt.command_fingerprint == fingerprint => Some(CommandAck {
            command_id: command.id.clone(),
            sequence: receipt.sequence,
            accepted: true,
            reason: None,
            command_fingerprint: Some(fingerprint),
        }),
        Some(receipt) => Some(CommandAck {
            command_id: command.id.clone(),
            sequence: receipt.sequence,
            accepted: false,
            reason: Some(
                "Command ID was already processed with a different payload; substitution rejected."
                    .into(),
            ),
            command_fingerprint: Some(fingerprint),
        }),
        None => Some(CommandAck {
            command_id: command.id.clone(),
            sequence: snapshot.last_sequence,
            accepted: false,
            reason: Some(
                "Legacy processed command has no payload receipt and cannot be safely accepted again."
                    .into(),
            ),
            command_fingerprint: Some(fingerprint),
        }),
    }
}

fn validate_command_queue(queue: &CommandQueue) -> Result<(), tap_bridge::BridgeError> {
    let ids: HashSet<_> = queue
        .entries
        .iter()
        .map(|entry| entry.command.id.0.as_str())
        .collect();
    if queue.schema_version != 1
        || queue.entries.len() > 256
        || ids.len() != queue.entries.len()
        || queue.entries.iter().any(|entry| {
            entry.command.schema_version != 1
                || entry.command.id.0.trim().is_empty()
                || entry.command.player_id.0.trim().is_empty()
                || entry
                    .acknowledgement
                    .as_ref()
                    .is_some_and(|acknowledgement| {
                        acknowledgement.command_id != entry.command.id
                            || acknowledgement
                                .reason
                                .as_ref()
                                .is_some_and(|reason| reason.chars().count() > 240)
                            || acknowledgement.command_fingerprint.as_ref().is_some_and(
                                |fingerprint| {
                                    fingerprint.chars().count() > 1_024
                                        || fingerprint != &entry.command.fingerprint()
                                },
                            )
                    })
        })
    {
        return Err(tap_bridge::BridgeError::Invalid(
            "invalid command queue".into(),
        ));
    }
    Ok(())
}

async fn enqueue_command(
    channel: &str,
    session_id: &str,
    command: PlayerCommand,
) -> Result<(), tap_bridge::BridgeError> {
    for _ in 0..5 {
        let stored = tap_bridge::load_command_queue(&Runtime::Tap, channel, session_id).await?;
        let mut queue = stored.value.unwrap_or(CommandQueue {
            schema_version: 1,
            entries: vec![],
        });
        validate_command_queue(&queue)?;
        if let Some(existing) = queue
            .entries
            .iter()
            .find(|entry| entry.command.id == command.id)
        {
            if existing.command == command {
                return Ok(());
            }
            return Err(tap_bridge::BridgeError::Invalid(
                "command ID is already bound to a different payload".into(),
            ));
        }
        while queue.entries.len() >= 256 {
            let Some(position) = queue
                .entries
                .iter()
                .position(|entry| entry.acknowledgement.is_some())
            else {
                return Err(tap_bridge::BridgeError::Invalid(
                    "command queue is full; wait for the host to process actions".into(),
                ));
            };
            queue.entries.remove(position);
        }
        queue.entries.push(QueuedCommand {
            command: command.clone(),
            acknowledgement: None,
        });
        match tap_bridge::save_command_queue(
            &Runtime::Tap,
            channel,
            session_id,
            &queue,
            stored.revision,
        )
        .await
        {
            Ok(_) => return Ok(()),
            Err(tap_bridge::BridgeError::Conflict) => {}
            Err(error) => return Err(error),
        }
    }
    Err(tap_bridge::BridgeError::Conflict)
}

fn poll_command_ack(app: Rc<App>, session_id: String, command_id: String) {
    spawn_local(async move {
        let Some(awaiting) = app.awaiting_commands.borrow().get(&command_id).cloned() else {
            return;
        };
        if awaiting.session_id != session_id {
            *app.error.borrow_mut() = Some(
                "Pending command scope changed before acknowledgement. Reload authoritative TAP data."
                    .into(),
            );
            *app.notice.borrow_mut() = None;
            let _ = render(&app);
            return;
        }
        let result = tap_bridge::load_command_queue(&Runtime::Tap, &app.channel, &session_id).await;
        let stored = match result {
            Ok(stored) => stored,
            Err(error) => {
                *app.error.borrow_mut() = Some(format!(
                    "Could not check authoritative action status: {error}"
                ));
                let _ = render(&app);
                return;
            }
        };
        let Some(queue) = stored.value else {
            *app.error.borrow_mut() = Some(
                "The authoritative command queue disappeared before acknowledgement. The action remains blocked; reload TAP data to reconcile before retrying."
                    .into(),
            );
            *app.notice.borrow_mut() = None;
            let _ = render(&app);
            return;
        };
        if let Err(error) = validate_command_queue(&queue) {
            *app.error.borrow_mut() = Some(error.to_string());
            let _ = render(&app);
            return;
        }
        let Some(entry) = queue
            .entries
            .iter()
            .find(|entry| entry.command.id.0 == command_id)
            .cloned()
        else {
            *app.error.borrow_mut() = Some(
                "The queued action is no longer present. The action remains blocked; reload authoritative TAP data to reconcile before retrying."
                    .into(),
            );
            *app.notice.borrow_mut() = None;
            let _ = render(&app);
            return;
        };
        let Some(acknowledgement) = entry.acknowledgement.as_ref().cloned() else {
            if app
                .pending_command_started
                .borrow()
                .get(&command_id)
                .is_some_and(|started| js_sys::Date::now() - started > 15_000.0)
            {
                *app.error.borrow_mut() = Some(
                    "The game host has not acknowledged this action after 15 seconds. The action remains blocked to prevent a duplicate; reload TAP data to reconcile or wait for the host to reconnect."
                        .into(),
                );
                *app.notice.borrow_mut() = None;
                let _ = render(&app);
            }
            return;
        };
        match acknowledgement_binding(&awaiting.command, &entry) {
            AcknowledgementBinding::Bound => {}
            AcknowledgementBinding::LegacyUnbound => {
                *app.notice.borrow_mut() = None;
                *app.error.borrow_mut() = Some(
                    "The persisted acknowledgement predates command payload binding and cannot be treated as success. The action remains blocked; reload authoritative TAP data to reconcile."
                        .into(),
                );
                let _ = render(&app);
                return;
            }
            AcknowledgementBinding::Substituted => {
                *app.notice.borrow_mut() = None;
                *app.error.borrow_mut() = Some(
                    "The queued command or acknowledgement no longer matches the action that was sent. Substitution was rejected; reload authoritative TAP data."
                        .into(),
                );
                let _ = render(&app);
                return;
            }
        }
        if !acknowledgement.accepted {
            app.awaiting_commands.borrow_mut().remove(&command_id);
            app.pending_command_started.borrow_mut().remove(&command_id);
            *app.notice.borrow_mut() = None;
            *app.error.borrow_mut() = Some(format!(
                "Action rejected by the authoritative game: {}",
                acknowledgement
                    .reason
                    .as_deref()
                    .unwrap_or("unknown rejection")
            ));
            let _ = render(&app);
            return;
        }

        *app.notice.borrow_mut() =
            Some("Action acknowledged; reconciling authoritative game state…".into());
        *app.error.borrow_mut() = None;
        let _ = render(&app);

        let stored_session = match tap_bridge::load_session(
            &Runtime::Tap,
            &app.channel,
            &awaiting.session_id,
        )
        .await
        {
            Ok(stored) => stored,
            Err(error) => {
                *app.notice.borrow_mut() = None;
                *app.error.borrow_mut() = Some(format!(
                    "The action was acknowledged, but authoritative state could not be loaded: {error}. It remains blocked until reconciliation."
                ));
                let _ = render(&app);
                return;
            }
        };
        let Some(snapshot) = stored_session.value else {
            *app.notice.borrow_mut() = None;
            *app.error.borrow_mut() = Some(
                "The action was acknowledged, but its authoritative game no longer exists. It remains blocked until TAP data is reloaded."
                    .into(),
            );
            let _ = render(&app);
            return;
        };
        let (snapshot, migrated) = match prepare_loaded_snapshot(snapshot, &app.channel) {
            Ok(result) => result,
            Err(error) => {
                *app.notice.borrow_mut() = None;
                *app.error.borrow_mut() = Some(format!(
                    "The acknowledged action returned invalid authoritative state: {error}. It was not reported as synchronized."
                ));
                let _ = render(&app);
                return;
            }
        };
        if snapshot.session_id.0 != awaiting.session_id {
            *app.notice.borrow_mut() = None;
            *app.error.borrow_mut() = Some(
                "The acknowledged action resolved to a different authoritative game. It was not reported as synchronized."
                    .into(),
            );
            let _ = render(&app);
            return;
        }
        match reconcile_persisted_ack(&awaiting.command, &entry, &snapshot) {
            PersistedAckReconciliation::Reconciled => {}
            PersistedAckReconciliation::AwaitingAuthoritativeState => {
                *app.notice.borrow_mut() =
                    Some("Action acknowledged; waiting for authoritative state…".into());
                *app.error.borrow_mut() = None;
                let _ = render(&app);
                return;
            }
            PersistedAckReconciliation::LegacyUnbound => {
                *app.notice.borrow_mut() = None;
                *app.error.borrow_mut() = Some(
                    "The accepted acknowledgement has no payload binding and cannot be reconciled as success. Reload TAP data."
                        .into(),
                );
                let _ = render(&app);
                return;
            }
            PersistedAckReconciliation::Substituted => {
                *app.notice.borrow_mut() = None;
                *app.error.borrow_mut() = Some(
                    "The authoritative processed-command receipt proves a different payload. Substitution was rejected."
                        .into(),
                );
                let _ = render(&app);
                return;
            }
            PersistedAckReconciliation::MissingAuthoritativeResult => {
                *app.notice.borrow_mut() = None;
                *app.error.borrow_mut() = Some(
                    "The acknowledgement is not backed by a matching authoritative processed-command receipt. It was not reported as synchronized."
                        .into(),
                );
                let _ = render(&app);
                return;
            }
        }

        let Some(position) = app
            .sessions
            .borrow()
            .iter()
            .position(|session| session.session_id.0 == awaiting.session_id)
        else {
            *app.notice.borrow_mut() = None;
            *app.error.borrow_mut() = Some(
                "The reconciled game is no longer open locally. Reload TAP data before continuing."
                    .into(),
            );
            let _ = render(&app);
            return;
        };
        let previous = app.sessions.borrow()[position].clone();
        let wave_clear_notice = observed_wave_clear_bonus(&previous, &snapshot);
        let migration_needs_save =
            migrated_snapshot_needs_host_persistence(&snapshot, &app.player, migrated);
        if previous.host != app.player {
            app.own_cued_sequences
                .borrow_mut()
                .insert(acknowledgement.sequence);
        }
        play_command_cue(&app, &awaiting.command.kind);
        play_snapshot_audio(&app, &previous, &snapshot);
        let progress_changed =
            record_completions(&mut app.progress.borrow_mut(), &snapshot).progress_changed;
        record_presentation_transition(&app, &previous, &snapshot);
        app.sessions.borrow_mut()[position] = snapshot;
        if let Some(revision) = stored_session.revision {
            app.session_revisions
                .borrow_mut()
                .insert(awaiting.session_id.clone(), revision);
        }
        if migration_needs_save {
            app.pending_sessions
                .borrow_mut()
                .insert(awaiting.session_id.clone());
        }
        app.awaiting_commands.borrow_mut().remove(&command_id);
        app.pending_command_started.borrow_mut().remove(&command_id);
        *app.notice.borrow_mut() = Some(wave_clear_notice.map_or_else(
            || "Action accepted and synchronized.".into(),
            |notice| format!("Action accepted and synchronized. {notice}"),
        ));
        *app.error.borrow_mut() = None;
        if let Some(focus_id) = placement_completion_focus_id(&awaiting.command.kind) {
            *app.pending_focus_id.borrow_mut() = Some(focus_id);
            *app.placement.borrow_mut() = None;
        }
        if matches!(awaiting.command.kind, CommandKind::Leave) {
            *app.active.borrow_mut() = None;
        }
        push_presence(app.clone());
        if progress_changed {
            request_save(app.clone(), SaveScope::Progress);
        } else if migration_needs_save {
            flush_saves(app.clone());
        }
        let _ = render(&app);
    });
}

fn poll_pending_command_acks(app: &Rc<App>) {
    let pending: Vec<_> = app
        .awaiting_commands
        .borrow()
        .iter()
        .map(|(command_id, awaiting)| (command_id.clone(), awaiting.session_id.clone()))
        .collect();
    for (command_id, session_id) in pending {
        poll_command_ack(app.clone(), session_id, command_id);
    }
}

fn advance_hosted_sessions(app: Rc<App>) {
    let hosted: Vec<_> = app
        .sessions
        .borrow()
        .iter()
        .enumerate()
        .filter(|(_, session)| {
            session.host == app.player
                && session.status == SessionStatus::Running
                && !app
                    .processing_sessions
                    .borrow()
                    .contains(&session.session_id.0)
        })
        .map(|(index, session)| (index, session.clone()))
        .collect();
    let mut progression_changed = false;
    let mut requires_full_render = false;
    for (index, snapshot) in hosted {
        let previous = snapshot.clone();
        let previous_status = snapshot.status;
        let mut simulation = Simulation::from_snapshot(snapshot);
        simulation.tick();
        play_snapshot_audio(&app, &previous, &simulation.state);
        if let Some(notice) = observed_wave_clear_bonus(&previous, &simulation.state) {
            *app.notice.borrow_mut() = Some(notice);
        }
        if simulation.state.status == SessionStatus::Victory {
            let previous_unlocked = app.progress.borrow().unlocked_level;
            let completion = record_completions(&mut app.progress.borrow_mut(), &simulation.state);
            if completion.progress_changed {
                progression_changed = true;
                if matches!(app.runtime, Runtime::Tap)
                    && app.progress.borrow().unlocked_level > previous_unlocked
                {
                    queue_snapshot_event(&mut simulation.state, "level.unlocked");
                }
                if let Some(stars) = completion.latest_stars
                    && *app.active.borrow() == Some(index)
                {
                    *app.notice.borrow_mut() = Some(format!(
                        "Feed defended · {stars} star{} earned",
                        if stars == 1 { "" } else { "s" }
                    ));
                }
            }
        }
        if matches!(app.runtime, Runtime::Tap)
            && previous_status == SessionStatus::Running
            && simulation.state.status == SessionStatus::Victory
        {
            queue_snapshot_event(&mut simulation.state, "level.completed");
        }
        if matches!(app.runtime, Runtime::Tap)
            && previous_status == SessionStatus::Running
            && simulation.state.status == SessionStatus::Defeat
        {
            queue_snapshot_event(&mut simulation.state, "level.defeated");
        }
        requires_full_render |= previous_status != simulation.state.status;
        let session_id = simulation.state.session_id.0.clone();
        record_presentation_transition(&app, &previous, &simulation.state);
        app.sessions.borrow_mut()[index] = simulation.state;
        if matches!(app.runtime, Runtime::Tap) {
            app.pending_sessions.borrow_mut().insert(session_id);
        }
    }
    if matches!(app.runtime, Runtime::Preview) {
        if let Err(error) = save_preview(&app) {
            *app.error.borrow_mut() = Some(error);
        }
    } else {
        if progression_changed {
            *app.pending_progress.borrow_mut() = true;
        }
        flush_saves(app.clone());
    }
    if requires_full_render {
        let _ = render(&app);
    } else {
        let _ = render_live(&app);
    }
}

fn command_event_name(kind: &CommandKind) -> Option<&'static str> {
    match kind {
        CommandKind::Join {
            as_spectator: true, ..
        } => Some("spectator.joined"),
        CommandKind::Join {
            as_spectator: false,
            ..
        } => Some("player.joined"),
        CommandKind::Start => Some("level.started"),
        CommandKind::StartWave => Some("wave.started"),
        _ => None,
    }
}

async fn store_acknowledgements(
    channel: &str,
    session_id: &str,
    acknowledgements: &HashMap<String, CommandAck>,
) -> Result<(), tap_bridge::BridgeError> {
    for _ in 0..5 {
        let stored = tap_bridge::load_command_queue(&Runtime::Tap, channel, session_id).await?;
        let mut queue = stored
            .value
            .ok_or_else(|| tap_bridge::BridgeError::Invalid("command queue disappeared".into()))?;
        validate_command_queue(&queue)?;
        for entry in &mut queue.entries {
            if let Some(acknowledgement) = acknowledgements.get(&entry.command.id.0) {
                entry.acknowledgement = Some(acknowledgement_for_queue_entry(
                    &entry.command,
                    acknowledgement,
                ));
            }
        }
        match tap_bridge::save_command_queue(
            &Runtime::Tap,
            channel,
            session_id,
            &queue,
            stored.revision,
        )
        .await
        {
            Ok(_) => return Ok(()),
            Err(tap_bridge::BridgeError::Conflict) => {}
            Err(error) => return Err(error),
        }
    }
    Err(tap_bridge::BridgeError::Conflict)
}

fn process_session_commands(app: Rc<App>, session_id: String) {
    if !app
        .processing_sessions
        .borrow_mut()
        .insert(session_id.clone())
    {
        return;
    }
    let channel = app.channel.clone();
    spawn_local(async move {
        let result = async {
            let stored =
                tap_bridge::load_command_queue(&Runtime::Tap, &channel, &session_id).await?;
            let queue = stored.value.unwrap_or(CommandQueue {
                schema_version: 1,
                entries: vec![],
            });
            validate_command_queue(&queue)?;
            let pending: Vec<_> = queue
                .entries
                .iter()
                .filter(|entry| entry.acknowledgement.is_none())
                .map(|entry| entry.command.clone())
                .collect();
            if pending.is_empty() {
                return Ok::<(), tap_bridge::BridgeError>(());
            }
            let Some(position) = app
                .sessions
                .borrow()
                .iter()
                .position(|session| session.session_id.0 == session_id)
            else {
                return Err(tap_bridge::BridgeError::Invalid(
                    "host does not have the queued session".into(),
                ));
            };
            let mut simulation = Simulation::from_snapshot(app.sessions.borrow()[position].clone());
            if simulation.state.host != app.player {
                return Ok(());
            }
            let mut acknowledgements = HashMap::new();
            for command in pending {
                let acknowledgement = if let Some(acknowledgement) =
                    processed_command_acknowledgement(&simulation.state, &command)
                {
                    acknowledgement
                } else {
                    let stored_progress =
                        tap_bridge::load_progress(&Runtime::Tap, &command.player_id.0).await?;
                    let progress = match stored_progress.value {
                        Some(progress) => {
                            game_core::validate_progress(&progress, &command.player_id).map_err(
                                |error| {
                                    tap_bridge::BridgeError::Invalid(format!(
                                        "command author's progression is invalid: {error}"
                                    ))
                                },
                            )?;
                            progress
                        }
                        None => default_progress(command.player_id.clone()),
                    };
                    match simulation.apply(&command, &progress) {
                        Ok(acknowledgement) => {
                            if command.player_id != app.player {
                                play_command_cue(&app, &command.kind);
                            }
                            if let Some(name) = command_event_name(&command.kind) {
                                queue_snapshot_event(&mut simulation.state, name);
                            }
                            acknowledgement
                        }
                        Err(error) => CommandAck {
                            command_id: command.id.clone(),
                            sequence: simulation.state.last_sequence,
                            accepted: false,
                            reason: Some(error.to_string()),
                            command_fingerprint: Some(command.fingerprint()),
                        },
                    }
                };
                acknowledgements.insert(command.id.0, acknowledgement);
            }
            let revision = app.session_revisions.borrow().get(&session_id).copied();
            let next_revision =
                tap_bridge::save_session(&Runtime::Tap, &channel, &simulation.state, revision)
                    .await?;
            app.session_revisions
                .borrow_mut()
                .insert(session_id.clone(), next_revision);
            app.sessions.borrow_mut()[position] = simulation.state.clone();
            store_acknowledgements(&channel, &session_id, &acknowledgements).await?;
            if !simulation.state.pending_events.is_empty() {
                if let Err(error) = deliver_pending_events(&app, &simulation.state).await {
                    app.pending_sessions.borrow_mut().insert(session_id.clone());
                    *app.error.borrow_mut() = Some(format!(
                        "The command was saved, but durable activity delivery is pending: {error}"
                    ));
                } else {
                    flush_saves(app.clone());
                }
            }
            if simulation.state.status == SessionStatus::Abandoned {
                *app.pending_index.borrow_mut() = true;
                flush_saves(app.clone());
            }
            let _ = render(&app);
            Ok(())
        }
        .await;
        app.processing_sessions.borrow_mut().remove(&session_id);
        if let Err(error) = result {
            *app.error.borrow_mut() = Some(format!("Could not process queued actions: {error}"));
            let _ = render(&app);
        }
    });
}

fn issue(app: Rc<App>, kind: CommandKind) {
    if matches!(app.runtime, Runtime::Tap) && !*app.authority.borrow() {
        *app.error.borrow_mut() = Some(
            "TAP host authority is unavailable; this action was not queued or applied.".into(),
        );
        let _ = render(&app);
        return;
    }
    if matches!(app.runtime, Runtime::Tap) && !app.awaiting_commands.borrow().is_empty() {
        *app.error.borrow_mut() =
            Some("Wait for the pending authoritative action before sending another.".into());
        let _ = render(&app);
        return;
    }
    let Some(index) = *app.active.borrow() else {
        return;
    };
    let Some(snapshot) = app.sessions.borrow().get(index).cloned() else {
        return;
    };
    if matches!(app.runtime, Runtime::Tap) {
        push_presence(app.clone());
    }
    let completes_placement = matches!(&kind, CommandKind::Place { .. } | CommandKind::Move { .. });
    let leaves_session = matches!(&kind, CommandKind::Leave);
    let command = PlayerCommand {
        schema_version: 1,
        id: CommandId::new(),
        player_id: app.player.clone(),
        expected_sequence: snapshot.last_sequence,
        kind,
    };
    if matches!(app.runtime, Runtime::Preview) {
        let mut simulation = Simulation::from_snapshot(snapshot);
        match simulation.apply(&command, &app.progress.borrow()) {
            Ok(_) => {
                play_command_cue(&app, &command.kind);
                app.sessions.borrow_mut()[index] = simulation.state;
                if completes_placement {
                    *app.placement.borrow_mut() = None;
                }
                if leaves_session {
                    *app.active.borrow_mut() = None;
                }
                *app.error.borrow_mut() = None;
                request_save(app.clone(), SaveScope::All);
                let _ = render(&app);
            }
            Err(error) => {
                *app.error.borrow_mut() = Some(error.to_string());
                let _ = render(&app);
            }
        }
        return;
    }
    let command_id = command.id.0.clone();
    let session_id = snapshot.session_id.0;
    app.awaiting_commands.borrow_mut().insert(
        command_id.clone(),
        AwaitingCommand {
            session_id: session_id.clone(),
            command: command.clone(),
        },
    );
    app.pending_command_started
        .borrow_mut()
        .insert(command_id.clone(), js_sys::Date::now());
    *app.notice.borrow_mut() = Some("Action sent to the authoritative game host…".into());
    *app.error.borrow_mut() = None;
    let channel = app.channel.clone();
    let queued_app = app.clone();
    spawn_local(async move {
        match enqueue_command(&channel, &session_id, command).await {
            Ok(()) => {
                poll_command_ack(queued_app, session_id, command_id);
            }
            Err(error) => {
                queued_app
                    .awaiting_commands
                    .borrow_mut()
                    .remove(&command_id);
                queued_app
                    .pending_command_started
                    .borrow_mut()
                    .remove(&command_id);
                *queued_app.error.borrow_mut() = Some(format!("Could not queue action: {error}"));
                *queued_app.notice.borrow_mut() = None;
                let _ = render(&queued_app);
            }
        }
    });
    let _ = render(&app);
}

fn complete_placement(app: Rc<App>, x: u16, y: u16) {
    let mode = app.placement.borrow().clone();
    let kind = match mode {
        Some(PlacementMode::New(defender)) => CommandKind::Place { defender, x, y },
        Some(PlacementMode::Move(entity_id)) => CommandKind::Move { entity_id, x, y },
        None => return,
    };
    if matches!(app.runtime, Runtime::Preview)
        && let Some(focus_id) = placement_completion_focus_id(&kind)
    {
        *app.pending_focus_id.borrow_mut() = Some(focus_id);
    }
    issue(app, kind);
}

fn hud_menu(
    app: &Rc<App>,
    label: &str,
    class_name: &str,
    open: bool,
) -> Result<(Element, Element), JsValue> {
    let details = app.document.create_element("details")?;
    details.set_class_name(&format!("hud-menu {class_name}"));
    let menu_id = format!("btd-hud-{class_name}");
    details.set_id(&menu_id);
    if open {
        details.set_attribute("open", "")?;
    }
    let summary = text(&app.document, "summary", label, "hud-menu-trigger")?;
    summary.set_attribute("aria-label", &format!("Open {label} controls"))?;
    details.append_child(&summary)?;
    let body = app.document.create_element("div")?;
    body.set_class_name("hud-menu-content");
    details.append_child(&body)?;
    let current = details.clone();
    let document = app.document.clone();
    on_event(app, &details, "toggle", move |_| {
        if !current.has_attribute("open") {
            return;
        }
        if let Ok(open_menus) = document.query_selector_all(".hud-menu[open]") {
            for index in 0..open_menus.length() {
                let Some(node) = open_menus.item(index) else {
                    continue;
                };
                let Ok(menu) = node.dyn_into::<Element>() else {
                    continue;
                };
                if menu.get_attribute("id").as_deref() != Some(menu_id.as_str()) {
                    let _ = menu.remove_attribute("open");
                }
            }
        }
    })?;
    Ok((details, body))
}

fn render(app: &Rc<App>) -> Result<(), JsValue> {
    app.root.set_inner_html("");
    app.closures.borrow_mut().clear();
    let shell = app.document.create_element("div")?;
    shell.set_class_name("app-shell");
    let skip = text(&app.document, "a", "Skip to app content", "skip-link")?;
    skip.set_attribute("href", "#btd-main")?;
    shell.append_child(&skip)?;
    let header = app.document.create_element("header")?;
    header.set_class_name("toolbar");
    let brand = text(&app.document, "span", "B/TD", "brand-mark")?;
    brand.set_attribute("aria-hidden", "true")?;
    header.append_child(&brand)?;
    let title = text(
        &app.document,
        "span",
        "Brainrot Tower Defense",
        "toolbar-title",
    )?;
    header.append_child(&title)?;
    header.append_text(text(
        &app.document,
        "span",
        if matches!(app.runtime, Runtime::Tap) {
            "TAP channel"
        } else {
            "Browser preview"
        },
        "badge runtime-badge",
    )?)?;
    if matches!(app.runtime, Runtime::Tap) {
        let status = text(&app.document, "span", "", "badge subtle")?;
        status.set_id("btd-save-status");
        status.set_attribute("role", "status")?;
        status.set_attribute("aria-live", "polite")?;
        header.append_child(&status)?;
    }
    if matches!(app.runtime, Runtime::Preview) && app.active.borrow().is_none() {
        let reset = button(&app.document, "Reset preview", "button ghost")?;
        let a = app.clone();
        on(app, &reset, "click", move || {
            if web_sys::window()
                .and_then(|w| {
                    w.confirm_with_message("Delete all browser-preview games and progression?")
                        .ok()
                })
                .unwrap_or(false)
            {
                let result = preview_storage()
                    .ok_or_else(|| "browser preview storage is unavailable".to_string())
                    .and_then(|storage| {
                        storage
                            .remove_item(PREVIEW_KEY)
                            .map_err(|error| format!("{error:?}"))
                    });
                if let Err(error) = result {
                    *a.error.borrow_mut() = Some(format!(
                        "Could not reset browser preview storage: {error}. No visible data was cleared."
                    ));
                    let _ = render(&a);
                    return;
                }
                a.sessions.borrow_mut().clear();
                *a.progress.borrow_mut() = default_progress(a.player.clone());
                *a.active.borrow_mut() = None;
                *a.error.borrow_mut() = None;
                let _ = render(&a);
            }
        })?;
        header.append_child(&reset)?;
    }
    shell.append_child(&header)?;
    if let Some(error) = app.error.borrow().as_ref() {
        let alert = text(&app.document, "div", error, "alert error")?;
        alert.set_attribute("role", "alert")?;
        let dismiss = button(&app.document, "Dismiss", "button ghost")?;
        let a = app.clone();
        on(app, &dismiss, "click", move || {
            *a.error.borrow_mut() = None;
            let _ = render(&a);
        })?;
        alert.append_child(&dismiss)?;
        if matches!(app.runtime, Runtime::Tap) && !*app.loading.borrow() {
            if has_pending_saves(app) {
                let retry = button(&app.document, "Retry pending save", "button primary")?;
                let a = app.clone();
                on(app, &retry, "click", move || flush_saves(a.clone()))?;
                alert.append_child(&retry)?;
            }
            let reload = button(&app.document, "Reload TAP data", "button secondary")?;
            let a = app.clone();
            on(app, &reload, "click", move || {
                let confirmed = !has_pending_saves(&a)
                    || web_sys::window()
                        .and_then(|window| {
                            window
                                .confirm_with_message(
                                    "Discard pending local changes and reload authoritative TAP data?",
                                )
                                .ok()
                        })
                        .unwrap_or(false);
                if confirmed {
                    a.pending_sessions.borrow_mut().clear();
                    *a.pending_index.borrow_mut() = false;
                    *a.pending_progress.borrow_mut() = false;
                    *a.pending_settings.borrow_mut() = false;
                    a.awaiting_commands.borrow_mut().clear();
                    a.pending_command_started.borrow_mut().clear();
                    a.own_cued_sequences.borrow_mut().clear();
                    a.processing_sessions.borrow_mut().clear();
                    load_tap_data(a.clone());
                }
            })?;
            alert.append_child(&reload)?;
        }
        shell.append_child(&alert)?;
    }
    if let Some(notice) = app.notice.borrow().as_ref() {
        let alert = text(&app.document, "div", notice, "alert info")?;
        alert.set_attribute("role", "status")?;
        let dismiss = button(&app.document, "Dismiss", "button ghost")?;
        let a = app.clone();
        on(app, &dismiss, "click", move || {
            *a.notice.borrow_mut() = None;
            let _ = render(&a);
        })?;
        alert.append_child(&dismiss)?;
        shell.append_child(&alert)?;
    }
    let content = app.document.create_element("main")?;
    content.set_id("btd-main");
    content.set_class_name("main-content");
    if *app.loading.borrow() {
        let loading = text(&app.document, "section", "", "card loading-state")?;
        loading.set_attribute("aria-busy", "true")?;
        loading.set_attribute("role", "status")?;
        loading.append_text(text(
            &app.document,
            "h1",
            "Loading channel defenses",
            "section-title",
        )?)?;
        loading.append_text(text(
            &app.document,
            "p",
            "Retrieving shared games and your personal progression from TAP…",
            "muted",
        )?)?;
        let meter = text(&app.document, "div", "", "loading-meter")?;
        meter.set_attribute("aria-hidden", "true")?;
        loading.append_child(&meter)?;
        content.append_child(&loading)?;
    } else if app.display_name.borrow().trim().is_empty() {
        render_preview_onboarding(app, &content)?;
    } else if let Some(index) = *app.active.borrow() {
        render_game(app, &content, index)?;
    } else {
        render_lobbies(app, &content)?;
    }
    shell.append_child(&content)?;
    app.root.append_child(&shell)?;
    update_save_status(app);
    update_presence_dom(app);
    let pending_focus = app.pending_focus_id.borrow().clone();
    if let Some(id) = pending_focus
        && focus_by_id(&app.document, &id)
    {
        *app.pending_focus_id.borrow_mut() = None;
    }
    Ok(())
}

fn render_preview_onboarding(app: &Rc<App>, content: &Element) -> Result<(), JsValue> {
    let card = app.document.create_element("section")?;
    card.set_class_name("hero card onboarding-card");
    card.append_text(text(&app.document, "p", "BROWSER PREVIEW", "eyebrow")?)?;
    card.append_text(text(
        &app.document,
        "h1",
        "Choose your preview call sign.",
        "heading",
    )?)?;
    card.append_text(text(
        &app.document,
        "p",
        "This name and a new runtime-generated player ID stay only in browser-preview storage. TAP packaging uses your authenticated platform identity instead.",
        "muted",
    )?)?;
    let form = app.document.create_element("form")?;
    form.set_class_name("onboarding-form");
    let label = text(&app.document, "label", "Call sign", "field-label")?;
    label.set_attribute("for", "preview-call-sign")?;
    form.append_child(&label)?;
    let input = app
        .document
        .create_element("input")?
        .dyn_into::<HtmlInputElement>()?;
    input.set_id("preview-call-sign");
    input.set_class_name("select text-input");
    input.set_type("text");
    input.set_required(true);
    input.set_max_length(40);
    input.set_attribute("autocomplete", "nickname")?;
    input.set_attribute("placeholder", "Enter a call sign")?;
    form.append_child(&input)?;
    let submit = button(&app.document, "Enter channel games", "button primary")?;
    submit.set_attribute("type", "submit")?;
    form.append_child(&submit)?;
    let a = app.clone();
    let input_copy = input.clone();
    on_event(app, &form, "submit", move |event| {
        event.prevent_default();
        let raw = input_copy.value();
        let value = normalize_display_name(&raw);
        if value.is_empty() || raw.trim().chars().count() > 40 || value != raw.trim() {
            *a.error.borrow_mut() = Some(
                "Call sign must be 1–40 visible characters without control characters.".into(),
            );
            let _ = render(&a);
            return;
        }
        *a.display_name.borrow_mut() = value;
        *a.error.borrow_mut() = None;
        request_save(a.clone(), SaveScope::All);
        let _ = render(&a);
    })?;
    card.append_child(&form)?;
    content.append_child(&card)?;
    Ok(())
}

fn render_lobbies(app: &Rc<App>, content: &Element) -> Result<(), JsValue> {
    let intro = text(&app.document, "section", "", "hero card")?;
    intro.append_text(text(&app.document, "p", "CO-OP SIGNAL ONLINE", "eyebrow")?)?;
    intro.append_text(text(
        &app.document,
        "h1",
        "Defend the feed together.",
        "heading",
    )?)?;
    intro.append_text(text(
        &app.document,
        "p",
        "Create a channel game, claim one of four slots, or watch without changing the simulation.",
        "muted",
    )?)?;
    let create = button(&app.document, "Create game", "button primary")?;
    let channel_game_count = app
        .sessions
        .borrow()
        .iter()
        .filter(|session| session.status != SessionStatus::Abandoned)
        .count();
    if channel_game_count >= 64 {
        create.set_attribute("disabled", "")?;
        create.set_attribute(
            "title",
            "This channel has 64 games; finish and leave an old game before creating another",
        )?;
    }
    if matches!(app.runtime, Runtime::Tap) && !*app.authority.borrow() {
        create.set_attribute("disabled", "")?;
        create.set_attribute("title", "TAP host authority is unavailable")?;
    }
    let a = app.clone();
    on(app, &create, "click", move || {
        if matches!(a.runtime, Runtime::Tap) && !*a.authority.borrow() {
            *a.error.borrow_mut() =
                Some("TAP host authority is unavailable; no game was created or saved.".into());
            let _ = render(&a);
            return;
        }
        if a.sessions
            .borrow()
            .iter()
            .filter(|session| session.status != SessionStatus::Abandoned)
            .count()
            >= 64
        {
            *a.error.borrow_mut() = Some(
                "This channel has 64 games. Finish and leave an old game before creating another."
                    .into(),
            );
            let _ = render(&a);
            return;
        }
        let display_name = a.display_name.borrow().clone();
        let name = format!("{display_name}'s defense");
        let mut sim = Simulation::create(
            a.channel.clone(),
            name,
            a.player.clone(),
            display_name,
            js_sys::Date::now() as u64,
        );
        if matches!(a.runtime, Runtime::Tap) {
            queue_snapshot_event(&mut sim.state, "lobby.created");
        }
        a.sessions.borrow_mut().push(sim.state);
        *a.active.borrow_mut() = Some(a.sessions.borrow().len() - 1);
        push_presence(a.clone());
        request_save(a.clone(), SaveScope::IndexAndActive);
        let _ = render(&a);
    })?;
    intro.append_child(&create)?;
    content.append_child(&intro)?;
    let section = app.document.create_element("section")?;
    section.set_class_name("section");
    section.append_text(text(
        &app.document,
        "h2",
        "Games in this channel",
        "section-title",
    )?)?;
    if app.sessions.borrow().is_empty() {
        let empty = text(&app.document, "div", "", "empty card")?;
        empty.append_text(text(
            &app.document,
            "div",
            "No active games yet",
            "empty-title",
        )?)?;
        empty.append_text(text(
            &app.document,
            "p",
            "Create the first lobby. Games begin empty and only contain players who join.",
            "muted",
        )?)?;
        section.append_child(&empty)?;
    } else {
        let grid = app.document.create_element("div")?;
        grid.set_class_name("lobby-grid");
        for (index, s) in app.sessions.borrow().iter().enumerate() {
            let card = app.document.create_element("article")?;
            card.set_class_name("card lobby-card");
            card.append_text(text(&app.document, "h3", &s.name, "card-title")?)?;
            let level = levels()
                .into_iter()
                .find(|l| l.id == s.level)
                .map_or("Unknown", |l| l.name);
            card.append_text(text(
                &app.document,
                "p",
                &format!("{level} · Wave {} · {:?}", s.wave, s.status),
                "muted",
            )?)?;
            let players = s.members.iter().filter(|m| m.slot.is_some()).count();
            let spectators = s.members.iter().filter(|m| m.slot.is_none()).count();
            card.append_text(text(
                &app.document,
                "p",
                &format!("{players}/4 players · {spectators} watching"),
                "meta",
            )?)?;
            let membership = s
                .members
                .iter()
                .find(|member| member.player_id == app.player);
            if membership.is_some() {
                let open = button(&app.document, "Resume game", "button secondary")?;
                let a = app.clone();
                on(app, &open, "click", move || {
                    *a.active.borrow_mut() = Some(index);
                    push_presence(a.clone());
                    let _ = render(&a);
                })?;
                card.append_child(&open)?;
            } else {
                let controls = app.document.create_element("div")?;
                controls.set_class_name("button-group");
                let can_join = players < 4
                    && matches!(s.status, SessionStatus::Lobby | SessionStatus::BetweenWaves);
                let join = button(&app.document, "Join player slot", "button primary")?;
                if !can_join {
                    join.set_attribute("disabled", "")?;
                }
                let a = app.clone();
                on(app, &join, "click", move || {
                    *a.active.borrow_mut() = Some(index);
                    push_presence(a.clone());
                    issue(
                        a.clone(),
                        CommandKind::Join {
                            as_spectator: false,
                            display_name: a.display_name.borrow().clone(),
                        },
                    );
                })?;
                controls.append_child(&join)?;
                let watch = button(&app.document, "Watch game", "button secondary")?;
                let a = app.clone();
                on(app, &watch, "click", move || {
                    *a.active.borrow_mut() = Some(index);
                    push_presence(a.clone());
                    issue(
                        a.clone(),
                        CommandKind::Join {
                            as_spectator: true,
                            display_name: a.display_name.borrow().clone(),
                        },
                    );
                })?;
                controls.append_child(&watch)?;
                card.append_child(&controls)?;
            }
            grid.append_child(&card)?;
        }
        section.append_child(&grid)?;
    }
    content.append_child(&section)?;
    Ok(())
}

fn render_game(app: &Rc<App>, content: &Element, index: usize) -> Result<(), JsValue> {
    let snapshot = app
        .sessions
        .borrow()
        .get(index)
        .cloned()
        .ok_or_else(|| JsValue::from_str("missing session"))?;
    let mine = snapshot
        .members
        .iter()
        .find(|member| member.player_id == app.player);
    let top = app.document.create_element("div")?;
    top.set_class_name("game-toolbar");
    let back = button(&app.document, "← Channel games", "button ghost")?;
    let a = app.clone();
    on(app, &back, "click", move || {
        *a.active.borrow_mut() = None;
        *a.cursor.borrow_mut() = None;
        *a.placement.borrow_mut() = None;
        *a.inspected_defender.borrow_mut() = None;
        push_presence(a.clone());
        let _ = render(&a);
    })?;
    top.append_child(&back)?;
    top.append_text(text(&app.document, "h1", &snapshot.name, "game-title")?)?;
    top.append_text(text(
        &app.document,
        "span",
        &format!("{:?}", snapshot.status),
        "badge status",
    )?)?;
    if let Some(member) = mine {
        if member.slot.is_none()
            && snapshot
                .members
                .iter()
                .filter(|member| member.slot.is_some())
                .count()
                < 4
            && matches!(
                snapshot.status,
                SessionStatus::Lobby | SessionStatus::BetweenWaves
            )
        {
            let claim = button(&app.document, "Claim player slot", "button primary")?;
            let a = app.clone();
            on(app, &claim, "click", move || {
                issue(
                    a.clone(),
                    CommandKind::Join {
                        as_spectator: false,
                        display_name: a.display_name.borrow().clone(),
                    },
                )
            })?;
            top.append_child(&claim)?;
        }
        let leave = button(&app.document, "Leave game", "button ghost")?;
        let a = app.clone();
        let needs_confirmation = member.slot.is_some();
        on(app, &leave, "click", move || {
            let confirmed = !needs_confirmation
                || web_sys::window()
                    .and_then(|window| {
                        window
                            .confirm_with_message(
                                "Leave this game? Your placed defenders will be removed.",
                            )
                            .ok()
                    })
                    .unwrap_or(false);
            if confirmed {
                issue(a.clone(), CommandKind::Leave);
            }
        })?;
        top.append_child(&leave)?;
    }
    let stage = app.document.create_element("section")?;
    stage.set_id("btd-game-stage");
    stage.set_class_name("game-stage card");
    stage.set_attribute("aria-label", "Brainrot Tower Defense match")?;
    stage.set_attribute("tabindex", "-1")?;
    let map_plane = app.document.create_element("div")?;
    map_plane.set_class_name("game-map-plane");
    let hud = app.document.create_element("div")?;
    hud.set_class_name(if app.inspected_defender.borrow().is_some() {
        "game-hud has-inspector"
    } else {
        "game-hud"
    });
    hud.set_attribute("aria-label", "Battlefield controls")?;
    let stats = app.document.create_element("div")?;
    stats.set_class_name("stats");
    let health = text(
        &app.document,
        "span",
        &format!("♥ {}", snapshot.base_health),
        "stat health",
    )?;
    health.set_id("btd-base-health");
    stats.append_child(&health)?;
    let wave = text(
        &app.document,
        "span",
        &format!("Wave {}", snapshot.wave),
        "stat",
    )?;
    wave.set_id("btd-wave");
    stats.append_child(&wave)?;
    let score = text(
        &app.document,
        "span",
        &format!("Score {}", snapshot.score),
        "stat score",
    )?;
    score.set_id("btd-score");
    stats.append_child(&score)?;
    let resources = text(
        &app.document,
        "span",
        &format!("◈ {}", mine.map_or(0, |m| m.resources)),
        "stat resource",
    )?;
    resources.set_id("btd-resources");
    stats.append_child(&resources)?;
    top.append_child(&stats)?;
    hud.append_child(&top)?;
    let live_summary = text(
        &app.document,
        "span",
        &battlefield_live_summary(
            snapshot.base_health,
            snapshot.wave,
            snapshot.status,
            snapshot.host == app.player,
        ),
        "sr-only",
    )?;
    live_summary.set_id("btd-live-summary");
    live_summary.set_attribute("role", "status")?;
    live_summary.set_attribute("aria-live", "polite")?;
    live_summary.set_attribute("aria-atomic", "true")?;
    hud.append_child(&live_summary)?;
    if let Some(mode) = app.placement.borrow().as_ref() {
        let message = match mode {
            PlacementMode::New(kind) => {
                format!(
                    "Place {} · choose a glowing stone pedestal",
                    kind.replace('_', " ")
                )
            }
            PlacementMode::Move(_) => "Move defender · choose an open stone pedestal".into(),
        };
        let notice = text(&app.document, "div", &message, "placement-notice")?;
        notice.set_attribute("role", "status")?;
        hud.append_child(&notice)?;
    }
    let canvas = app
        .document
        .create_element("canvas")?
        .dyn_into::<HtmlCanvasElement>()?;
    canvas.set_width(1000);
    canvas.set_height(562);
    canvas.set_id("btd-game-canvas");
    canvas.set_class_name(if app.placement.borrow().is_some() {
        "game-canvas placing"
    } else {
        "game-canvas"
    });
    canvas.set_attribute(
        "aria-label",
        &battlefield_aria_label(snapshot.level, app.placement.borrow().is_some()),
    )?;
    draw_canvas_frame(app, &canvas, &snapshot, monotonic_now())?;
    if matches!(app.runtime, Runtime::Tap) {
        let a = app.clone();
        let canvas_copy = canvas.clone();
        on_event(app, canvas.as_ref(), "mousemove", move |event| {
            let now = js_sys::Date::now();
            if now - *a.last_presence_update_ms.borrow() < 120.0 {
                return;
            }
            let Ok(mouse) = event.dyn_into::<MouseEvent>() else {
                return;
            };
            let bounds = canvas_copy.get_bounding_client_rect();
            if bounds.width() <= 0.0 || bounds.height() <= 0.0 {
                return;
            }
            let x = ((f64::from(mouse.client_x()) - bounds.left()) * 1000.0 / bounds.width())
                .clamp(0.0, 1000.0)
                .round() as u16;
            let y = ((f64::from(mouse.client_y()) - bounds.top()) * 562.0 / bounds.height())
                .clamp(0.0, 562.0)
                .round() as u16;
            *a.last_presence_update_ms.borrow_mut() = now;
            *a.cursor.borrow_mut() = Some(PresenceCursor { x, y });
            push_presence(a.clone());
        })?;
        let a = app.clone();
        on(app, canvas.as_ref(), "mouseleave", move || {
            *a.cursor.borrow_mut() = None;
            push_presence(a.clone());
        })?;
    }
    if app.placement.borrow().is_some() {
        let a = app.clone();
        let canvas_copy = canvas.clone();
        let level = snapshot.level;
        let active_players = usize::from(snapshot.scale_players);
        on_event(app, canvas.as_ref(), "click", move |event| {
            let Ok(mouse) = event.dyn_into::<MouseEvent>() else {
                return;
            };
            let bounds = canvas_copy.get_bounding_client_rect();
            if bounds.width() <= 0. || bounds.height() <= 0. {
                return;
            }
            let logical_x = ((f64::from(mouse.client_x()) - bounds.left()) * 1000.
                / bounds.width())
            .clamp(0., 1000.);
            let logical_y = ((f64::from(mouse.client_y()) - bounds.top()) * 562. / bounds.height())
                .clamp(0., 562.);
            let closest = scaled_build_pads(level, active_players)
                .iter()
                .min_by_key(|pad| {
                    let dx = i64::from(pad.x) - logical_x.round() as i64;
                    let dy = i64::from(pad.y) - logical_y.round() as i64;
                    dx * dx + dy * dy
                });
            if let Some(pad) = closest.filter(|pad| {
                let dx = i64::from(pad.x) - logical_x.round() as i64;
                let dy = i64::from(pad.y) - logical_y.round() as i64;
                dx * dx + dy * dy <= 55_i64.pow(2)
            }) {
                complete_placement(a.clone(), pad.x, pad.y);
            } else {
                *a.error.borrow_mut() =
                    Some("Choose one of the glowing stone pedestals on the map.".into());
                let _ = render(&a);
            }
        })?;
    }
    map_plane.append_child(&canvas)?;
    if snapshot.status == SessionStatus::Victory {
        let is_host = snapshot.host == app.player;
        let authority_available = !matches!(app.runtime, Runtime::Tap) || *app.authority.borrow();
        let pending = !app.awaiting_commands.borrow().is_empty();
        let max_level = levels()
            .into_iter()
            .map(|level| level.id)
            .max()
            .unwrap_or(snapshot.level);
        let availability = victory_actions_availability(
            is_host,
            authority_available,
            pending,
            snapshot.level,
            max_level,
        );
        let victory_actions = app.document.create_element("div")?;
        victory_actions.set_class_name("victory-actions");
        victory_actions.set_attribute("role", "group")?;
        victory_actions.set_attribute("aria-label", "Victory actions")?;
        victory_actions.set_attribute("aria-describedby", "btd-live-summary")?;

        let restart_description = restart_action_description(availability.restart);
        let restart = icon_button(
            &app.document,
            "↻",
            restart_description,
            "button victory-action restart",
        )?;
        restart.set_id("btd-restart-level");
        if availability.restart.is_enabled() {
            let a = app.clone();
            on(app, &restart, "click", move || {
                *a.pending_focus_id.borrow_mut() = Some("btd-game-stage".into());
                issue(a.clone(), CommandKind::Restart);
            })?;
        } else {
            restart.set_attribute("disabled", "")?;
        }
        victory_actions.append_child(&restart)?;

        let advance_description = advance_action_description(availability.advance);
        let advance = icon_button(
            &app.document,
            "→",
            advance_description,
            "button victory-action next",
        )?;
        advance.set_id("btd-next-level");
        if availability.advance.is_enabled() {
            let a = app.clone();
            on(app, &advance, "click", move || {
                *a.pending_focus_id.borrow_mut() = Some("btd-game-stage".into());
                issue(a.clone(), CommandKind::AdvanceLevel);
            })?;
        } else {
            advance.set_attribute("disabled", "")?;
        }
        victory_actions.append_child(&advance)?;
        map_plane.append_child(&victory_actions)?;
    }
    if app.placement.borrow().is_some() {
        let picker = app.document.create_element("div")?;
        picker.set_class_name("pad-picker");
        picker.set_attribute("role", "group")?;
        picker.set_attribute("aria-label", "Available build pads")?;
        let moving = match app.placement.borrow().as_ref() {
            Some(PlacementMode::Move(id)) => Some(id.clone()),
            _ => None,
        };
        let active_players = usize::from(snapshot.scale_players);
        for (pad_index, pad) in scaled_build_pads(snapshot.level, active_players)
            .iter()
            .enumerate()
        {
            let (pad_x, pad_y) = logical_position_percent(pad.x, pad.y);
            let occupied = snapshot.defenders.iter().any(|defender| {
                defender.x == pad.x && defender.y == pad.y && moving.as_ref() != Some(&defender.id)
            });
            let select = button(&app.document, &(pad_index + 1).to_string(), "hud-pad")?;
            select.set_attribute(
                "aria-label",
                &format!(
                    "Build pad {}{}",
                    pad_index + 1,
                    if occupied { ", occupied" } else { "" }
                ),
            )?;
            select.set_attribute("style", &format!("--pad-x:{pad_x}%;--pad-y:{pad_y}%"))?;
            if occupied {
                select.set_attribute("disabled", "")?;
            }
            let a = app.clone();
            let x = pad.x;
            let y = pad.y;
            on(app, &select, "click", move || {
                complete_placement(a.clone(), x, y)
            })?;
            picker.append_child(&select)?;
        }
        let cancel = button(
            &app.document,
            "Cancel placement",
            "hud-action cancel-placement",
        )?;
        let restore_focus_id = match app.placement.borrow().as_ref() {
            Some(PlacementMode::New(kind)) => format!("btd-shop-{kind}"),
            Some(PlacementMode::Move(entity_id)) => {
                format!("btd-defender-hotspot-{}", entity_id.0)
            }
            None => String::new(),
        };
        let a = app.clone();
        on(app, &cancel, "click", move || {
            *a.placement.borrow_mut() = None;
            *a.pending_focus_id.borrow_mut() = None;
            push_presence(a.clone());
            let _ = render(&a);
            focus_by_id(&a.document, &restore_focus_id);
        })?;
        map_plane.append_child(&picker)?;
        hud.append_child(&cancel)?;
    }
    let actions = app.document.create_element("div")?;
    let placing = app.placement.borrow().is_some();
    actions.set_class_name(if placing {
        "action-row is-placement-hidden"
    } else {
        "action-row"
    });
    if !placing {
        match snapshot.status {
            SessionStatus::Lobby => {
                if mine.is_some_and(|member| member.slot.is_some()) {
                    let ready = button(
                        &app.document,
                        if mine.is_some_and(|m| m.ready) {
                            "Not ready"
                        } else {
                            "Ready"
                        },
                        "button primary",
                    )?;
                    let a = app.clone();
                    let next = !mine.is_some_and(|m| m.ready);
                    on(app, &ready, "click", move || {
                        issue(a.clone(), CommandKind::Ready { ready: next })
                    })?;
                    actions.append_child(&ready)?;
                }
                if snapshot.host == app.player {
                    let start = button(&app.document, "Start game", "button secondary")?;
                    if snapshot
                        .members
                        .iter()
                        .filter(|member| member.slot.is_some())
                        .any(|member| !member.ready)
                    {
                        start.set_attribute("disabled", "")?;
                        start.set_attribute("title", "Every active player must be ready")?;
                    }
                    let a = app.clone();
                    on(app, &start, "click", move || {
                        issue(a.clone(), CommandKind::Start)
                    })?;
                    actions.append_child(&start)?;
                }
            }
            SessionStatus::BetweenWaves => {
                if snapshot.host == app.player {
                    let wave = button(&app.document, "Start next wave", "button primary")?;
                    let a = app.clone();
                    on(app, &wave, "click", move || {
                        issue(a.clone(), CommandKind::StartWave)
                    })?;
                    actions.append_child(&wave)?;
                }
            }
            SessionStatus::Running => {
                if snapshot.host == app.player {
                    let pause = button(&app.document, "Pause", "button secondary")?;
                    let a = app.clone();
                    on(app, &pause, "click", move || {
                        issue(a.clone(), CommandKind::Pause)
                    })?;
                    actions.append_child(&pause)?;
                }
            }
            SessionStatus::Paused => {
                if snapshot.host == app.player {
                    let resume = button(&app.document, "Resume", "button primary")?;
                    let a = app.clone();
                    on(app, &resume, "click", move || {
                        issue(a.clone(), CommandKind::Resume)
                    })?;
                    actions.append_child(&resume)?;
                }
            }
            SessionStatus::Defeat => {
                if snapshot.host == app.player {
                    let restart = button(&app.document, "Restart level", "button primary")?;
                    let a = app.clone();
                    on(app, &restart, "click", move || {
                        issue(a.clone(), CommandKind::Restart)
                    })?;
                    actions.append_child(&restart)?;
                }
            }
            SessionStatus::Victory => {}
            SessionStatus::Abandoned => {}
        }
    }
    hud.append_child(&actions)?;

    render_defender_hotspots(app, &map_plane, &snapshot)?;
    render_defender_dock(app, &hud, &snapshot)?;
    render_defender_inspector(app, &hud, &snapshot)?;

    let menus = app.document.create_element("nav")?;
    menus.set_class_name(if placing {
        "hud-menus is-placement-hidden"
    } else {
        "hud-menus"
    });
    menus.set_attribute("aria-label", "Match panels")?;

    let (squad_menu, squad_body) = hud_menu(app, "Squad", "squad-menu", false)?;
    render_roster(app, &squad_body, &snapshot)?;
    menus.append_child(&squad_menu)?;

    let (level_menu, level_body) = hud_menu(
        app,
        "Level",
        "level-menu",
        snapshot.status == SessionStatus::Lobby,
    )?;
    render_levels(app, &level_body, &snapshot)?;
    menus.append_child(&level_menu)?;

    let (audio_menu, audio_body) = hud_menu(app, "Sound", "audio-menu", false)?;
    render_audio(app, &audio_body)?;
    menus.append_child(&audio_menu)?;

    hud.append_child(&menus)?;
    stage.append_child(&map_plane)?;
    stage.append_child(&hud)?;
    content.append_child(&stage)?;
    Ok(())
}

fn render_roster(app: &Rc<App>, side: &Element, s: &SessionSnapshot) -> Result<(), JsValue> {
    let card = app.document.create_element("section")?;
    card.set_class_name("panel hud-panel roster-panel");
    card.append_text(text(
        &app.document,
        "h2",
        "Squad & spectators",
        "card-title",
    )?)?;
    if matches!(app.runtime, Runtime::Tap) {
        let live = app.document.create_element("div")?;
        live.set_id("btd-live-presence");
        live.set_class_name("live-presence muted small");
        live.set_attribute("aria-live", "polite")?;
        card.append_child(&live)?;
    }
    for m in &s.members {
        let row = text(&app.document, "div", "", "member-row")?;
        row.append_text(text(&app.document, "span", &m.display_name, "member-name")?)?;
        row.append_text(text(
            &app.document,
            "span",
            &format!("{:?}{}", m.role, if m.ready { " · ready" } else { "" }),
            "badge subtle",
        )?)?;
        card.append_child(&row)?;
    }
    if !s.recent_actions.is_empty() {
        card.append_text(text(
            &app.document,
            "h3",
            "Recent activity",
            "card-title recent-title",
        )?)?;
        for action in s.recent_actions.iter().rev().take(5) {
            card.append_text(text(
                &app.document,
                "p",
                &format!("{} {}", action.actor, action.label),
                "recent-action small",
            )?)?;
        }
    }
    side.append_child(&card)?;
    Ok(())
}
fn render_levels(app: &Rc<App>, side: &Element, s: &SessionSnapshot) -> Result<(), JsValue> {
    let card = app.document.create_element("section")?;
    card.set_class_name("panel hud-panel level-panel");
    card.append_text(text(&app.document, "h2", "Level", "card-title")?)?;
    let select = app
        .document
        .create_element("select")?
        .dyn_into::<HtmlSelectElement>()?;
    select.set_class_name("select");
    select.set_attribute("aria-label", "Selected level")?;
    if s.host != app.player || s.status != SessionStatus::Lobby {
        select.set_attribute("disabled", "")?;
    }
    for level in levels() {
        let option = app.document.create_element("option")?;
        option.set_attribute("value", &level.id.to_string())?;
        option.set_text_content(Some(&format!(
            "{}{}",
            level.name,
            if level.id > app.progress.borrow().unlocked_level {
                " · locked"
            } else {
                ""
            }
        )));
        if level.id == s.level {
            option.set_attribute("selected", "")?;
        }
        if level.id > app.progress.borrow().unlocked_level {
            option.set_attribute("disabled", "")?;
        }
        select.append_child(&option)?;
    }
    let a = app.clone();
    let select_copy = select.clone();
    on(app, select.as_ref(), "change", move || {
        if let Ok(level) = select_copy.value().parse::<u8>() {
            issue(a.clone(), CommandKind::SelectLevel { level });
        }
    })?;
    card.append_child(&select)?;
    let l = levels()
        .into_iter()
        .find(|l| l.id == s.level)
        .ok_or_else(|| JsValue::from_str("level unavailable"))?;
    let players = s
        .members
        .iter()
        .filter(|m| m.slot.is_some())
        .count()
        .clamp(1, 4);
    let scale = &l.scales[players - 1];
    card.append_text(text(&app.document, "p", l.description, "muted small")?)?;
    card.append_text(text(
        &app.document,
        "p",
        &format!(
            "{} paths · {} entrances · {} build pads · ◈{} starting resources per player · ◈{} after each non-final wave · {}×{} authored footprint",
            scale.paths,
            scale.entrances,
            scale.build_slots,
            scale.resource_per_player,
            WAVE_CLEAR_BONUS,
            scale.width,
            scale.height
        ),
        "muted small",
    )?)?;
    card.append_text(text(
        &app.document,
        "p",
        &format!(
            "Stars: 2★ at {}% base health · 3★ at {}%",
            l.scoring.two_star_health_percent, l.scoring.three_star_health_percent
        ),
        "muted small",
    )?)?;
    card.append_text(text(&app.document, "p", l.modifier, "modifier")?)?;
    side.append_child(&card)?;
    Ok(())
}
fn defender_authority_available(app: &App) -> bool {
    !matches!(app.runtime, Runtime::Tap) || *app.authority.borrow()
}

fn render_defender_dock(app: &Rc<App>, hud: &Element, s: &SessionSnapshot) -> Result<(), JsValue> {
    if !matches!(
        s.status,
        SessionStatus::BetweenWaves | SessionStatus::Running | SessionStatus::Paused
    ) {
        return Ok(());
    }
    let economy = live_economy_state(app, s);
    let available_defenders = levels()
        .into_iter()
        .find(|level| level.id == s.level)
        .ok_or_else(|| JsValue::from_str("level unavailable"))?
        .available_defenders;
    let placement = app.placement.borrow().clone();
    let collapsed = placement.is_some();
    let dock = app.document.create_element("nav")?;
    dock.set_class_name(if collapsed {
        "defender-dock is-collapsed"
    } else {
        "defender-dock"
    });
    dock.set_attribute("aria-label", "Defender shop")?;
    if collapsed {
        dock.set_attribute("aria-hidden", "true")?;
        dock.set_attribute("inert", "")?;
    }
    for definition in defenders()
        .into_iter()
        .filter(|definition| available_defenders.contains(&definition.id))
    {
        let unlocked = app
            .progress
            .borrow()
            .unlocked_defenders
            .iter()
            .any(|id| id == definition.id);
        let selected = matches!(
            placement.as_ref(),
            Some(PlacementMode::New(kind)) if kind == definition.id
        );
        let presentation =
            defender_shop_presentation(&definition, selected, unlocked, collapsed, economy);
        let place = button(&app.document, "", "defender-shop-button")?;
        place.set_id(&format!("btd-shop-{}", definition.id));
        sync_defender_shop_button(&place, &presentation)?;
        place.append_text(defender_icon(
            &app.document,
            definition.id,
            "defender-sprite-icon",
        )?)?;
        place.append_text(text(
            &app.document,
            "span",
            &format!("◈{}", definition.cost),
            "defender-shop-cost",
        )?)?;
        let a = app.clone();
        let kind = definition.id.to_string();
        let offer = definition.clone();
        on(app, &place, "click", move || {
            let cancel = matches!(
                a.placement.borrow().as_ref(),
                Some(PlacementMode::New(selected)) if selected == &kind
            );
            let current_snapshot =
                (*a.active.borrow()).and_then(|index| a.sessions.borrow().get(index).cloned());
            let Some(current_snapshot) = current_snapshot else {
                *a.error.borrow_mut() = Some("The current game is unavailable.".into());
                let _ = render(&a);
                return;
            };
            let unlocked = a
                .progress
                .borrow()
                .unlocked_defenders
                .iter()
                .any(|id| id == offer.id);
            let presentation = defender_shop_presentation(
                &offer,
                cancel,
                unlocked,
                a.placement.borrow().is_some(),
                live_economy_state(&a, &current_snapshot),
            );
            if !matches!(
                presentation.state,
                DefenderShopState::Ready | DefenderShopState::Selected
            ) {
                *a.error.borrow_mut() = Some(format!(
                    "{} cannot be selected: {}.",
                    offer.name,
                    presentation.state.label()
                ));
                let _ = render(&a);
                return;
            }
            *a.placement.borrow_mut() = if cancel {
                None
            } else {
                Some(PlacementMode::New(kind.clone()))
            };
            *a.inspected_defender.borrow_mut() = None;
            *a.error.borrow_mut() = None;
            push_presence(a.clone());
            let _ = render(&a);
            if a.placement.borrow().is_some() {
                focus_first_available_pad(&a.document);
            }
        })?;
        dock.append_child(&place)?;
    }
    hud.append_child(&dock)?;
    Ok(())
}

fn render_defender_hotspots(
    app: &Rc<App>,
    hud: &Element,
    s: &SessionSnapshot,
) -> Result<(), JsValue> {
    if app.placement.borrow().is_some()
        || !s
            .defenders
            .iter()
            .any(|defender| defender.owner == app.player)
    {
        return Ok(());
    }
    let selected = app.inspected_defender.borrow().clone();
    let hotspots = app.document.create_element("div")?;
    hotspots.set_class_name("defender-hotspots");
    hotspots.set_attribute("role", "group")?;
    hotspots.set_attribute("aria-label", "Your placed defenders")?;
    for defender in s
        .defenders
        .iter()
        .filter(|defender| defender.owner == app.player)
    {
        let definition = defenders()
            .into_iter()
            .find(|candidate| candidate.id == defender.kind)
            .ok_or_else(|| JsValue::from_str("defender content unavailable"))?;
        let is_selected = selected.as_ref() == Some(&defender.id);
        let hotspot = button(
            &app.document,
            "",
            if is_selected {
                "defender-hotspot is-selected"
            } else {
                "defender-hotspot"
            },
        )?;
        let (unit_x, unit_y) = logical_position_percent(defender.x, defender.y);
        hotspot.set_id(&format!("btd-defender-hotspot-{}", defender.id.0));
        hotspot.set_attribute("style", &format!("--unit-x:{unit_x}%;--unit-y:{unit_y}%"))?;
        hotspot.set_attribute(
            "aria-label",
            &format!("Inspect {} level {}", definition.name, defender.level),
        )?;
        hotspot.set_attribute(
            "title",
            &format!("Inspect {} · level {}", definition.name, defender.level),
        )?;
        hotspot.set_attribute("aria-pressed", if is_selected { "true" } else { "false" })?;
        let a = app.clone();
        let defender_id = defender.id.clone();
        on(app, &hotspot, "click", move || {
            *a.inspected_defender.borrow_mut() = Some(defender_id.clone());
            *a.error.borrow_mut() = None;
            let _ = render(&a);
            if let Some(inspector) = a
                .document
                .get_element_by_id("btd-defender-inspector")
                .and_then(|element| element.dyn_into::<HtmlElement>().ok())
            {
                let _ = inspector.focus();
            }
        })?;
        hotspots.append_child(&hotspot)?;
    }
    hud.append_child(&hotspots)?;
    Ok(())
}

fn render_defender_inspector(
    app: &Rc<App>,
    hud: &Element,
    s: &SessionSnapshot,
) -> Result<(), JsValue> {
    if app.placement.borrow().is_some() {
        return Ok(());
    }
    let Some(selected_id) = app.inspected_defender.borrow().clone() else {
        return Ok(());
    };
    let Some(defender) = s
        .defenders
        .iter()
        .find(|defender| defender.id == selected_id && defender.owner == app.player)
        .cloned()
    else {
        *app.inspected_defender.borrow_mut() = None;
        return Ok(());
    };
    let definition = defenders()
        .into_iter()
        .find(|candidate| candidate.id == defender.kind)
        .ok_or_else(|| JsValue::from_str("defender content unavailable"))?;
    let economy = live_economy_state(app, s);
    let can_control = matches!(
        economy.status,
        SessionStatus::BetweenWaves | SessionStatus::Running
    ) && economy.has_player_slot
        && economy.has_authority
        && !economy.authoritative_command_pending;

    let panel = app.document.create_element("section")?;
    panel.set_id("btd-defender-inspector");
    panel.set_class_name("defender-inspector");
    panel.set_attribute("role", "region")?;
    panel.set_attribute(
        "aria-label",
        &format!("{} defender controls", definition.name),
    )?;
    panel.set_attribute("tabindex", "-1")?;
    let header = app.document.create_element("div")?;
    header.set_class_name("defender-inspector-header");
    header.append_text(defender_icon(
        &app.document,
        definition.id,
        "defender-inspector-icon",
    )?)?;
    let identity = app.document.create_element("div")?;
    identity.set_class_name("defender-inspector-identity");
    identity.append_text(text(
        &app.document,
        "h2",
        definition.name,
        "defender-inspector-title",
    )?)?;
    identity.append_text(text(
        &app.document,
        "p",
        &format!(
            "Level {}/{} · {} · {}",
            defender.level,
            MAX_DEFENDER_LEVEL,
            definition.role,
            if defender.level > 1 {
                defender.path.as_str()
            } else {
                "Uncommitted"
            }
        ),
        "defender-inspector-meta",
    )?)?;
    header.append_child(&identity)?;
    let close = button(&app.document, "×", "defender-inspector-close")?;
    close.set_attribute("aria-label", "Close defender inspector")?;
    close.set_attribute("title", "Close defender inspector")?;
    let a = app.clone();
    let hotspot_id = format!("btd-defender-hotspot-{}", defender.id.0);
    on(app, &close, "click", move || {
        *a.inspected_defender.borrow_mut() = None;
        let _ = render(&a);
        focus_by_id(&a.document, &hotspot_id);
    })?;
    header.append_child(&close)?;
    panel.append_child(&header)?;

    let body = app.document.create_element("div")?;
    body.set_class_name("defender-inspector-body");
    let target_label = app.document.create_element("label")?;
    target_label.set_class_name("defender-inspector-field");
    target_label.append_text(text(&app.document, "span", "Targeting", "small")?)?;
    let target = app
        .document
        .create_element("select")?
        .dyn_into::<HtmlSelectElement>()?;
    target.set_class_name("select compact-select");
    target.set_attribute("aria-label", &format!("Targeting for {}", definition.name))?;
    if !can_control {
        target.set_attribute("disabled", "")?;
        target.set_attribute(
            "title",
            "Targeting is unavailable in the current game state",
        )?;
    }
    for (value, label, policy) in [
        ("first", "First", TargetPolicy::First),
        ("last", "Last", TargetPolicy::Last),
        ("strong", "Strong", TargetPolicy::Strong),
        ("fast", "Fast", TargetPolicy::Fast),
    ] {
        let option = app.document.create_element("option")?;
        option.set_attribute("value", value)?;
        option.set_text_content(Some(label));
        if defender.target_policy == policy {
            option.set_attribute("selected", "")?;
        }
        target.append_child(&option)?;
    }
    let a = app.clone();
    let target_copy = target.clone();
    let target_id = defender.id.clone();
    on(app, target.as_ref(), "change", move || {
        let policy = match target_copy.value().as_str() {
            "last" => TargetPolicy::Last,
            "strong" => TargetPolicy::Strong,
            "fast" => TargetPolicy::Fast,
            _ => TargetPolicy::First,
        };
        issue(
            a.clone(),
            CommandKind::SetTarget {
                entity_id: target_id.clone(),
                policy,
            },
        );
    })?;
    target_label.append_child(&target)?;
    body.append_child(&target_label)?;

    let upgrades = app.document.create_element("div")?;
    upgrades.set_class_name("defender-inspector-upgrades");
    let branch_grid = app.document.create_element("div")?;
    branch_grid.set_class_name("upgrade-branch-grid");
    let tier_count = MAX_DEFENDER_LEVEL.saturating_sub(1);
    for (path_index, path) in definition.upgrade_paths.into_iter().enumerate() {
        let path_definition = upgrade_path(definition.id, path)
            .ok_or_else(|| JsValue::from_str("upgrade path unavailable"))?;
        let branch_state = upgrade_branch_state(defender.level, &defender.path, path);
        let completed_tiers = completed_upgrade_tiers(defender.level, &defender.path, path);
        let branch = app.document.create_element("article")?;
        branch.set_class_name(&format!(
            "upgrade-branch-card is-{}",
            branch_state.data_value()
        ));
        branch.set_attribute("data-state", branch_state.data_value())?;
        branch.set_attribute("title", path_definition.description)?;

        let branch_heading = app.document.create_element("div")?;
        branch_heading.set_class_name("upgrade-branch-heading");
        branch_heading.append_text(text(
            &app.document,
            "h3",
            path_definition.name,
            "upgrade-branch-name",
        )?)?;
        branch_heading.append_text(text(
            &app.document,
            "span",
            branch_state.label(),
            "upgrade-branch-state",
        )?)?;
        branch.append_child(&branch_heading)?;
        branch.append_text(text(
            &app.document,
            "p",
            path_definition.description,
            "upgrade-branch-description",
        )?)?;

        let progress = app.document.create_element("div")?;
        progress.set_class_name("upgrade-tier-progress");
        progress.set_attribute("role", "progressbar")?;
        progress.set_attribute(
            "aria-label",
            &format!(
                "{} upgrade progress, {} of {} tiers",
                path_definition.name, completed_tiers, tier_count
            ),
        )?;
        progress.set_attribute("aria-valuemin", "0")?;
        progress.set_attribute("aria-valuemax", &tier_count.to_string())?;
        progress.set_attribute("aria-valuenow", &completed_tiers.to_string())?;
        for (tier_index, tier) in path_definition.tiers.into_iter().enumerate() {
            let segment = app.document.create_element("span")?;
            segment.set_class_name(if tier_index < usize::from(completed_tiers) {
                "upgrade-tier-segment is-complete"
            } else {
                "upgrade-tier-segment"
            });
            segment.set_attribute("aria-hidden", "true")?;
            segment.set_attribute(
                "title",
                &format!("Tier {} — {}: {}", tier_index + 1, tier.name, tier.effect),
            )?;
            progress.append_child(&segment)?;
        }
        branch.append_child(&progress)?;

        match branch_state {
            UpgradeBranchState::Available | UpgradeBranchState::Committed => {
                let next_tier = next_upgrade_tier(definition.id, path, defender.level)
                    .ok_or_else(|| JsValue::from_str("next upgrade tier unavailable"))?;
                let next = app.document.create_element("div")?;
                next.set_class_name("upgrade-next-tier");
                next.append_text(text(
                    &app.document,
                    "p",
                    &format!("Next · {}", next_tier.name),
                    "upgrade-next-name",
                )?)?;
                let effect_id = format!("btd-upgrade-{path_index}-effect");
                let effect = text(&app.document, "p", next_tier.effect, "upgrade-next-effect")?;
                effect.set_id(&effect_id);
                next.append_child(&effect)?;
                let remaining_tiers = MAX_DEFENDER_LEVEL.saturating_sub(defender.level);
                next.append_text(text(
                    &app.document,
                    "span",
                    &format!(
                        "Tier {}/{} · {} remaining · ◈{}",
                        defender.level, tier_count, remaining_tiers, next_tier.cost
                    ),
                    "upgrade-next-meta",
                )?)?;
                branch.append_child(&next)?;

                let action_label = if branch_state == UpgradeBranchState::Available {
                    "Choose"
                } else {
                    "Upgrade"
                };
                let upgrade = button(
                    &app.document,
                    &format!("{} {} · ◈{}", action_label, next_tier.name, next_tier.cost),
                    "button small secondary upgrade-purchase",
                )?;
                upgrade.set_attribute(
                    "aria-label",
                    &format!(
                        "{} {} via {} to {} for {} resources. {}",
                        action_label,
                        definition.name,
                        path_definition.name,
                        next_tier.name,
                        next_tier.cost,
                        next_tier.effect
                    ),
                )?;
                upgrade.set_id(&format!("btd-upgrade-{path_index}-button"));
                let a = app.clone();
                let upgrade_id = defender.id.clone();
                let upgrade_path = path.to_string();
                on(app, &upgrade, "click", move || {
                    issue(
                        a.clone(),
                        CommandKind::Upgrade {
                            entity_id: upgrade_id.clone(),
                            path: upgrade_path.clone(),
                        },
                    );
                })?;
                let disabled_reason = upgrade_disabled_reason(
                    branch_state,
                    economy.status,
                    economy.has_player_slot,
                    economy.has_authority,
                    economy.authoritative_command_pending,
                    economy.resources,
                    next_tier.cost,
                );
                let reason_id = format!("btd-upgrade-{path_index}-reason");
                let reason_element = text(
                    &app.document,
                    "p",
                    disabled_reason.as_deref().unwrap_or(""),
                    "upgrade-disabled-reason",
                )?;
                reason_element.set_id(&reason_id);
                if let Some(reason) = disabled_reason.as_deref() {
                    upgrade.set_attribute("disabled", "")?;
                    upgrade.set_attribute("aria-disabled", "true")?;
                    upgrade.set_attribute("title", reason)?;
                    upgrade
                        .set_attribute("aria-describedby", &format!("{effect_id} {reason_id}"))?;
                } else {
                    upgrade.set_attribute("title", next_tier.effect)?;
                    upgrade.set_attribute("aria-describedby", &effect_id)?;
                    reason_element.set_attribute("hidden", "")?;
                }
                branch.append_child(&upgrade)?;
                branch.append_child(&reason_element)?;
            }
            UpgradeBranchState::Locked => {
                branch.append_text(text(
                    &app.document,
                    "p",
                    &format!("Locked · committed to {}", defender.path),
                    "upgrade-locked-message",
                )?)?;
            }
            UpgradeBranchState::Maxed => {
                branch.append_text(text(
                    &app.document,
                    "p",
                    &format!("MAX LEVEL · all {} tiers unlocked", tier_count),
                    "upgrade-max-message",
                )?)?;
            }
        }
        branch_grid.append_child(&branch)?;
    }
    upgrades.append_child(&branch_grid)?;
    body.append_child(&upgrades)?;

    let controls = app.document.create_element("div")?;
    controls.set_class_name("defender-inspector-actions");
    let move_button = button(&app.document, "Move", "button small ghost")?;
    if !can_control {
        move_button.set_attribute("disabled", "")?;
        move_button.set_attribute("title", "Moving is unavailable in the current game state")?;
    }
    let a = app.clone();
    let move_id = defender.id.clone();
    on(app, &move_button, "click", move || {
        *a.placement.borrow_mut() = Some(PlacementMode::Move(move_id.clone()));
        *a.error.borrow_mut() = None;
        push_presence(a.clone());
        let _ = render(&a);
        focus_first_available_pad(&a.document);
    })?;
    controls.append_child(&move_button)?;
    let sell = button(&app.document, "Sell", "button small ghost")?;
    if !can_control {
        sell.set_attribute("disabled", "")?;
        sell.set_attribute("title", "Selling is unavailable in the current game state")?;
    }
    let a = app.clone();
    let sell_id = defender.id.clone();
    on(app, &sell, "click", move || {
        if web_sys::window()
            .and_then(|window| {
                window
                    .confirm_with_message("Sell this defender for half its invested value?")
                    .ok()
            })
            .unwrap_or(false)
        {
            issue(
                a.clone(),
                CommandKind::Sell {
                    entity_id: sell_id.clone(),
                },
            );
        }
    })?;
    controls.append_child(&sell)?;
    body.append_child(&controls)?;
    panel.append_child(&body)?;
    hud.append_child(&panel)?;
    Ok(())
}
fn render_audio(app: &Rc<App>, side: &Element) -> Result<(), JsValue> {
    let card = app.document.create_element("section")?;
    card.set_class_name("panel hud-panel audio-panel");
    card.append_text(text(&app.document, "h2", "Audio", "card-title")?)?;
    let enabled = app.audio.borrow().is_some();
    let toggle = button(
        &app.document,
        if enabled {
            "Turn audio off"
        } else {
            "Enable original audio"
        },
        "button secondary",
    )?;
    let a = app.clone();
    on(app, &toggle, "click", move || {
        if matches!(a.runtime, Runtime::Tap) && !*a.authority.borrow() {
            *a.error.borrow_mut() = Some(
                "TAP host authority is unavailable; audio preferences were not changed.".into(),
            );
            let _ = render(&a);
            return;
        }
        if a.audio.borrow().is_some() {
            disable_audio(&a);
            *a.notice.borrow_mut() = Some("Audio is off.".into());
        } else {
            match enable_audio(&a) {
                Ok(()) => {
                    *a.notice.borrow_mut() = Some(
                        "Audio enabled · synthesized cues and level ambience are active.".into(),
                    );
                    *a.error.borrow_mut() = None;
                }
                Err(error) => {
                    *a.error.borrow_mut() =
                        Some(format!("Could not enable browser audio: {error:?}"));
                }
            }
        }
        request_save(a.clone(), SaveScope::Settings);
        let _ = render(&a);
    })?;
    card.append_child(&toggle)?;
    for (label, value) in [
        ("Master", *app.master.borrow()),
        ("Music", *app.music.borrow()),
        ("Effects", *app.effects.borrow()),
    ] {
        let wrap = app.document.create_element("label")?;
        wrap.set_class_name("range-label");
        wrap.append_text(text(&app.document, "span", label, "small")?)?;
        let input = app
            .document
            .create_element("input")?
            .dyn_into::<HtmlInputElement>()?;
        input.set_type("range");
        input.set_min("0");
        input.set_max("100");
        input.set_value(&value.to_string());
        if matches!(app.runtime, Runtime::Tap) && !*app.authority.borrow() {
            input.set_disabled(true);
        }
        let a = app.clone();
        let input_copy = input.clone();
        on(app, input.as_ref(), "change", move || {
            let v = input_copy.value().parse().unwrap_or(0);
            match label {
                "Master" => *a.master.borrow_mut() = v,
                "Music" => *a.music.borrow_mut() = v,
                _ => *a.effects.borrow_mut() = v,
            }
            update_audio_levels(&a);
            request_save(a.clone(), SaveScope::Settings);
        })?;
        wrap.append_child(&input)?;
        card.append_child(&wrap)?;
    }
    side.append_child(&card)?;
    Ok(())
}

fn create_app(
    root: Element,
    runtime: Runtime,
    channel: String,
    events: Option<JsValue>,
    identity: Option<(PlayerId, String)>,
) -> Result<Rc<App>, JsValue> {
    install_styles(&document()?)?;
    let is_tap = matches!(runtime, Runtime::Tap);
    let (saved, preview_error) = if matches!(runtime, Runtime::Preview) {
        match load_preview() {
            Ok(saved) => (saved, None),
            Err(error) => (
                None,
                Some(format!(
                    "Could not restore browser preview data: {error}. Reset preview storage to recover."
                )),
            ),
        }
    } else {
        (None, None)
    };
    let (player, display_name) = identity.unwrap_or_else(|| {
        (
            saved
                .as_ref()
                .map_or_else(PlayerId::new, |s| s.player_id.clone()),
            saved
                .as_ref()
                .map_or_else(String::new, |save| save.display_name.clone()),
        )
    });
    let progress = saved
        .as_ref()
        .map_or_else(|| default_progress(player.clone()), |s| s.progress.clone());
    let app = Rc::new(App {
        root,
        document: document()?,
        runtime,
        channel,
        player,
        display_name: RefCell::new(display_name),
        authority: RefCell::new(!is_tap),
        progress: RefCell::new(progress),
        sessions: RefCell::new(saved.as_ref().map_or_else(Vec::new, |s| s.sessions.clone())),
        active: RefCell::new(None),
        index_revision: RefCell::new(None),
        session_revisions: RefCell::new(HashMap::new()),
        progress_revision: RefCell::new(None),
        settings_revision: RefCell::new(None),
        loading: RefCell::new(is_tap),
        saving: RefCell::new(false),
        pending_sessions: RefCell::new(HashSet::new()),
        pending_index: RefCell::new(false),
        pending_progress: RefCell::new(false),
        pending_settings: RefCell::new(false),
        awaiting_commands: RefCell::new(HashMap::new()),
        pending_command_started: RefCell::new(HashMap::new()),
        own_cued_sequences: RefCell::new(HashSet::new()),
        processing_sessions: RefCell::new(HashSet::new()),
        poll_counter: RefCell::new(0),
        error: RefCell::new(preview_error),
        notice: RefCell::new(None),
        placement: RefCell::new(None),
        inspected_defender: RefCell::new(None),
        pending_focus_id: RefCell::new(None),
        master: RefCell::new(saved.as_ref().map_or(80, |s| s.master)),
        music: RefCell::new(saved.as_ref().map_or(45, |s| s.music)),
        effects: RefCell::new(saved.as_ref().map_or(75, |s| s.effects)),
        muted: RefCell::new(saved.as_ref().is_some_and(|save| save.muted)),
        audio: RefCell::new(None),
        cursor: RefCell::new(None),
        last_presence_update_ms: RefCell::new(0.0),
        presence: RefCell::new(None),
        presence_subscription: RefCell::new(None),
        events,
        presentation: RefCell::new(None),
        simulation_clock: RefCell::new(FixedStepClock::default()),
        animation: RefCell::new(None),
        animation_frame_id: RefCell::new(None),
        closures: RefCell::new(Vec::new()),
        timer: RefCell::new(None),
        timer_id: RefCell::new(None),
    });
    app.simulation_clock.borrow_mut().restart(monotonic_now());
    let timed = app.clone();
    let timer = Closure::<dyn FnMut()>::new(move || {
        let lifecycle_is_active = PHASE.with(|phase| *phase.borrow() == "active");
        if !lifecycle_is_active || !*timed.authority.borrow() {
            timed.simulation_clock.borrow_mut().reset();
            return;
        }
        let steps_due = timed
            .simulation_clock
            .borrow_mut()
            .steps_due(monotonic_now());
        if matches!(timed.runtime, Runtime::Tap) {
            let should_poll = {
                let mut counter = timed.poll_counter.borrow_mut();
                *counter = counter.saturating_add(1);
                if *counter >= 5 {
                    *counter = 0;
                    true
                } else {
                    false
                }
            };
            if should_poll {
                poll_pending_command_acks(&timed);
                let hosted_sessions: Vec<_> = timed
                    .sessions
                    .borrow()
                    .iter()
                    .filter(|session| session.host == timed.player)
                    .map(|session| session.session_id.0.clone())
                    .collect();
                for session_id in hosted_sessions {
                    process_session_commands(timed.clone(), session_id);
                }
                let is_remote_view = timed
                    .active
                    .borrow()
                    .and_then(|index| timed.sessions.borrow().get(index).cloned())
                    .is_none_or(|snapshot| snapshot.host != timed.player);
                if is_remote_view {
                    poll_tap_state(timed.clone());
                }
            }
            for _ in 0..steps_due {
                advance_hosted_sessions(timed.clone());
            }
        } else {
            for _ in 0..steps_due {
                let Some(index) = *timed.active.borrow() else {
                    return;
                };
                let Some(snapshot) = timed.sessions.borrow().get(index).cloned() else {
                    return;
                };
                if snapshot.status == SessionStatus::Running {
                    let previous = snapshot.clone();
                    let mut simulation = Simulation::from_snapshot(snapshot);
                    simulation.tick();
                    play_snapshot_audio(&timed, &previous, &simulation.state);
                    if let Some(notice) = observed_wave_clear_bonus(&previous, &simulation.state) {
                        *timed.notice.borrow_mut() = Some(notice);
                    }
                    if simulation.state.status == SessionStatus::Victory {
                        let _ =
                            record_completions(&mut timed.progress.borrow_mut(), &simulation.state);
                    }
                    let status_changed = previous.status != simulation.state.status;
                    record_presentation_transition(&timed, &previous, &simulation.state);
                    timed.sessions.borrow_mut()[index] = simulation.state;
                    let save_failed = if let Err(error) = save_preview(&timed) {
                        *timed.error.borrow_mut() = Some(format!(
                            "Could not persist this running preview: {error}. Pause or free browser storage, then retry."
                        ));
                        true
                    } else {
                        false
                    };
                    if status_changed || save_failed {
                        let _ = render(&timed);
                    } else {
                        let _ = render_live(&timed);
                    }
                }
            }
        }
    });
    let timer_id = web_sys::window()
        .ok_or_else(|| JsValue::from_str("window unavailable"))?
        .set_interval_with_callback_and_timeout_and_arguments_0(
            timer.as_ref().unchecked_ref(),
            100,
        )?;
    *app.timer.borrow_mut() = Some(timer);
    *app.timer_id.borrow_mut() = Some(timer_id);
    render(&app)?;
    install_animation_loop(&app)?;
    Ok(app)
}

#[wasm_bindgen]
pub fn preview_start() -> Result<(), JsValue> {
    PHASE.with(|phase| *phase.borrow_mut() = "active");
    let doc = document()?;
    if let Some(root) = doc.get_element_by_id("app") {
        let app = create_app(root, Runtime::Preview, "preview-channel".into(), None, None)?;
        ACTIVE.with(|v| *v.borrow_mut() = Some(app));
    }
    Ok(())
}
#[wasm_bindgen]
pub async fn mount(container: Element, context: JsValue) -> Result<SurfaceMount, JsValue> {
    let channel = Reflect::get(&context, &"channelId".into())
        .ok()
        .and_then(|v| v.as_string())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| JsValue::from_str("Brainrot Tower Defense requires a TAP channel scope"))?;
    if channel.trim() != channel
        || channel.chars().count() > 256
        || channel.chars().any(char::is_control)
    {
        return Err(JsValue::from_str("TAP provided an invalid channel scope"));
    }
    let events = Reflect::get(&context, &"events".into())
        .ok()
        .filter(|value| value.is_object())
        .ok_or_else(|| JsValue::from_str("TAP event publisher is unavailable"))?;
    let identity = tap_bridge::user_identity()
        .await
        .map_err(|error| JsValue::from_str(&format!("Cannot authenticate TAP user: {error}")))?;
    if identity.sub.trim().is_empty()
        || identity.sub.chars().count() > 256
        || identity.sub.chars().any(char::is_control)
    {
        return Err(JsValue::from_str(
            "TAP returned an invalid authenticated identity",
        ));
    }
    let display_name = identity
        .name
        .filter(|value| !value.trim().is_empty())
        .or(identity.preferred_username)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "TAP player".into());
    let display_name = normalize_display_name(&display_name);
    let app = create_app(
        container,
        Runtime::Tap,
        channel,
        Some(events),
        Some((PlayerId(identity.sub), display_name)),
    )?;
    ACTIVE.with(|v| *v.borrow_mut() = Some(app.clone()));
    Ok(SurfaceMount {})
}

#[wasm_bindgen]
pub fn set_host_authority(granted: bool) {
    ACTIVE.with(|active| {
        let Some(app) = active.borrow().as_ref().cloned() else {
            return;
        };
        *app.authority.borrow_mut() = granted;
        if granted {
            resume_simulation_clock(&app);
            resume_audio(&app);
            if matches!(app.runtime, Runtime::Tap) {
                load_tap_data(app);
            }
        } else {
            pause_simulation_clock(&app);
            suspend_audio(&app);
            *app.error.borrow_mut() = Some(
                "TAP host authority was revoked. Gameplay and saves are paused until this release is confirmed again."
                    .into(),
            );
            let _ = render(&app);
        }
    });
}
#[wasm_bindgen]
pub struct SurfaceMount {}
#[wasm_bindgen]
impl SurfaceMount {
    pub async fn unmount(&self) -> Result<(), JsValue> {
        let app = ACTIVE.with(|active| active.borrow_mut().take());
        let Some(app) = app else {
            return Ok(());
        };
        stop_simulation_timer(&app);
        stop_animation_loop(&app);
        if let Some(mut subscription) = app.presence_subscription.borrow_mut().take() {
            subscription
                .unsubscribe()
                .map_err(|error| JsValue::from_str(&error.to_string()))?;
        }
        close_audio(&app);
        if matches!(app.runtime, Runtime::Tap) {
            tap_bridge::leave_presence(&app.channel)
                .await
                .map_err(|error| JsValue::from_str(&error.to_string()))?;
        }
        app.root.set_inner_html("");
        Ok(())
    }
}
#[wasm_bindgen(js_name=lifecycle_prepare)]
pub async fn lifecycle_prepare() {
    PHASE.with(|p| *p.borrow_mut() = "prepared");
    ACTIVE.with(|active| {
        if let Some(app) = active.borrow().as_ref() {
            pause_simulation_clock(app);
        }
    });
}
#[wasm_bindgen(js_name=lifecycle_activate)]
pub async fn lifecycle_activate() {
    PHASE.with(|p| *p.borrow_mut() = "active");
    ACTIVE.with(|active| {
        if let Some(app) = active.borrow().as_ref() {
            resume_simulation_clock(app);
        }
    });
}
#[wasm_bindgen(js_name=lifecycle_mount)]
pub async fn lifecycle_mount(_transition: JsValue) {
    PHASE.with(|p| *p.borrow_mut() = "active");
    ACTIVE.with(|active| {
        if let Some(app) = active.borrow().as_ref() {
            resume_simulation_clock(app);
        }
    });
}

#[wasm_bindgen(js_name=lifecycle_pre_pause)]
pub async fn lifecycle_pre_pause(transition: JsValue) -> bool {
    PHASE.with(|phase| *phase.borrow_mut() = "pre-pausing");
    let app = ACTIVE.with(|active| active.borrow().as_ref().cloned());
    let Some(app) = app else {
        return false;
    };
    pause_simulation_clock(&app);
    let mut active_session = app
        .active
        .borrow()
        .and_then(|index| app.sessions.borrow().get(index).cloned());
    if let Some(snapshot) = active_session.as_ref() {
        if snapshot.host == app.player {
            let revision = app
                .session_revisions
                .borrow()
                .get(&snapshot.session_id.0)
                .copied();
            match tap_bridge::save_session(&Runtime::Tap, &app.channel, snapshot, revision).await {
                Ok(next) => {
                    app.session_revisions
                        .borrow_mut()
                        .insert(snapshot.session_id.0.clone(), next);
                }
                Err(error) => {
                    *app.error.borrow_mut() = Some(format!(
                        "Could not persist the active run before pause: {error}"
                    ));
                    let _ = render(&app);
                    PHASE.with(|phase| *phase.borrow_mut() = "active");
                    resume_simulation_clock(&app);
                    return false;
                }
            }
        } else {
            match tap_bridge::load_session(&Runtime::Tap, &app.channel, &snapshot.session_id.0)
                .await
            {
                Ok(stored) => {
                    let Some(canonical) = stored.value else {
                        *app.error.borrow_mut() =
                            Some("The active session no longer exists in TAP storage.".into());
                        PHASE.with(|phase| *phase.borrow_mut() = "active");
                        resume_simulation_clock(&app);
                        return false;
                    };
                    let Ok((canonical, _)) = prepare_loaded_snapshot(canonical, &app.channel)
                    else {
                        *app.error.borrow_mut() =
                            Some("The active TAP session failed checkpoint validation.".into());
                        PHASE.with(|phase| *phase.borrow_mut() = "active");
                        resume_simulation_clock(&app);
                        return false;
                    };
                    if let Some(revision) = stored.revision {
                        app.session_revisions
                            .borrow_mut()
                            .insert(canonical.session_id.0.clone(), revision);
                    }
                    active_session = Some(canonical);
                }
                Err(error) => {
                    *app.error.borrow_mut() = Some(format!(
                        "Could not read the authoritative run before pause: {error}"
                    ));
                    PHASE.with(|phase| *phase.borrow_mut() = "active");
                    resume_simulation_clock(&app);
                    return false;
                }
            }
        }
    }
    let checkpoint = LifecycleCheckpoint {
        schema_version: 1,
        channel_id: app.channel.clone(),
        player_id: app.player.clone(),
        active_session_id: active_session
            .as_ref()
            .map(|snapshot| snapshot.session_id.clone()),
        last_sequence: active_session
            .as_ref()
            .map(|snapshot| snapshot.last_sequence),
    };
    match tap_bridge::save_checkpoint(&transition, &checkpoint).await {
        Ok(()) => {
            if let Some(snapshot) = active_session.as_ref() {
                let mut pending = snapshot.clone();
                queue_snapshot_event(&mut pending, "checkpoint.created");
                let revision = app
                    .session_revisions
                    .borrow()
                    .get(&pending.session_id.0)
                    .copied();
                match tap_bridge::save_session(&Runtime::Tap, &app.channel, &pending, revision)
                    .await
                {
                    Ok(next_revision) => {
                        app.session_revisions
                            .borrow_mut()
                            .insert(pending.session_id.0.clone(), next_revision);
                        if let Some(position) = app
                            .sessions
                            .borrow()
                            .iter()
                            .position(|candidate| candidate.session_id == pending.session_id)
                        {
                            app.sessions.borrow_mut()[position] = pending.clone();
                        }
                        if let Err(error) = deliver_pending_events(&app, &pending).await {
                            app.pending_sessions
                                .borrow_mut()
                                .insert(pending.session_id.0.clone());
                            *app.error.borrow_mut() = Some(format!(
                                "Checkpoint saved; its durable activity delivery is pending: {error}"
                            ));
                            let _ = render(&app);
                        } else {
                            flush_saves(app.clone());
                        }
                    }
                    Err(error) => {
                        *app.error.borrow_mut() = Some(format!(
                            "Checkpoint saved, but its durable activity outbox could not be stored: {error}"
                        ));
                        let _ = render(&app);
                        PHASE.with(|phase| *phase.borrow_mut() = "active");
                        resume_simulation_clock(&app);
                        return false;
                    }
                }
            }
            true
        }
        Err(error) => {
            *app.error.borrow_mut() =
                Some(format!("Could not create lifecycle checkpoint: {error}"));
            let _ = render(&app);
            PHASE.with(|phase| *phase.borrow_mut() = "active");
            resume_simulation_clock(&app);
            false
        }
    }
}

#[wasm_bindgen(js_name=lifecycle_pause)]
pub async fn lifecycle_pause() {
    PHASE.with(|p| *p.borrow_mut() = "paused");
    ACTIVE.with(|active| {
        if let Some(app) = active.borrow().as_ref() {
            pause_simulation_clock(app);
            suspend_audio(app);
            let _ = render(app);
        }
    });
}

#[wasm_bindgen(js_name=lifecycle_pre_resume)]
pub async fn lifecycle_pre_resume(transition: JsValue) -> bool {
    let app = ACTIVE.with(|active| active.borrow().as_ref().cloned());
    let Some(app) = app else {
        return false;
    };
    let checkpoint = match tap_bridge::load_checkpoint::<LifecycleCheckpoint>(&transition).await {
        Ok(checkpoint) => checkpoint,
        Err(error) => {
            *app.error.borrow_mut() = Some(format!("Could not load lifecycle checkpoint: {error}"));
            let _ = render(&app);
            return false;
        }
    };
    if checkpoint.schema_version != 1
        || checkpoint.channel_id != app.channel
        || checkpoint.player_id != app.player
        || checkpoint.active_session_id.is_some() != checkpoint.last_sequence.is_some()
    {
        *app.error.borrow_mut() =
            Some("The lifecycle checkpoint is invalid or belongs to another TAP scope.".into());
        let _ = render(&app);
        return false;
    }
    if let Some(session_id) = checkpoint.active_session_id {
        let stored =
            match tap_bridge::load_session(&Runtime::Tap, &app.channel, &session_id.0).await {
                Ok(stored) => stored,
                Err(error) => {
                    *app.error.borrow_mut() = Some(format!(
                        "Could not restore the authoritative checkpoint session: {error}"
                    ));
                    let _ = render(&app);
                    return false;
                }
            };
        let Some(snapshot) = stored.value else {
            *app.error.borrow_mut() = Some("The checkpoint session no longer exists.".into());
            let _ = render(&app);
            return false;
        };
        let Ok((snapshot, migrated)) = prepare_loaded_snapshot(snapshot, &app.channel) else {
            *app.error.borrow_mut() =
                Some("The authoritative checkpoint session failed content validation.".into());
            let _ = render(&app);
            return false;
        };
        let migration_session_id =
            migrated_snapshot_needs_host_persistence(&snapshot, &app.player, migrated)
                .then(|| snapshot.session_id.0.clone());
        if snapshot.last_sequence < checkpoint.last_sequence.unwrap_or_default() {
            *app.error.borrow_mut() = Some(
                "The authoritative checkpoint session is invalid or older than the checkpoint."
                    .into(),
            );
            let _ = render(&app);
            return false;
        }
        if let Some(revision) = stored.revision {
            app.session_revisions
                .borrow_mut()
                .insert(session_id.0, revision);
        }
        let position = app
            .sessions
            .borrow()
            .iter()
            .position(|candidate| candidate.session_id == snapshot.session_id);
        if let Some(index) = position {
            if app.sessions.borrow()[index].last_sequence <= snapshot.last_sequence {
                app.sessions.borrow_mut()[index] = snapshot;
            }
            *app.active.borrow_mut() = Some(index);
        } else {
            app.sessions.borrow_mut().push(snapshot);
            *app.active.borrow_mut() = Some(app.sessions.borrow().len() - 1);
        }
        if let Some(session_id) = migration_session_id {
            app.pending_sessions.borrow_mut().insert(session_id);
            flush_saves(app.clone());
        }
    }
    let _ = render(&app);
    true
}

#[wasm_bindgen(js_name=lifecycle_resume)]
pub async fn lifecycle_resume() {
    PHASE.with(|p| *p.borrow_mut() = "active");
    ACTIVE.with(|v| {
        if let Some(app) = v.borrow().as_ref() {
            resume_simulation_clock(app);
            resume_audio(app);
            let _ = render(app);
        }
    });
}
#[wasm_bindgen(js_name=lifecycle_unmount)]
pub async fn lifecycle_unmount() {
    PHASE.with(|p| *p.borrow_mut() = "unmounted");
    ACTIVE.with(|active| {
        if let Some(app) = active.borrow().as_ref() {
            pause_simulation_clock(app);
            stop_simulation_timer(app);
            stop_animation_loop(app);
        }
    });
}

#[wasm_bindgen(js_name=lifecycle_deactivate)]
pub async fn lifecycle_deactivate() {
    PHASE.with(|p| *p.borrow_mut() = "deactivated");
    ACTIVE.with(|active| {
        if let Some(app) = active.borrow().as_ref() {
            pause_simulation_clock(app);
            suspend_audio(app);
        }
    });
}

#[wasm_bindgen(js_name=lifecycle_uninstall)]
pub async fn lifecycle_uninstall() {
    ACTIVE.with(|active| {
        if let Some(app) = active.borrow_mut().take() {
            pause_simulation_clock(&app);
            stop_simulation_timer(&app);
            stop_animation_loop(&app);
            close_audio(&app);
            if let Some(mut subscription) = app.presence_subscription.borrow_mut().take() {
                let _ = subscription.unsubscribe();
            }
        }
    });
    PHASE.with(|p| *p.borrow_mut() = "uninstalled");
}

#[cfg(test)]
mod tests {
    use super::*;
    use game_protocol::CompletionCursor;

    fn id(value: &str) -> SessionId {
        SessionId(value.to_string())
    }

    #[test]
    fn fixed_step_clock_accumulates_fractional_timer_delays() {
        let mut clock = FixedStepClock::default();
        clock.restart(1_000.);
        assert_eq!(clock.steps_due(1_040.), 0);
        assert_eq!(clock.steps_due(1_100.), 1);
        assert_eq!(clock.steps_due(1_350.), 2);
        assert_eq!(clock.steps_due(1_400.), 1);
    }

    #[test]
    fn fixed_step_clock_bounds_delayed_callback_catch_up() {
        let mut clock = FixedStepClock::default();
        clock.restart(0.);
        assert_eq!(clock.steps_due(5_000.), MAX_CATCH_UP_STEPS);
        assert_eq!(clock.steps_due(5_100.), 1);
    }

    #[test]
    fn fixed_step_clock_does_not_catch_up_across_a_lifecycle_pause() {
        let mut clock = FixedStepClock::default();
        clock.restart(100.);
        assert_eq!(clock.steps_due(200.), 1);
        clock.reset();
        assert_eq!(clock.steps_due(20_000.), 0);
        assert_eq!(clock.steps_due(20_100.), 1);
    }

    #[test]
    fn presentation_frame_clamps_interpolation_to_its_authoritative_interval() {
        let player = PlayerId("player".into());
        let previous = Simulation::create(
            "channel".into(),
            "Defense".into(),
            player,
            "Player".into(),
            7,
        )
        .state;
        let frame = PresentationFrame {
            session_id: previous.session_id.clone(),
            previous,
            current_tick: 2,
            started_ms: 1_000.,
            duration_ms: 200.,
        };
        assert_eq!(frame.alpha(900.), 0.);
        assert_eq!(frame.alpha(1_100.), 0.5);
        assert_eq!(frame.alpha(1_300.), 1.);
    }

    #[test]
    fn concurrent_channel_creates_merge_without_orphaning_either_game() {
        let remote = ChannelIndex {
            schema_version: 1,
            session_ids: vec![id("remote-game")],
        };
        let candidate = ChannelIndex {
            schema_version: 1,
            session_ids: vec![id("local-game")],
        };
        let desired = HashSet::from(["local-game".to_string()]);
        let locally_known = desired.clone();
        let merged = merge_channel_indexes(remote, &candidate, &desired, &locally_known)
            .expect("valid merge");
        assert_eq!(
            merged.session_ids,
            vec![id("remote-game"), id("local-game")]
        );
    }

    #[test]
    fn channel_merge_removes_a_locally_abandoned_game() {
        let remote = ChannelIndex {
            schema_version: 1,
            session_ids: vec![id("abandoned"), id("remote")],
        };
        let candidate = ChannelIndex {
            schema_version: 1,
            session_ids: vec![],
        };
        let desired = HashSet::new();
        let locally_known = HashSet::from(["abandoned".to_string()]);
        let merged = merge_channel_indexes(remote, &candidate, &desired, &locally_known)
            .expect("valid merge");
        assert_eq!(merged.session_ids, vec![id("remote")]);
    }

    #[test]
    fn concurrent_cooperative_progress_merges_distinct_completed_runs() {
        let player = PlayerId("player".into());
        let mut local = default_progress(player.clone());
        local.cooperative_completions = 1;
        local.completed_sessions = vec![id("run-a")];
        local.completed_cooperative_runs = vec![id("run-a")];
        local.completion_cursors = vec![CompletionCursor {
            session_id: id("session"),
            attempt: 1,
        }];
        let mut remote = default_progress(player);
        remote.cooperative_completions = 1;
        remote.completed_sessions = vec![id("run-b")];
        remote.completed_cooperative_runs = vec![id("run-b")];
        remote.completion_cursors = vec![
            CompletionCursor {
                session_id: id("session"),
                attempt: 3,
            },
            CompletionCursor {
                session_id: id("other-session"),
                attempt: 2,
            },
        ];

        merge_progress(&mut local, &remote);

        assert_eq!(local.cooperative_completions, 2);
        assert_eq!(
            local.completed_cooperative_runs,
            vec![id("run-a"), id("run-b")]
        );
        assert_eq!(local.completed_sessions, vec![id("run-a"), id("run-b")]);
        assert_eq!(
            local.completion_cursors,
            vec![
                CompletionCursor {
                    session_id: id("session"),
                    attempt: 3,
                },
                CompletionCursor {
                    session_id: id("other-session"),
                    attempt: 2,
                },
            ]
        );
    }

    #[test]
    fn durable_event_ids_are_stable_and_replay_safe() {
        let player = PlayerId("player".into());
        let mut snapshot = Simulation::create(
            "channel".into(),
            "Defense".into(),
            player,
            "Player".into(),
            7,
        )
        .state;
        queue_snapshot_event(&mut snapshot, "lobby.created");
        queue_snapshot_event(&mut snapshot, "lobby.created");
        assert_eq!(snapshot.pending_events.len(), 1);
        assert!(snapshot.pending_events[0].id.contains("lobby.created"));
        snapshot.last_sequence = 1;
        queue_snapshot_event(&mut snapshot, "lobby.created");
        assert_eq!(snapshot.pending_events.len(), 2);
        game_core::validate_snapshot(&snapshot, "channel").expect("valid durable outbox");
    }

    #[test]
    fn preview_persistence_round_trips_user_created_state() {
        let player = PlayerId("test-player".into());
        let session = Simulation::create(
            "preview-channel".into(),
            "Test defense".into(),
            player.clone(),
            "Tester".into(),
            42,
        )
        .state;
        let saved = PreviewSave {
            schema_version: 1,
            player_id: player.clone(),
            display_name: "Tester".into(),
            progress: default_progress(player),
            sessions: vec![session],
            master: 80,
            music: 45,
            effects: 75,
            muted: true,
        };
        let encoded = serde_json::to_string(&saved).expect("serialize preview");
        let decoded: PreviewSave = serde_json::from_str(&encoded).expect("load preview");
        assert_eq!(decoded.display_name, "Tester");
        assert_eq!(decoded.sessions.len(), 1);
        assert!(decoded.muted);
    }

    #[test]
    fn only_the_host_repersists_a_migrated_loaded_snapshot() {
        let host = PlayerId("host".into());
        let snapshot = Simulation::create(
            "channel".into(),
            "Defense".into(),
            host.clone(),
            "Host".into(),
            7,
        )
        .state;
        assert!(migrated_snapshot_needs_host_persistence(
            &snapshot, &host, true
        ));
        assert!(!migrated_snapshot_needs_host_persistence(
            &snapshot,
            &PlayerId("spectator".into()),
            true
        ));
        assert!(!migrated_snapshot_needs_host_persistence(
            &snapshot, &host, false
        ));
    }

    #[test]
    fn prior_audio_records_migrate_to_unmuted_default() {
        let player = PlayerId("test-player".into());
        let value = serde_json::json!({
            "schema_version": 1,
            "player_id": player,
            "display_name": "Tester",
            "progress": default_progress(PlayerId("test-player".into())),
            "sessions": [],
            "master": 80,
            "music": 45,
            "effects": 75
        });
        let decoded: PreviewSave = serde_json::from_value(value).expect("migrate preview");
        assert!(!decoded.muted);
    }

    #[test]
    fn call_sign_boundary_rejects_control_characters_by_normalizing_them_out() {
        assert_eq!(normalize_display_name("  Signal\nGhost  "), "SignalGhost");
        assert_eq!(normalize_display_name("   "), "");
        assert_eq!(normalize_display_name(&"x".repeat(60)).chars().count(), 40);
    }

    #[test]
    fn defender_sprite_cells_cover_the_complete_authored_roster() {
        let cells = [
            defender_sprite_index("zip_zapper"),
            defender_sprite_index("caps_lock"),
            defender_sprite_index("buffer_buddy"),
            defender_sprite_index("side_hustler"),
            defender_sprite_index("final_form"),
            defender_sprite_index("deep_scroller"),
        ];
        assert_eq!(
            cells,
            [Some(0), Some(1), Some(2), Some(3), Some(4), Some(5)]
        );
        assert_eq!(defender_sprite_index("unknown"), None);
    }

    #[test]
    fn canvas_controls_share_the_exact_logical_coordinate_transform() {
        assert_eq!(logical_position_percent(0, 0), (0., 0.));
        assert_eq!(logical_position_percent(500, 281), (50., 50.));
        assert_eq!(logical_position_percent(1000, 562), (100., 100.));
    }

    #[test]
    fn battlefield_accessible_text_tracks_the_selected_level() {
        let backyard = battlefield_aria_label(1, false);
        assert!(backyard.contains("Backyard Wi-Fi"));
        assert!(backyard.contains("mailbox"));
        assert!(backyard.contains("garden shed"));

        let school = battlefield_aria_label(2, false);
        assert!(school.contains("School Hallway Rush"));
        assert!(school.contains("two left corridors"));
        assert!(school.contains("east junction"));
        assert!(school.contains("server room"));

        let placement = battlefield_aria_label(5, true);
        assert!(placement.contains("Final Feed"));
        assert!(placement.contains("open stone pedestal"));
    }

    #[test]
    fn victory_action_states_cover_authority_pending_and_final_boundaries() {
        let enabled = victory_actions_availability(true, true, false, 1, 5);
        assert_eq!(
            enabled,
            VictoryActionsAvailability {
                restart: VictoryActionAvailability::Enabled,
                advance: VictoryActionAvailability::Enabled,
            }
        );

        let spectator = victory_actions_availability(false, true, false, 1, 5);
        assert_eq!(spectator.restart, VictoryActionAvailability::HostOnly);
        assert_eq!(spectator.advance, VictoryActionAvailability::HostOnly);

        let pending = victory_actions_availability(true, true, true, 1, 5);
        assert_eq!(pending.restart, VictoryActionAvailability::Pending);
        assert_eq!(pending.advance, VictoryActionAvailability::Pending);

        let unavailable = victory_actions_availability(true, false, false, 1, 5);
        assert_eq!(
            unavailable.restart,
            VictoryActionAvailability::AuthorityUnavailable
        );
        assert_eq!(
            unavailable.advance,
            VictoryActionAvailability::AuthorityUnavailable
        );

        let final_level = victory_actions_availability(true, true, false, 5, 5);
        assert_eq!(final_level.restart, VictoryActionAvailability::Enabled);
        assert_eq!(final_level.advance, VictoryActionAvailability::FinalLevel);
    }

    #[test]
    fn victory_live_summary_explains_host_and_spectator_next_steps() {
        let host = battlefield_live_summary(12, 5, SessionStatus::Victory, true);
        assert!(host.contains("Every wave cleared"));
        assert!(host.contains("Victory controls are shown below"));

        let spectator = battlefield_live_summary(12, 5, SessionStatus::Victory, false);
        assert!(spectator.contains("Every wave cleared"));
        assert!(spectator.contains("Waiting for the host"));
    }

    #[test]
    fn embedded_styles_refresh_stale_mounts_and_position_victory_actions() {
        assert!(!embedded_styles_are_current(None));
        assert!(!embedded_styles_are_current(Some("/* previous release */")));
        assert!(embedded_styles_are_current(Some(EMBEDDED_STYLES)));

        let victory_rule = EMBEDDED_STYLES
            .split_once(".victory-actions {")
            .and_then(|(_, rules)| rules.split_once('}'))
            .map(|(rules, _)| rules)
            .expect("victory action positioning rule");
        assert!(victory_rule.contains("position: absolute"));
        assert!(victory_rule.contains("pointer-events: auto"));
        assert!(victory_rule.contains("z-index: 8"));
    }

    #[test]
    fn placement_completion_focus_targets_are_stable_across_authoritative_renders() {
        assert_eq!(
            placement_completion_focus_id(&CommandKind::Place {
                defender: "zip_zapper".into(),
                x: 10,
                y: 20,
            }),
            Some("btd-game-stage".into())
        );
        assert_eq!(
            placement_completion_focus_id(&CommandKind::Move {
                entity_id: EntityId("tower-1".into()),
                x: 30,
                y: 40,
            }),
            Some("btd-defender-hotspot-tower-1".into())
        );
        assert_eq!(
            placement_completion_focus_id(&CommandKind::Upgrade {
                entity_id: EntityId("tower-1".into()),
                path: "authored-path".into(),
            }),
            Some("btd-defender-inspector".into())
        );
        assert_eq!(placement_completion_focus_id(&CommandKind::Pause), None);
    }

    #[test]
    fn defender_shop_states_explain_every_disabled_boundary() {
        let mut economy = LiveEconomyState {
            resources: 90,
            open_pads: 1,
            has_player_slot: true,
            status: SessionStatus::BetweenWaves,
            has_authority: true,
            authoritative_command_pending: false,
        };
        assert_eq!(
            economy.defender_state(false, true, 90),
            DefenderShopState::Ready
        );
        assert_eq!(
            economy.defender_state(false, false, 90),
            DefenderShopState::Locked
        );
        economy.resources = 89;
        assert_eq!(
            economy.defender_state(false, true, 90),
            DefenderShopState::Unaffordable
        );
        economy.resources = 90;
        economy.open_pads = 0;
        assert_eq!(
            economy.defender_state(false, true, 90),
            DefenderShopState::NoOpenPad
        );
        economy.open_pads = 1;
        economy.has_player_slot = false;
        assert_eq!(
            economy.defender_state(false, true, 90),
            DefenderShopState::PlayerSlotRequired
        );
        economy.has_player_slot = true;
        economy.status = SessionStatus::Paused;
        assert_eq!(
            economy.defender_state(false, true, 90),
            DefenderShopState::StatusUnavailable
        );
        economy.status = SessionStatus::Running;
        economy.has_authority = false;
        assert_eq!(
            economy.defender_state(false, true, 90),
            DefenderShopState::AuthorityUnavailable
        );
        economy.has_authority = true;
        economy.authoritative_command_pending = true;
        assert_eq!(
            economy.defender_state(false, true, 90),
            DefenderShopState::AuthoritativeActionPending
        );
        assert_eq!(
            economy.defender_state(true, false, u32::MAX),
            DefenderShopState::Selected
        );

        for status in [SessionStatus::BetweenWaves, SessionStatus::Running] {
            economy.status = status;
            economy.authoritative_command_pending = false;
            assert_eq!(
                economy.defender_state(false, true, 90),
                DefenderShopState::Ready
            );
        }
        for status in [
            SessionStatus::Lobby,
            SessionStatus::Paused,
            SessionStatus::Victory,
            SessionStatus::Defeat,
            SessionStatus::Abandoned,
        ] {
            economy.status = status;
            assert_eq!(
                economy.defender_state(false, true, 90),
                DefenderShopState::StatusUnavailable
            );
        }
    }

    #[test]
    fn only_active_host_and_player_members_can_manage_defenders() {
        let mut member = Member {
            player_id: PlayerId("member".into()),
            display_name: "Runtime member".into(),
            role: MemberRole::Host,
            slot: Some(0),
            ready: false,
            resources: 171,
            contribution: 0,
        };
        assert!(member_can_manage_defenders(Some(&member)));
        member.role = MemberRole::Player;
        assert!(member_can_manage_defenders(Some(&member)));
        member.role = MemberRole::Spectator;
        assert!(!member_can_manage_defenders(Some(&member)));
        member.role = MemberRole::Disconnected;
        assert!(!member_can_manage_defenders(Some(&member)));
        member.role = MemberRole::Player;
        member.slot = None;
        assert!(!member_can_manage_defenders(Some(&member)));
        assert!(!member_can_manage_defenders(None));
    }

    #[test]
    fn live_economy_recomputes_every_shop_affordability_boundary() {
        let definitions = defenders();
        let zip = definitions
            .iter()
            .find(|definition| definition.id == "zip_zapper")
            .expect("zip zapper definition");
        let caps = definitions
            .iter()
            .find(|definition| definition.id == "caps_lock")
            .expect("caps lock definition");
        let buffer = definitions
            .iter()
            .find(|definition| definition.id == "buffer_buddy")
            .expect("buffer buddy definition");
        assert_eq!((zip.cost, caps.cost, buffer.cost), (90, 140, 110));

        let mut economy = LiveEconomyState {
            resources: 89,
            open_pads: 1,
            has_player_slot: true,
            status: SessionStatus::Running,
            has_authority: true,
            authoritative_command_pending: false,
        };
        let states = |economy: LiveEconomyState| {
            [
                economy.defender_state(false, true, zip.cost),
                economy.defender_state(false, true, caps.cost),
                economy.defender_state(false, true, buffer.cost),
            ]
        };

        assert_eq!(states(economy), [DefenderShopState::Unaffordable; 3]);
        economy.resources = 90;
        assert_eq!(
            states(economy),
            [
                DefenderShopState::Ready,
                DefenderShopState::Unaffordable,
                DefenderShopState::Unaffordable,
            ]
        );
        economy.resources = 109;
        assert_eq!(states(economy)[2], DefenderShopState::Unaffordable);
        economy.resources = 110;
        assert_eq!(states(economy)[2], DefenderShopState::Ready);
        economy.resources = 139;
        assert_eq!(states(economy)[1], DefenderShopState::Unaffordable);
        economy.resources = 140;
        assert_eq!(states(economy)[1], DefenderShopState::Ready);
        economy.resources = 171;
        assert_eq!(states(economy), [DefenderShopState::Ready; 3]);

        economy.resources = 109;
        assert_eq!(states(economy)[2], DefenderShopState::Unaffordable);
        economy.resources = 171;
        economy.authoritative_command_pending = true;
        assert_eq!(
            states(economy),
            [DefenderShopState::AuthoritativeActionPending; 3]
        );
        economy.authoritative_command_pending = false;
        assert_eq!(states(economy), [DefenderShopState::Ready; 3]);
        economy.open_pads = 0;
        assert_eq!(states(economy), [DefenderShopState::NoOpenPad; 3]);
    }

    #[test]
    fn defender_shop_presentation_tracks_live_resource_debits_and_pending_actions() {
        let definition = defenders()
            .into_iter()
            .find(|definition| definition.id == "caps_lock")
            .expect("caps lock definition");
        let mut economy = LiveEconomyState {
            resources: 171,
            open_pads: 1,
            has_player_slot: true,
            status: SessionStatus::Running,
            has_authority: true,
            authoritative_command_pending: false,
        };

        let ready = defender_shop_presentation(&definition, false, true, false, economy);
        assert_eq!(ready.state, DefenderShopState::Ready);
        assert_eq!(ready.state.data_value(), "ready");
        assert!(!ready.disabled);
        assert_eq!(
            ready.description,
            "Caps Lock, Area burst, costs 140 resources. Ready to place."
        );

        economy.resources = 30;
        let debited = defender_shop_presentation(&definition, false, true, false, economy);
        assert_eq!(debited.state, DefenderShopState::Unaffordable);
        assert_eq!(debited.state.data_value(), "unaffordable");
        assert!(debited.disabled);
        assert!(debited.description.contains("Not enough resources"));

        economy.resources = 171;
        economy.authoritative_command_pending = true;
        let pending = defender_shop_presentation(&definition, false, true, false, economy);
        assert_eq!(pending.state, DefenderShopState::AuthoritativeActionPending);
        assert_eq!(pending.state.data_value(), "pending");
        assert!(pending.disabled);
        assert!(pending.description.contains("pending authoritative action"));
    }

    #[test]
    fn base_defender_offers_both_authored_first_tiers() {
        let definition = defenders().into_iter().next().expect("authored defender");
        assert_eq!(MAX_DEFENDER_LEVEL, 5);

        for path in definition.upgrade_paths {
            let authored_path = upgrade_path(definition.id, path).expect("authored upgrade path");
            assert_eq!(
                upgrade_branch_state(1, "", path),
                UpgradeBranchState::Available
            );
            assert_eq!(completed_upgrade_tiers(1, "", path), 0);
            let next = next_upgrade_tier(definition.id, path, 1).expect("first tier");
            assert_eq!(next, authored_path.tiers[0]);
            assert!(!next.name.trim().is_empty());
            assert!(!next.effect.trim().is_empty());
            assert!(next.cost > 0);
        }
    }

    #[test]
    fn committed_defender_keeps_only_its_authored_branch_actionable() {
        let definition = defenders().into_iter().next().expect("authored defender");
        let chosen = definition.upgrade_paths[0];
        let locked = definition.upgrade_paths[1];
        let authored_path = upgrade_path(definition.id, chosen).expect("authored upgrade path");

        assert_eq!(
            upgrade_branch_state(2, chosen, chosen),
            UpgradeBranchState::Committed
        );
        assert_eq!(completed_upgrade_tiers(2, chosen, chosen), 1);
        assert_eq!(
            next_upgrade_tier(definition.id, chosen, 2),
            Some(authored_path.tiers[1])
        );
        assert_eq!(
            upgrade_branch_state(2, chosen, locked),
            UpgradeBranchState::Locked
        );
        assert_eq!(completed_upgrade_tiers(2, chosen, locked), 0);
    }

    #[test]
    fn unaffordable_upgrade_exposes_the_exact_resource_shortfall() {
        let definition = defenders().into_iter().next().expect("authored defender");
        let path = definition.upgrade_paths[0];
        let next = next_upgrade_tier(definition.id, path, 1).expect("first tier");

        assert_eq!(
            upgrade_disabled_reason(
                UpgradeBranchState::Available,
                SessionStatus::BetweenWaves,
                true,
                true,
                false,
                next.cost.saturating_sub(1),
                next.cost,
            ),
            Some("Need 1 more resources".into())
        );
        assert_eq!(
            upgrade_disabled_reason(
                UpgradeBranchState::Available,
                SessionStatus::BetweenWaves,
                true,
                true,
                false,
                next.cost,
                next.cost,
            ),
            None
        );
    }

    #[test]
    fn pending_authoritative_action_keeps_upgrade_controls_disabled() {
        assert_eq!(
            upgrade_disabled_reason(
                UpgradeBranchState::Available,
                SessionStatus::Running,
                true,
                true,
                true,
                u32::MAX,
                1,
            ),
            Some("Wait for the pending authoritative action to synchronize".into())
        );
    }

    #[test]
    fn same_command_id_with_a_substituted_payload_is_never_reaccepted() {
        let player = PlayerId("player".into());
        let mut simulation = Simulation::create(
            "channel".into(),
            "Defense".into(),
            player.clone(),
            "Player".into(),
            7,
        );
        let original = PlayerCommand {
            schema_version: 1,
            id: CommandId("command-1".into()),
            player_id: player.clone(),
            expected_sequence: 0,
            kind: CommandKind::Ready { ready: true },
        };
        let accepted = simulation
            .apply(&original, &default_progress(player))
            .expect("original command");
        let mut substituted = original.clone();
        substituted.kind = CommandKind::Ready { ready: false };

        let exact_replay = processed_command_acknowledgement(&simulation.state, &original)
            .expect("processed receipt");
        assert!(exact_replay.accepted);
        let substituted_replay = processed_command_acknowledgement(&simulation.state, &substituted)
            .expect("processed command ID");
        assert!(!substituted_replay.accepted);
        assert!(
            substituted_replay
                .reason
                .as_deref()
                .is_some_and(|reason| reason.contains("substitution rejected"))
        );
        let rebound = acknowledgement_for_queue_entry(&substituted, &accepted);
        assert!(!rebound.accepted);
    }

    #[test]
    fn persisted_ack_waits_for_matching_authoritative_receipt() {
        let player = PlayerId("player".into());
        let initial = Simulation::create(
            "channel".into(),
            "Defense".into(),
            player.clone(),
            "Player".into(),
            7,
        );
        let command = PlayerCommand {
            schema_version: 1,
            id: CommandId("command-1".into()),
            player_id: player.clone(),
            expected_sequence: 0,
            kind: CommandKind::Ready { ready: true },
        };
        let mut authoritative = initial.clone();
        let acknowledgement = authoritative
            .apply(&command, &default_progress(player))
            .expect("accepted command");
        let entry = QueuedCommand {
            command: command.clone(),
            acknowledgement: Some(acknowledgement.clone()),
        };

        assert_eq!(
            reconcile_persisted_ack(&command, &entry, &initial.state),
            PersistedAckReconciliation::AwaitingAuthoritativeState
        );
        assert_eq!(
            reconcile_persisted_ack(&command, &entry, &authoritative.state),
            PersistedAckReconciliation::Reconciled
        );

        let mut missing_receipt = authoritative.state.clone();
        missing_receipt.processed_command_receipts.clear();
        assert_eq!(
            reconcile_persisted_ack(&command, &entry, &missing_receipt),
            PersistedAckReconciliation::MissingAuthoritativeResult
        );

        let mut legacy_entry = entry.clone();
        legacy_entry
            .acknowledgement
            .as_mut()
            .expect("acknowledgement")
            .command_fingerprint = None;
        assert_eq!(
            reconcile_persisted_ack(&command, &legacy_entry, &authoritative.state),
            PersistedAckReconciliation::LegacyUnbound
        );

        let mut legacy_json = serde_json::to_value(&authoritative.state).expect("snapshot JSON");
        legacy_json
            .as_object_mut()
            .expect("snapshot object")
            .remove("processed_command_receipts");
        let legacy_snapshot: SessionSnapshot =
            serde_json::from_value(legacy_json).expect("legacy snapshot");
        assert!(legacy_snapshot.processed_command_receipts.is_empty());
    }

    #[test]
    fn wave_bonus_notice_requires_a_proven_running_transition() {
        let player = PlayerId("player".into());
        let mut previous = Simulation::create(
            "channel".into(),
            "Defense".into(),
            player,
            "Player".into(),
            7,
        )
        .state;
        previous.status = SessionStatus::Running;
        previous.wave = 2;
        previous.members[0].resources = 25;
        let mut paid = previous.clone();
        paid.status = SessionStatus::BetweenWaves;
        paid.members[0].resources += WAVE_CLEAR_BONUS;

        assert!(
            observed_wave_clear_bonus(&previous, &paid)
                .is_some_and(|notice| notice.contains("non-final-wave bonus"))
        );
        let mut unproven = paid.clone();
        unproven.members[0].resources -= 1;
        assert_eq!(observed_wave_clear_bonus(&previous, &unproven), None);
        assert_eq!(observed_wave_clear_bonus(&paid, &paid), None);
    }

    #[test]
    fn maxed_defender_reports_all_tiers_without_a_next_purchase() {
        let definition = defenders().into_iter().next().expect("authored defender");
        let chosen = definition.upgrade_paths[0];
        let locked = definition.upgrade_paths[1];

        assert_eq!(
            upgrade_branch_state(MAX_DEFENDER_LEVEL, chosen, chosen),
            UpgradeBranchState::Maxed
        );
        assert_eq!(
            completed_upgrade_tiers(MAX_DEFENDER_LEVEL, chosen, chosen),
            MAX_DEFENDER_LEVEL - 1
        );
        assert_eq!(
            next_upgrade_tier(definition.id, chosen, MAX_DEFENDER_LEVEL),
            None
        );
        assert_eq!(
            upgrade_branch_state(MAX_DEFENDER_LEVEL, chosen, locked),
            UpgradeBranchState::Locked
        );
        assert_eq!(
            upgrade_disabled_reason(
                UpgradeBranchState::Maxed,
                SessionStatus::Running,
                true,
                true,
                false,
                u32::MAX,
                0,
            ),
            Some("This defender is already at max level".into())
        );
    }

    #[test]
    fn upgrade_styles_keep_two_branches_in_the_in_canvas_inspector() {
        assert!(
            UPGRADE_INSPECTOR_STYLES.contains("grid-template-columns: repeat(2, minmax(0, 1fr))")
        );
        assert!(UPGRADE_INSPECTOR_STYLES.contains(".upgrade-tier-progress"));
        assert!(UPGRADE_INSPECTOR_STYLES.contains(".upgrade-disabled-reason"));
        assert!(UPGRADE_INSPECTOR_STYLES.contains(".game-stage:has(.game-hud.has-inspector)"));
    }
}
