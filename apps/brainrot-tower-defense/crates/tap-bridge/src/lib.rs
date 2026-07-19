//! Typed calls into the host-injected TAP SDK; no packaged-mode browser fallback.
use game_protocol::{AudioSettings, ChannelIndex, CommandQueue, Progress, SessionSnapshot};
use js_sys::{Function, Object, Promise, Reflect, Symbol};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::collections::HashSet;
use thiserror::Error;
use wasm_bindgen::{JsCast, JsValue, closure::Closure};
use wasm_bindgen_futures::JsFuture;

/// The presence resource declared by this package's TAP manifest.
pub const PRESENCE_NAMESPACE: &str = "brainrot-td";
const MAX_PRESENCE_ROOM_CHARS: usize = 256;
const MAX_PRESENCE_JSON_BYTES: usize = 16 * 1024;

#[derive(Debug, Error)]
pub enum BridgeError {
    #[error("TAP SDK is unavailable")]
    Unavailable,
    #[error("TAP operation failed: {0}")]
    Operation(String),
    #[error("invalid TAP response: {0}")]
    Invalid(String),
    #[error("storage conflict")]
    Conflict,
}
#[derive(Clone, Debug)]
pub struct Stored<T> {
    pub value: Option<T>,
    pub revision: Option<u64>,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserIdentity {
    pub sub: String,
    pub name: Option<String>,
    pub preferred_username: Option<String>,
}

/// One host-stamped participant in a TAP presence snapshot.
///
/// `participant_id` and `display_name` come from the host. The participant's
/// `state` is app-authored ephemeral JSON and must not be treated as identity
/// or authorization evidence.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceParticipant<State> {
    pub participant_id: String,
    pub display_name: String,
    pub state: State,
    pub updated_at_ms: u64,
}

/// A typed snapshot returned by TAP presence joins, updates, and subscriptions.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceSnapshot<State> {
    pub namespace: String,
    pub room: String,
    pub self_participant_id: String,
    pub participants: Vec<PresenceParticipant<State>>,
}

/// A live TAP presence subscription.
///
/// Keep this value alive for as long as updates are needed. Call
/// [`PresenceSubscription::unsubscribe`] during surface teardown; dropping the
/// value also unregisters the listener on a best-effort basis.
#[must_use = "dropping the subscription immediately unregisters its listener"]
pub struct PresenceSubscription {
    unsubscribe: Option<Function>,
    listener: Option<Closure<dyn FnMut(JsValue)>>,
}

impl PresenceSubscription {
    /// Returns whether this handle still owns an active host listener.
    #[must_use]
    pub fn is_active(&self) -> bool {
        self.unsubscribe.is_some()
    }

    /// Unregisters the host listener. Calling this more than once is harmless.
    ///
    /// # Errors
    ///
    /// Returns [`BridgeError::Operation`] if the SDK's unsubscribe callback
    /// throws. In that case the handle remains active so the caller may retry.
    pub fn unsubscribe(&mut self) -> Result<(), BridgeError> {
        let Some(unsubscribe) = self.unsubscribe.as_ref() else {
            return Ok(());
        };
        unsubscribe
            .call0(&JsValue::UNDEFINED)
            .map_err(|error| BridgeError::Operation(format!("{error:?}")))?;
        self.unsubscribe = None;
        self.listener = None;
        Ok(())
    }
}

impl Drop for PresenceSubscription {
    fn drop(&mut self) {
        if self.unsubscribe().is_err()
            && let Some(listener) = self.listener.take()
        {
            // If the host retained the callback after unsubscribe threw, a
            // leaked live closure is safer than a retained pointer to a freed
            // wasm closure. Explicit teardown still reports the failure.
            listener.forget();
        }
    }
}
fn sdk() -> Result<JsValue, BridgeError> {
    let symbol = Symbol::for_("tap.internal.v1");
    Reflect::get(&js_sys::global(), &symbol.into())
        .map_err(|_| BridgeError::Unavailable)
        .and_then(|v| {
            if v.is_object() {
                Ok(v)
            } else {
                Err(BridgeError::Unavailable)
            }
        })
}
fn object(entries: &[(&str, JsValue)]) -> Result<Object, BridgeError> {
    let o = Object::new();
    for (k, v) in entries {
        Reflect::set(&o, &JsValue::from_str(k), v)
            .map_err(|e| BridgeError::Operation(format!("{e:?}")))?;
    }
    Ok(o)
}
async fn invoke(target: &JsValue, name: &str, arg: &JsValue) -> Result<JsValue, BridgeError> {
    let f = Reflect::get(target, &JsValue::from_str(name))
        .map_err(|_| BridgeError::Unavailable)?
        .dyn_into::<Function>()
        .map_err(|_| BridgeError::Unavailable)?;
    let value = f
        .call1(target, arg)
        .map_err(|e| BridgeError::Operation(format!("{e:?}")))?;
    if value.is_instance_of::<Promise>() {
        JsFuture::from(
            value
                .dyn_into::<Promise>()
                .map_err(|_| BridgeError::Unavailable)?,
        )
        .await
        .map_err(|e| BridgeError::Operation(format!("{e:?}")))
    } else {
        Ok(value)
    }
}
async fn invoke_two(
    target: &JsValue,
    name: &str,
    first: &JsValue,
    second: &JsValue,
) -> Result<JsValue, BridgeError> {
    let function = Reflect::get(target, &JsValue::from_str(name))
        .map_err(|_| BridgeError::Unavailable)?
        .dyn_into::<Function>()
        .map_err(|_| BridgeError::Unavailable)?;
    let value = function
        .call2(target, first, second)
        .map_err(|error| BridgeError::Operation(format!("{error:?}")))?;
    if value.is_instance_of::<Promise>() {
        JsFuture::from(
            value
                .dyn_into::<Promise>()
                .map_err(|_| BridgeError::Unavailable)?,
        )
        .await
        .map_err(|error| BridgeError::Operation(format!("{error:?}")))
    } else {
        Ok(value)
    }
}
fn api(name: &str) -> Result<JsValue, BridgeError> {
    Reflect::get(&sdk()?, &JsValue::from_str(name)).map_err(|_| BridgeError::Unavailable)
}
fn encode<T: Serialize>(value: &T) -> Result<JsValue, BridgeError> {
    serde_json::to_string(value)
        .map(|json| JsValue::from_str(&json))
        .map_err(|e| BridgeError::Invalid(e.to_string()))
}
fn decode<T: DeserializeOwned>(value: &JsValue) -> Result<T, BridgeError> {
    let json = js_sys::JSON::stringify(value)
        .map_err(|e| BridgeError::Invalid(format!("{e:?}")))?
        .as_string()
        .ok_or_else(|| BridgeError::Invalid("non-JSON value".into()))?;
    serde_json::from_str(&json).map_err(|e| BridgeError::Invalid(e.to_string()))
}

fn validate_partition(value: &str, maximum_chars: usize, label: &str) -> Result<(), BridgeError> {
    let contains_disallowed_control = value
        .chars()
        .any(|character| matches!(character, '\u{0000}'..='\u{001f}' | '\u{007f}'..='\u{009f}'));
    if value.is_empty()
        || value.trim() != value
        || value.chars().count() > maximum_chars
        || contains_disallowed_control
    {
        return Err(BridgeError::Invalid(format!("invalid {label}")));
    }
    Ok(())
}

fn serialize_presence_state<State: Serialize>(state: &State) -> Result<String, BridgeError> {
    let json = serde_json::to_string(state)
        .map_err(|error| BridgeError::Invalid(format!("presence state: {error}")))?;
    if json.len() > MAX_PRESENCE_JSON_BYTES {
        return Err(BridgeError::Invalid(
            "presence state exceeds 16384 bytes".into(),
        ));
    }
    Ok(json)
}

fn encode_presence_state<State: Serialize>(state: &State) -> Result<JsValue, BridgeError> {
    let json = serialize_presence_state(state)?;
    js_sys::JSON::parse(&json).map_err(|error| BridgeError::Invalid(format!("{error:?}")))
}

fn validate_js_presence_state(state: &JsValue) -> Result<(), BridgeError> {
    let json = js_sys::JSON::stringify(state)
        .map_err(|error| BridgeError::Invalid(format!("presence state: {error:?}")))?
        .as_string()
        .ok_or_else(|| BridgeError::Invalid("presence state is not JSON serializable".into()))?;
    if json.len() > MAX_PRESENCE_JSON_BYTES {
        return Err(BridgeError::Invalid(
            "presence state exceeds 16384 bytes".into(),
        ));
    }
    Ok(())
}

fn presence_update_options<State: Serialize>(
    room: &str,
    state: &State,
) -> Result<Object, BridgeError> {
    validate_partition(room, MAX_PRESENCE_ROOM_CHARS, "presence room")?;
    object(&[
        ("namespace", PRESENCE_NAMESPACE.into()),
        ("room", room.into()),
        ("state", encode_presence_state(state)?),
    ])
}

fn presence_address(room: &str) -> Result<Object, BridgeError> {
    validate_partition(room, MAX_PRESENCE_ROOM_CHARS, "presence room")?;
    object(&[
        ("namespace", PRESENCE_NAMESPACE.into()),
        ("room", room.into()),
    ])
}

fn validate_presence_snapshot<State>(
    snapshot: &PresenceSnapshot<State>,
    expected_room: &str,
) -> Result<(), BridgeError> {
    if snapshot.namespace != PRESENCE_NAMESPACE {
        return Err(BridgeError::Invalid(
            "presence snapshot namespace does not match the package resource".into(),
        ));
    }
    if snapshot.room != expected_room {
        return Err(BridgeError::Invalid(
            "presence snapshot room does not match the subscription".into(),
        ));
    }
    validate_partition(
        &snapshot.room,
        MAX_PRESENCE_ROOM_CHARS,
        "presence snapshot room",
    )?;

    let mut participant_ids = HashSet::with_capacity(snapshot.participants.len());
    for participant in &snapshot.participants {
        if participant.participant_id.trim().is_empty() {
            return Err(BridgeError::Invalid(
                "presence participant has no host identity".into(),
            ));
        }
        if !participant_ids.insert(participant.participant_id.as_str()) {
            return Err(BridgeError::Invalid(
                "presence snapshot contains duplicate participants".into(),
            ));
        }
    }
    Ok(())
}

fn decode_presence_snapshot<State: DeserializeOwned>(
    value: &JsValue,
    expected_room: &str,
) -> Result<PresenceSnapshot<State>, BridgeError> {
    let snapshot = decode(value)?;
    validate_presence_snapshot(&snapshot, expected_room)?;
    Ok(snapshot)
}

pub async fn get<T: DeserializeOwned>(
    namespace: &str,
    key: &str,
) -> Result<Stored<T>, BridgeError> {
    let storage = api("storage")?;
    let arg = object(&[("namespace", namespace.into()), ("key", key.into())])?;
    let value = invoke(&storage, "get", &arg.into()).await?;
    let revision = Reflect::get(&value, &"revision".into())
        .ok()
        .and_then(|v| v.as_f64())
        .map(|n| n as u64);
    let raw = Reflect::get(&value, &"value".into())
        .map_err(|_| BridgeError::Invalid("missing value".into()))?;
    let parsed = if raw.is_null() || raw.is_undefined() {
        None
    } else {
        Some(decode(&raw)?)
    };
    Ok(Stored {
        value: parsed,
        revision,
    })
}
pub async fn set<T: Serialize>(
    namespace: &str,
    key: &str,
    value: &T,
    revision: Option<u64>,
) -> Result<u64, BridgeError> {
    let storage = api("storage")?;
    let raw = encode(value)?;
    let parsed = js_sys::JSON::parse(raw.as_string().as_deref().unwrap_or("null"))
        .map_err(|e| BridgeError::Invalid(format!("{e:?}")))?;
    let rev = revision.map_or(JsValue::NULL, |r| JsValue::from_f64(r as f64));
    let arg = object(&[
        ("namespace", namespace.into()),
        ("key", key.into()),
        ("value", parsed),
        ("expectedRevision", rev),
    ])?;
    let result = invoke(&storage, "set", &arg.into()).await.map_err(|e| {
        if e.to_string().to_lowercase().contains("revision") {
            BridgeError::Conflict
        } else {
            e
        }
    })?;
    Reflect::get(&result, &"revision".into())
        .ok()
        .and_then(|v| v.as_f64())
        .map(|n| n as u64)
        .ok_or_else(|| BridgeError::Invalid("missing revision".into()))
}
pub async fn join_presence(room: &str, state: &JsValue) -> Result<JsValue, BridgeError> {
    let presence = api("presence")?;
    validate_partition(room, MAX_PRESENCE_ROOM_CHARS, "presence room")?;
    validate_js_presence_state(state)?;
    let arg = object(&[
        ("namespace", PRESENCE_NAMESPACE.into()),
        ("room", room.into()),
        ("state", state.clone()),
    ])?;
    invoke(&presence, "join", &arg.into()).await
}

/// Joins the package presence room with typed ephemeral state.
///
/// Participant identity in the returned snapshot is host-stamped; participant
/// state is not trusted identity or authorization data.
///
/// # Errors
///
/// Returns an error for invalid room/state input, an unavailable SDK, a failed
/// host operation, or a malformed/out-of-scope snapshot.
pub async fn join_presence_typed<State>(
    room: &str,
    state: &State,
) -> Result<PresenceSnapshot<State>, BridgeError>
where
    State: Serialize + DeserializeOwned,
{
    let presence = api("presence")?;
    let options = presence_update_options(room, state)?;
    let value = invoke(&presence, "join", &options.into()).await?;
    decode_presence_snapshot(&value, room)
}

/// Updates typed ephemeral state for an already joined package presence room.
///
/// # Errors
///
/// Returns an error for invalid room/state input, an unavailable SDK, a failed
/// host operation, or a malformed/out-of-scope snapshot. TAP rejects updates
/// when the surface has not joined the room.
pub async fn update_presence<State>(
    room: &str,
    state: &State,
) -> Result<PresenceSnapshot<State>, BridgeError>
where
    State: Serialize + DeserializeOwned,
{
    let presence = api("presence")?;
    let options = presence_update_options(room, state)?;
    let value = invoke(&presence, "update", &options.into()).await?;
    decode_presence_snapshot(&value, room)
}

/// Subscribes to typed presence snapshots for a package room.
///
/// Decode and scope-validation errors are delivered to `listener` instead of
/// being swallowed. The SDK subscription itself is synchronous, matching the
/// installed `0.2.0` declaration.
///
/// # Errors
///
/// Returns an error when the room is invalid, the SDK is unavailable, or the
/// SDK does not return its required unsubscribe function.
pub fn subscribe_presence<State, Listener>(
    room: &str,
    mut listener: Listener,
) -> Result<PresenceSubscription, BridgeError>
where
    State: DeserializeOwned + 'static,
    Listener: FnMut(Result<PresenceSnapshot<State>, BridgeError>) + 'static,
{
    let presence = api("presence")?;
    let address = presence_address(room)?;
    let expected_room = room.to_owned();
    let callback = Closure::<dyn FnMut(JsValue)>::new(move |value| {
        listener(decode_presence_snapshot(&value, &expected_room));
    });
    let subscribe = Reflect::get(&presence, &JsValue::from_str("subscribe"))
        .map_err(|_| BridgeError::Unavailable)?
        .dyn_into::<Function>()
        .map_err(|_| BridgeError::Unavailable)?;
    let result = subscribe
        .call2(&presence, &address, callback.as_ref().unchecked_ref())
        .map_err(|error| BridgeError::Operation(format!("{error:?}")))?;
    match result.dyn_into::<Function>() {
        Ok(unsubscribe) => Ok(PresenceSubscription {
            unsubscribe: Some(unsubscribe),
            listener: Some(callback),
        }),
        Err(_) => {
            // The public SDK contract requires an unsubscribe function. If a
            // malformed host retained our callback anyway, keep it callable.
            callback.forget();
            Err(BridgeError::Invalid(
                "presence subscription returned no unsubscribe function".into(),
            ))
        }
    }
}

pub async fn leave_presence(room: &str) -> Result<(), BridgeError> {
    let presence = api("presence")?;
    let arg = presence_address(room)?;
    invoke(&presence, "leave", &arg.into()).await.map(|_| ())
}
pub async fn publish(events: &JsValue, name: &str, payload: &JsValue) -> Result<(), BridgeError> {
    let function = Reflect::get(events, &JsValue::from_str("publish"))
        .map_err(|_| BridgeError::Unavailable)?
        .dyn_into::<Function>()
        .map_err(|_| BridgeError::Unavailable)?;
    let value = function
        .call2(events, &JsValue::from_str(name), payload)
        .map_err(|error| BridgeError::Operation(format!("{error:?}")))?;
    if value.is_instance_of::<Promise>() {
        JsFuture::from(
            value
                .dyn_into::<Promise>()
                .map_err(|_| BridgeError::Unavailable)?,
        )
        .await
        .map_err(|error| BridgeError::Operation(format!("{error:?}")))?;
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivityContent<'a> {
    r#type: &'static str,
    event: &'a str,
    session_id: &'a str,
    level: u8,
    wave: u8,
    status: &'a str,
    base_health: u16,
    score: u32,
    players: usize,
    spectators: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendMessageResult {
    message_id: String,
    client_message_id: String,
}

/// Posts one idempotent, compact activity row to the scoped TAP channel.
///
/// This uses the public `channels.sendMessage` host operation. The caller must
/// declare and receive `tap.channels:send-message` authorization.
pub async fn send_channel_activity(
    channel: &str,
    event: &str,
    snapshot: &SessionSnapshot,
) -> Result<String, BridgeError> {
    validate_partition(channel, MAX_PRESENCE_ROOM_CHARS, "channel")?;
    validate_partition(event, 80, "event name")?;
    let channels = api("channels")?;
    let send = Reflect::get(&channels, &JsValue::from_str("sendMessage"))
        .map_err(|_| BridgeError::Unavailable)?
        .dyn_into::<Function>()
        .map_err(|_| BridgeError::Unavailable)?;
    let players = snapshot
        .members
        .iter()
        .filter(|member| member.slot.is_some())
        .count();
    let spectators = snapshot.members.len().saturating_sub(players);
    let status = format!("{:?}", snapshot.status).to_lowercase();
    let content = ActivityContent {
        r#type: "brainrot-td.activity",
        event,
        session_id: &snapshot.session_id.0,
        level: snapshot.level,
        wave: snapshot.wave,
        status: &status,
        base_health: snapshot.base_health,
        score: snapshot.score,
        players,
        spectators,
    };
    let body = format!(
        "**Brainrot Tower Defense · {}**\n\n{} · Level {} · Wave {} · {} player{} · {} watching · Base {} · Score {}",
        event.replace('.', " "),
        snapshot.name,
        snapshot.level,
        snapshot.wave,
        players,
        if players == 1 { "" } else { "s" },
        spectators,
        snapshot.base_health,
        snapshot.score,
    );
    let client_message_id = format!(
        "brainrot-td:{}:{}:{}",
        event, snapshot.session_id.0, snapshot.last_sequence
    );
    let options = object(&[
        ("channelId", channel.into()),
        ("clientMessageId", client_message_id.clone().into()),
        ("name", "Brainrot Tower Defense".into()),
        ("body", body.clone().into()),
        ("content", body.into()),
        ("messageContent", encode_presence_state(&content)?),
    ])?;
    let value = send
        .call1(&channels, &options.into())
        .map_err(|error| BridgeError::Operation(format!("{error:?}")))?;
    let value = if value.is_instance_of::<Promise>() {
        JsFuture::from(
            value
                .dyn_into::<Promise>()
                .map_err(|_| BridgeError::Unavailable)?,
        )
        .await
        .map_err(|error| BridgeError::Operation(format!("{error:?}")))?
    } else {
        value
    };
    let result: SendMessageResult = decode(&value)?;
    if result.message_id.trim().is_empty() || result.client_message_id != client_message_id {
        return Err(BridgeError::Invalid(
            "channel message acknowledgement did not match the request".into(),
        ));
    }
    Ok(result.message_id)
}

pub async fn user_identity() -> Result<UserIdentity, BridgeError> {
    let auth = api("auth")?;
    let value = invoke(&auth, "getUserProfile", &JsValue::UNDEFINED).await?;
    if value.is_null() || value.is_undefined() {
        return Err(BridgeError::Unavailable);
    }
    let identity: UserIdentity = decode(&value)?;
    if identity.sub.trim().is_empty() {
        return Err(BridgeError::Invalid("user profile has no subject".into()));
    }
    Ok(identity)
}

fn checkpoint_api(transition: &JsValue) -> Result<(String, JsValue), BridgeError> {
    let reference = Reflect::get(transition, &"checkpointReference".into())
        .ok()
        .and_then(|value| value.as_string())
        .filter(|value| !value.trim().is_empty())
        .ok_or(BridgeError::Unavailable)?;
    let context =
        Reflect::get(transition, &"context".into()).map_err(|_| BridgeError::Unavailable)?;
    let checkpoint =
        Reflect::get(&context, &"checkpoint".into()).map_err(|_| BridgeError::Unavailable)?;
    if checkpoint.is_object() {
        Ok((reference, checkpoint))
    } else {
        Err(BridgeError::Unavailable)
    }
}

pub async fn save_checkpoint<T: Serialize>(
    transition: &JsValue,
    value: &T,
) -> Result<(), BridgeError> {
    let (reference, checkpoint) = checkpoint_api(transition)?;
    let encoded = encode(value)?;
    let payload = js_sys::JSON::parse(encoded.as_string().as_deref().unwrap_or("null"))
        .map_err(|error| BridgeError::Invalid(format!("{error:?}")))?;
    invoke_two(&checkpoint, "save", &reference.into(), &payload)
        .await
        .map(|_| ())
}

pub async fn load_checkpoint<T: DeserializeOwned>(transition: &JsValue) -> Result<T, BridgeError> {
    let (reference, checkpoint) = checkpoint_api(transition)?;
    let value = invoke(&checkpoint, "load", &reference.into()).await?;
    if value.is_null() || value.is_undefined() {
        return Err(BridgeError::Invalid("checkpoint is missing".into()));
    }
    decode(&value)
}

#[derive(Clone, Debug)]
pub enum Runtime {
    Preview,
    Tap,
}
pub async fn load_sessions(
    runtime: &Runtime,
    channel: &str,
) -> Result<Stored<Vec<SessionSnapshot>>, BridgeError> {
    match runtime {
        Runtime::Tap => get("brainrot-td", &format!("channels/{channel}/sessions")).await,
        Runtime::Preview => Err(BridgeError::Unavailable),
    }
}

pub async fn load_channel_index(
    runtime: &Runtime,
    channel: &str,
) -> Result<Stored<ChannelIndex>, BridgeError> {
    match runtime {
        Runtime::Tap => get("brainrot-td", &format!("channels/{channel}/index")).await,
        Runtime::Preview => Err(BridgeError::Unavailable),
    }
}

pub async fn save_channel_index(
    runtime: &Runtime,
    channel: &str,
    value: &ChannelIndex,
    revision: Option<u64>,
) -> Result<u64, BridgeError> {
    match runtime {
        Runtime::Tap => {
            set(
                "brainrot-td",
                &format!("channels/{channel}/index"),
                value,
                revision,
            )
            .await
        }
        Runtime::Preview => Err(BridgeError::Unavailable),
    }
}

pub async fn load_session(
    runtime: &Runtime,
    channel: &str,
    session_id: &str,
) -> Result<Stored<SessionSnapshot>, BridgeError> {
    match runtime {
        Runtime::Tap => {
            get(
                "brainrot-td",
                &format!("channels/{channel}/sessions/{session_id}"),
            )
            .await
        }
        Runtime::Preview => Err(BridgeError::Unavailable),
    }
}

pub async fn save_session(
    runtime: &Runtime,
    channel: &str,
    session: &SessionSnapshot,
    revision: Option<u64>,
) -> Result<u64, BridgeError> {
    match runtime {
        Runtime::Tap => {
            set(
                "brainrot-td",
                &format!("channels/{channel}/sessions/{}", session.session_id.0),
                session,
                revision,
            )
            .await
        }
        Runtime::Preview => Err(BridgeError::Unavailable),
    }
}
pub async fn save_sessions(
    runtime: &Runtime,
    channel: &str,
    value: &[SessionSnapshot],
    revision: Option<u64>,
) -> Result<u64, BridgeError> {
    match runtime {
        Runtime::Tap => {
            set(
                "brainrot-td",
                &format!("channels/{channel}/sessions"),
                &value,
                revision,
            )
            .await
        }
        Runtime::Preview => Err(BridgeError::Unavailable),
    }
}
pub async fn load_command_queue(
    runtime: &Runtime,
    channel: &str,
    session: &str,
) -> Result<Stored<CommandQueue>, BridgeError> {
    match runtime {
        Runtime::Tap => {
            get(
                "brainrot-td-commands",
                &format!("channels/{channel}/sessions/{session}/commands"),
            )
            .await
        }
        Runtime::Preview => Err(BridgeError::Unavailable),
    }
}

pub async fn save_command_queue(
    runtime: &Runtime,
    channel: &str,
    session: &str,
    queue: &CommandQueue,
    revision: Option<u64>,
) -> Result<u64, BridgeError> {
    match runtime {
        Runtime::Tap => {
            set(
                "brainrot-td-commands",
                &format!("channels/{channel}/sessions/{session}/commands"),
                queue,
                revision,
            )
            .await
        }
        Runtime::Preview => Err(BridgeError::Unavailable),
    }
}
pub async fn load_progress(
    runtime: &Runtime,
    player: &str,
) -> Result<Stored<Progress>, BridgeError> {
    match runtime {
        Runtime::Tap => get("brainrot-td-progress", player).await,
        Runtime::Preview => Err(BridgeError::Unavailable),
    }
}

pub async fn save_progress(
    runtime: &Runtime,
    player: &str,
    progress: &Progress,
    revision: Option<u64>,
) -> Result<u64, BridgeError> {
    match runtime {
        Runtime::Tap => set("brainrot-td-progress", player, progress, revision).await,
        Runtime::Preview => Err(BridgeError::Unavailable),
    }
}

pub async fn load_audio_settings(
    runtime: &Runtime,
    player: &str,
) -> Result<Stored<AudioSettings>, BridgeError> {
    match runtime {
        Runtime::Tap => get("brainrot-td-progress", &format!("{player}/audio")).await,
        Runtime::Preview => Err(BridgeError::Unavailable),
    }
}

pub async fn save_audio_settings(
    runtime: &Runtime,
    player: &str,
    settings: &AudioSettings,
    revision: Option<u64>,
) -> Result<u64, BridgeError> {
    match runtime {
        Runtime::Tap => {
            set(
                "brainrot-td-progress",
                &format!("{player}/audio"),
                settings,
                revision,
            )
            .await
        }
        Runtime::Preview => Err(BridgeError::Unavailable),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
    struct TestPresenceState {
        role: String,
        cursor: Option<[u16; 2]>,
    }

    fn snapshot(room: &str) -> PresenceSnapshot<TestPresenceState> {
        PresenceSnapshot {
            namespace: PRESENCE_NAMESPACE.into(),
            room: room.into(),
            self_participant_id: "frame-current".into(),
            participants: vec![PresenceParticipant {
                participant_id: "frame-current".into(),
                display_name: "Current player".into(),
                state: TestPresenceState {
                    role: "player".into(),
                    cursor: Some([320, 180]),
                },
                updated_at_ms: 1_750_000_000_000,
            }],
        }
    }

    #[test]
    fn presence_room_validation_matches_sdk_bounds() {
        assert!(validate_partition("channel-1", MAX_PRESENCE_ROOM_CHARS, "room").is_ok());
        assert!(
            validate_partition(
                &"r".repeat(MAX_PRESENCE_ROOM_CHARS),
                MAX_PRESENCE_ROOM_CHARS,
                "room"
            )
            .is_ok()
        );
        for invalid in [
            String::new(),
            " channel-1".into(),
            "channel-1 ".into(),
            "channel\n1".into(),
            "r".repeat(MAX_PRESENCE_ROOM_CHARS + 1),
        ] {
            assert!(
                validate_partition(&invalid, MAX_PRESENCE_ROOM_CHARS, "room").is_err(),
                "accepted invalid room: {invalid:?}"
            );
        }
    }

    #[test]
    fn presence_state_serialization_enforces_utf8_byte_limit() {
        let exact = "x".repeat(MAX_PRESENCE_JSON_BYTES - 2);
        assert_eq!(
            serialize_presence_state(&exact)
                .expect("exact-size JSON string should be valid")
                .len(),
            MAX_PRESENCE_JSON_BYTES
        );

        let oversized = format!("{exact}x");
        assert!(serialize_presence_state(&oversized).is_err());

        let multibyte = "📶".repeat(MAX_PRESENCE_JSON_BYTES / 4);
        assert!(serialize_presence_state(&multibyte).is_err());
    }

    #[test]
    fn typed_snapshot_uses_installed_sdk_field_names() {
        let value = snapshot("channel-1");
        let json = serde_json::to_string(&value).expect("snapshot should serialize");
        assert!(json.contains("\"selfParticipantId\""));
        assert!(json.contains("\"participantId\""));
        assert!(json.contains("\"updatedAtMs\""));
        assert_eq!(
            serde_json::from_str::<PresenceSnapshot<TestPresenceState>>(&json)
                .expect("snapshot should deserialize"),
            value
        );
    }

    #[test]
    fn snapshot_validation_is_scoped_and_replay_safe() {
        let value = snapshot("channel-1");
        assert!(validate_presence_snapshot(&value, "channel-1").is_ok());

        let mut wrong_namespace = value.clone();
        wrong_namespace.namespace = "another-package".into();
        assert!(validate_presence_snapshot(&wrong_namespace, "channel-1").is_err());

        assert!(validate_presence_snapshot(&value, "channel-2").is_err());

        let mut duplicate = value.clone();
        duplicate
            .participants
            .push(duplicate.participants[0].clone());
        assert!(validate_presence_snapshot(&duplicate, "channel-1").is_err());

        let mut missing_host_identity = value;
        missing_host_identity.participants[0].participant_id.clear();
        assert!(validate_presence_snapshot(&missing_host_identity, "channel-1").is_err());
    }
}
