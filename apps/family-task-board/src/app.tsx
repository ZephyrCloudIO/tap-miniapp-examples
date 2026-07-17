import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  H1,
  H2,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  MiniAppStatusBar,
  MiniAppToolbar,
  NativeSelect,
  Progress,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@theaiplatform/miniapp-sdk/ui";
import {
  CalendarDays,
  Check,
  CircleCheckBig,
  Clock3,
  Gift,
  HandCoins,
  House,
  Database,
  Minus,
  Plus,
  ShoppingBag,
  Star,
  Settings2,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  addStarAdjustment,
  addEvent,
  addMember,
  addShopItem,
  addTask,
  acceptTransferByReceiver,
  approveTransferByParent,
  confirmTransferBySender,
  createFamily,
  declineTransfer,
  proposeTransfer,
  purchaseReward,
  starBalance,
  tasksFor,
  transitionPurchase,
  updateTaskStatus,
  updateTransferSettings,
  type FamilyMember,
  type FamilyState,
  type RewardStatus,
} from "./domain";
import { loadFamilyState, saveFamilyState } from "./storage";

const kidMembers = (state: FamilyState): readonly FamilyMember[] =>
  state.members.filter((member) => member.role === "kid");

const todayLabel = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date());

const Avatar = ({ member, small = false }: { member: FamilyMember; small?: boolean }) => (
  <span
    className={`avatar avatar--${member.color}${small ? " avatar--small" : ""}`}
    aria-hidden="true"
  >
    {member.avatar}
  </span>
);

const StarPill = ({ value }: { value: number }) => (
  <span className="star-pill">
    <Star aria-hidden="true" fill="currentColor" size={14} />
    {value}
  </span>
);

interface AppProps {
  readonly preview?: boolean;
}

export function FamilyTaskBoardApp({ preview = false }: AppProps) {
  const [state, setState] = useState<FamilyState | null>(null);
  const [activeMemberId, setActiveMemberId] = useState("");
  const [activeTab, setActiveTab] = useState("today");
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadFamilyState(preview)
      .then((stored) => {
        if (!cancelled && stored) {
          setState(stored);
          setActiveMemberId(stored.members[0]?.id ?? "");
        }
      })
      .catch(() => { if (!cancelled) setStorageError("The household could not be loaded from TAP storage."); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => {
      cancelled = true;
    };
  }, [preview]);

  useEffect(() => {
    if (!loaded || !state) return;
    const timeout = globalThis.setTimeout(() => {
      void saveFamilyState(state, preview)
        .then(() => setStorageError(null))
        .catch(() => setStorageError("Changes could not be saved to TAP storage."));
    }, 250);
    return () => globalThis.clearTimeout(timeout);
  }, [loaded, preview, state]);

  const kids = useMemo(() => state ? kidMembers(state) : [], [state]);

  const announce = useCallback((message: string) => {
    setNotice(message);
    globalThis.setTimeout(() => setNotice(null), 2800);
  }, []);

  const submitTask = useCallback(
    (taskId: string) => {
      setState((current) => current ? updateTaskStatus(current, taskId, "submitted") : current);
      announce("Chore sent for parent approval.");
    },
    [announce],
  );

  const approveTask = useCallback(
    (taskId: string) => {
      setState((current) => current ? updateTaskStatus(current, taskId, "approved") : current);
      announce("Chore approved and stars awarded.");
    },
    [announce],
  );

  const buyReward = useCallback(
    (itemId: string) => {
      if (!state) return;
      const activeMember = state.members.find((member) => member.id === activeMemberId);
      if (!activeMember || activeMember.role !== "kid") return;
      const item = state.shop.find((candidate) => candidate.id === itemId);
      if (item && starBalance(state, activeMember.id) >= item.cost) {
        setState((current) => current ? purchaseReward(current, activeMember.id, itemId) : current);
        announce(`${item.title} requested. A parent can approve it next.`);
      } else {
        announce("You need a few more stars for that reward.");
      }
    },
    [activeMemberId, announce, state],
  );

  if (!loaded) return <div className="loading-state">Loading household…</div>;
  if (storageError && !preview && !state) return <div className="loading-state" role="alert">{storageError}</div>;
  if (!state) return <Onboarding preview={preview} onCreate={(familyName, parentName) => {
    const created = createFamily(familyName, parentName);
    setState(created);
    setActiveMemberId(created.members[0]!.id);
    setActiveTab("manage");
  }} />;

  const activeMember = state.members.find((member) => member.id === activeMemberId) ?? state.members[0]!;
  const activeKids = activeMember.role === "kid" ? [activeMember] : kids;

  return (
    <div className="family-app">
      <MiniAppToolbar className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark"><House size={22} strokeWidth={2.4} /></span>
          <div>
            <span className="eyebrow">Family Task Board</span>
            <H2 size="sm">{state.familyName}</H2>
          </div>
        </div>
        <div className="profile-switcher" aria-label="Preview as family member">
          {state.members.map((member) => (
            <button
              className={member.id === activeMember.id ? "profile-chip profile-chip--active" : "profile-chip"}
              key={member.id}
              onClick={() => setActiveMemberId(member.id)}
              type="button"
              aria-label={`View as ${member.name}`}
              aria-pressed={member.id === activeMember.id}
            >
              <Avatar member={member} small />
              <span>{member.name}</span>
            </button>
          ))}
        </div>
      </MiniAppToolbar>

      {preview ? (
        <MiniAppStatusBar className="preview-banner" tone="neutral">
          <Database size={15} /> Preview data is persisted in this browser.
        </MiniAppStatusBar>
      ) : null}

      <main>
        <section className="welcome-row">
          <div>
            <span className="eyebrow">{todayLabel}</span>
            <H1>{activeMember.role === "parent" ? `Good afternoon, ${activeMember.name}` : `Hey, ${activeMember.name}!`}</H1>
            <p>
              {activeMember.role === "parent"
                ? "Here’s how the family is doing today."
                : "Here’s your plan around today’s activities."}
            </p>
          </div>
        </section>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList aria-label="Family task board sections" className="main-tabs">
            <TabsTrigger value="today"><CalendarDays size={16} /> Today</TabsTrigger>
            <TabsTrigger value="family"><Users size={16} /> Family</TabsTrigger>
            <TabsTrigger value="shop"><ShoppingBag size={16} /> Star Shop</TabsTrigger>
            <TabsTrigger value="transfers"><HandCoins size={16} /> Transfers</TabsTrigger>
            {activeMember.role === "parent" ? <TabsTrigger value="manage"><Settings2 size={16} /> Manage</TabsTrigger> : null}
          </TabsList>

          <TabsContent value="today">
            <TodayView
              activeMember={activeMember}
              activeKids={activeKids}
              state={state}
              onSubmit={submitTask}
              onApprove={approveTask}
            />
          </TabsContent>
          <TabsContent value="family">
            <FamilyView state={state} kids={kids} />
          </TabsContent>
          <TabsContent value="shop">
            <ShopView state={state} activeMember={activeMember} onBuy={buyReward} onTransition={(purchaseId, status) => setState((current) => current ? transitionPurchase(current, purchaseId, status, activeMember.id) : current)} />
          </TabsContent>
          <TabsContent value="transfers">
            <TransfersView state={state} activeMember={activeMember} onChange={setState} />
          </TabsContent>
          {activeMember.role === "parent" ? (
            <TabsContent value="manage">
              <ManageView state={state} onChange={setState} />
            </TabsContent>
          ) : null}
        </Tabs>
      </main>

      {notice ? <div className="toast" role="status" aria-live="polite">{notice}</div> : null}
      {storageError ? <div className="storage-error" role="alert">{storageError}</div> : null}
    </div>
  );
}

function TodayView({
  activeMember,
  activeKids,
  state,
  onSubmit,
  onApprove,
}: {
  readonly activeMember: FamilyMember;
  readonly activeKids: readonly FamilyMember[];
  readonly state: FamilyState;
  readonly onSubmit: (taskId: string) => void;
  readonly onApprove: (taskId: string) => void;
}) {
  return (
    <div className="dashboard-grid">
      <div className="dashboard-main">
        {activeKids.length === 0 ? <Card><CardHeader><CardTitle>No children yet</CardTitle><CardDescription>Open Manage to add household members, then assign their chores.</CardDescription></CardHeader></Card> : null}
        {activeKids.map((kid) => {
          const chores = tasksFor(state, kid.id);
          const open = chores.filter((task) => task.status !== "approved");
          const done = chores.length - open.length;
          const percent = chores.length === 0 ? 0 : Math.round((done / chores.length) * 100);
          return (
            <Card className="kid-card" key={kid.id}>
              <CardHeader className="kid-card__header">
                <div className="kid-title">
                  <Avatar member={kid} />
                  <div>
                    <CardTitle>{activeMember.role === "kid" ? "Your chores" : `${kid.name}’s chores`}</CardTitle>
                    <CardDescription>{done} of {chores.length} complete</CardDescription>
                  </div>
                </div>
                <StarPill value={starBalance(state, kid.id)} />
              </CardHeader>
              <CardContent>
                <Progress value={percent} aria-label={`${percent}% complete`} />
                <div className="task-list">
                  {chores.map((task) => (
                    <Item className={`task-row task-row--${task.status}`} key={task.id} variant="outline" size="sm">
                      <ItemMedia className="task-check" variant="icon" aria-hidden="true">
                        {task.status === "approved" ? <Check size={16} /> : <Clock3 size={15} />}
                      </ItemMedia>
                      <ItemContent className="task-copy">
                        <div className="task-heading">
                          <ItemTitle>{task.title}</ItemTitle>
                          <Badge variant={task.kind === "required" ? "default" : "secondary"}>
                            {task.kind === "required" ? "Required" : "Extra credit"}
                          </Badge>
                        </div>
                        <ItemDescription>{task.dueLabel} · {task.durationMinutes} min</ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <StarPill value={task.stars} />
                      {task.status === "open" && activeMember.role === "kid" ? (
                        <Button size="sm" variant="outline" onClick={() => onSubmit(task.id)}>Mark done</Button>
                      ) : null}
                      {task.status === "submitted" && activeMember.role === "parent" ? (
                        <Button size="sm" onClick={() => onApprove(task.id)}>Approve</Button>
                      ) : null}
                      {task.status === "submitted" && activeMember.role === "kid" ? (
                        <Badge variant="outline">Waiting</Badge>
                      ) : null}
                      </ItemActions>
                    </Item>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <aside className="dashboard-aside">
        <Card>
          <CardHeader>
            <CardTitle>Today’s activities</CardTitle>
            <CardDescription>Activities scheduled for the selected household members.</CardDescription>
          </CardHeader>
          <CardContent className="event-list">
            {state.events.filter((event) => activeMember.role === "parent" || event.memberId === activeMember.id).length === 0 ? <p className="empty-copy">No activities have been added.</p> : null}
            {state.events
              .filter((event) => activeMember.role === "parent" || event.memberId === activeMember.id)
              .map((event) => {
                const member = state.members.find((candidate) => candidate.id === event.memberId)!;
                return (
                  <div className={`event event--${event.tone}`} key={event.id}>
                    <Avatar member={member} small />
                    <div><strong>{event.title}</strong><span>{member.name} · {event.timeLabel}</span></div>
                  </div>
                );
              })}
          </CardContent>
        </Card>

      </aside>
    </div>
  );
}

function FamilyView({
  state,
  kids,
}: {
  readonly state: FamilyState;
  readonly kids: readonly FamilyMember[];
}) {
  return (
    <div className="family-grid">
      {kids.length === 0 ? <Card><CardHeader><CardTitle>No children yet</CardTitle><CardDescription>Add children from Manage.</CardDescription></CardHeader></Card> : null}
      {kids.map((kid) => {
        const chores = tasksFor(state, kid.id);
        const approved = chores.filter((task) => task.status === "approved").length;
        return (
          <Card key={kid.id} className="family-member-card">
            <CardHeader>
              <div className="kid-title"><Avatar member={kid} /><div><CardTitle>{kid.name}</CardTitle><CardDescription>{approved}/{chores.length} chores done</CardDescription></div></div>
              <span className="balance-big"><Star fill="currentColor" size={20} /> {starBalance(state, kid.id)}</span>
            </CardHeader>
            <CardContent>
              <div className="ledger-list">
                {state.ledger.filter((entry) => entry.memberId === kid.id).slice(-3).reverse().map((entry) => (
                  <div key={entry.id}><span>{entry.note}</span><strong className={entry.delta > 0 ? "positive" : "negative"}>{entry.delta > 0 ? "+" : ""}{entry.delta}</strong></div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function ShopView({
  state,
  activeMember,
  onBuy,
  onTransition,
}: {
  readonly state: FamilyState;
  readonly activeMember: FamilyMember;
  readonly onBuy: (itemId: string) => void;
  readonly onTransition: (purchaseId: string, status: RewardStatus) => void;
}) {
  const pending = state.purchases.filter((purchase) => purchase.status !== "consumed");
  return (
    <div>
      <section className="shop-hero">
        <div><span className="shop-icon"><Gift size={22} /></span><div><H2 size="sm">Family Star Shop</H2><p>Turn earned stars into parent-approved treats and activities.</p></div></div>
        {activeMember.role === "kid" ? <StarPill value={starBalance(state, activeMember.id)} /> : <Badge variant="secondary">Parent view</Badge>}
      </section>
      <div className="shop-grid">
        {state.shop.length === 0 ? <Card><CardHeader><CardTitle>The shop is empty</CardTitle><CardDescription>Parents can create rewards from Manage.</CardDescription></CardHeader></Card> : null}
        {state.shop.map((item) => {
          const affordable = activeMember.role === "kid" && starBalance(state, activeMember.id) >= item.cost;
          return (
            <Card key={item.id} className="shop-card">
              <CardHeader><span className="reward-icon">{item.icon}</span><CardTitle>{item.title}</CardTitle><CardDescription>{item.description}</CardDescription></CardHeader>
              <CardContent>
                <div className="shop-card__footer"><StarPill value={item.cost} /><Button size="sm" disabled={!affordable} onClick={() => onBuy(item.id)}>{activeMember.role === "kid" ? "Get reward" : "Kid purchase"}</Button></div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {pending.length > 0 ? (
        <Card className="redemption-card">
          <CardHeader><CardTitle>Waiting to be used</CardTitle><CardDescription>Parents mark rewards consumed after they’re used.</CardDescription></CardHeader>
          <CardContent>
            {pending.map((purchase) => {
              const member = state.members.find((candidate) => candidate.id === purchase.memberId)!;
              const item = state.shop.find((candidate) => candidate.id === purchase.itemId)!;
              return <div className="redemption-row" key={purchase.id}><Avatar member={member} small /><div><strong>{item.title}</strong><span>{member.name} · {purchase.status}</span></div><div className="purchase-actions">{activeMember.role === "parent" && purchase.status === "requested" ? <><Button size="sm" onClick={() => onTransition(purchase.id, "approved")}>Approve</Button><Button size="sm" variant="outline" onClick={() => onTransition(purchase.id, "declined")}>Decline</Button></> : null}{activeMember.role === "parent" && purchase.status === "approved" ? <><Button size="sm" onClick={() => onTransition(purchase.id, "ready")}>Mark ready</Button><Button size="sm" variant="outline" onClick={() => onTransition(purchase.id, "refunded")}>Refund</Button></> : null}{activeMember.role === "parent" && purchase.status === "ready" ? <><Button size="sm" onClick={() => onTransition(purchase.id, "consumed")}><CircleCheckBig size={15} /> Mark used</Button><Button size="sm" variant="outline" onClick={() => onTransition(purchase.id, "refunded")}>Refund</Button></> : null}{activeMember.role === "kid" && purchase.status === "requested" ? <Button size="sm" variant="outline" onClick={() => onTransition(purchase.id, "cancelled")}>Cancel</Button> : null}<Badge variant="outline">{purchase.status}</Badge></div></div>;
            })}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Onboarding({ preview, onCreate }: { readonly preview: boolean; readonly onCreate: (familyName: string, parentName: string) => void }) {
  const [familyName, setFamilyName] = useState("");
  const [parentName, setParentName] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (familyName.trim() && parentName.trim()) onCreate(familyName, parentName);
  };
  return (
    <div className="onboarding-shell">
      <Card className="onboarding-card">
        <CardHeader><span className="brand-mark"><House size={22} /></span><div><CardTitle>Create your family board</CardTitle><CardDescription>No sample records are created. Start with your real household data.</CardDescription></div></CardHeader>
        <CardContent>
          <form className="data-form" onSubmit={submit}>
            <label>Family name<Input name="familyName" autoComplete="organization" value={familyName} onChange={(event) => setFamilyName(event.target.value)} required /></label>
            <label>Your name<Input name="parentName" autoComplete="name" value={parentName} onChange={(event) => setParentName(event.target.value)} required /></label>
            <Button type="submit">Create household</Button>
          </form>
          {preview ? <p className="storage-note">This preview persists to browser storage. The packaged miniapp persists through TAP storage.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function ManageView({ state, onChange }: { readonly state: FamilyState; readonly onChange: (state: FamilyState) => void }) {
  const kids = state.members.filter((member) => member.role === "kid");
  const submitMember = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get("name") ?? "").trim();
    if (name) { onChange(addMember(state, name, "kid")); event.currentTarget.reset(); }
  };
  const submitTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    onChange(addTask(state, { title: String(form.get("title")), assigneeId: String(form.get("assigneeId")), kind: String(form.get("kind")) as "required" | "extra", stars: Number(form.get("stars")), dueLabel: String(form.get("dueLabel")), durationMinutes: Number(form.get("durationMinutes")) })); event.currentTarget.reset();
  };
  const submitEvent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    onChange(addEvent(state, { title: String(form.get("title")), memberId: String(form.get("memberId")), timeLabel: String(form.get("timeLabel")) })); event.currentTarget.reset();
  };
  const submitReward = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const inventory = String(form.get("inventory") ?? "");
    onChange(addShopItem(state, { title: String(form.get("title")), description: String(form.get("description")), cost: Number(form.get("cost")), icon: String(form.get("icon")), inventory: inventory ? Number(inventory) : null })); event.currentTarget.reset();
  };
  const submitAdjustment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    onChange(addStarAdjustment(state, state.members.find((member) => member.role === "parent")!.id, String(form.get("memberId")), Number(form.get("delta")), String(form.get("note")))); event.currentTarget.reset();
  };
  const submitTransferSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const limit = String(form.get("transferLimit") ?? ""); const threshold = String(form.get("parentApprovalThreshold") ?? "");
    onChange(updateTransferSettings(state, limit ? Number(limit) : null, threshold ? Number(threshold) : null));
  };
  return (
    <div className="manage-grid">
      <Card><CardHeader><CardTitle>Add a child</CardTitle><CardDescription>Create a real household member.</CardDescription></CardHeader><CardContent><form className="data-form" onSubmit={submitMember}><label>Name<Input name="name" autoComplete="off" required /></label><Button type="submit">Add child</Button></form></CardContent></Card>
      <Card><CardHeader><CardTitle>Add a chore</CardTitle><CardDescription>Assign work and define its star value.</CardDescription></CardHeader><CardContent><form className="data-form" onSubmit={submitTask}><label>Chore<Input name="title" autoComplete="off" required /></label><label>Child<NativeSelect name="assigneeId" required><option value="">Select a child</option>{kids.map((kid) => <option key={kid.id} value={kid.id}>{kid.name}</option>)}</NativeSelect></label><div className="form-row"><label>Type<NativeSelect name="kind"><option value="required">Required</option><option value="extra">Extra credit</option></NativeSelect></label><label>Stars<Input name="stars" type="number" inputMode="numeric" min="1" required /></label></div><label>Due description<Input name="dueLabel" autoComplete="off" placeholder="Before dinner…" required /></label><label>Minutes<Input name="durationMinutes" type="number" inputMode="numeric" min="1" required /></label><Button type="submit" disabled={kids.length === 0}>Add chore</Button></form></CardContent></Card>
      <Card><CardHeader><CardTitle>Add an activity</CardTitle><CardDescription>Activities inform the daily schedule.</CardDescription></CardHeader><CardContent><form className="data-form" onSubmit={submitEvent}><label>Activity<Input name="title" autoComplete="off" required /></label><label>Child<NativeSelect name="memberId" required><option value="">Select a child</option>{kids.map((kid) => <option key={kid.id} value={kid.id}>{kid.name}</option>)}</NativeSelect></label><label>Time<Input name="timeLabel" type="time" required /></label><Button type="submit" disabled={kids.length === 0}>Add activity</Button></form></CardContent></Card>
      <Card><CardHeader><CardTitle>Adjust stars</CardTitle><CardDescription>Add a bonus or enter a negative punishment with a required note.</CardDescription></CardHeader><CardContent><form className="data-form" onSubmit={submitAdjustment}><label>Child<NativeSelect name="memberId" required><option value="">Select a child</option>{kids.map((kid) => <option key={kid.id} value={kid.id}>{kid.name}</option>)}</NativeSelect></label><label>Star change<Input name="delta" type="number" inputMode="numeric" required /></label><label>Note<Input name="note" autoComplete="off" required /></label><Button type="submit" disabled={kids.length === 0}>Record adjustment</Button></form></CardContent></Card>
      <Card><CardHeader><CardTitle>Transfer safeguards</CardTitle><CardDescription>Control child-to-child transfer amounts and parent review.</CardDescription></CardHeader><CardContent><form className="data-form" onSubmit={submitTransferSettings}><label>Maximum transfer (optional)<Input name="transferLimit" type="number" inputMode="numeric" min="1" defaultValue={state.settings.transferLimit ?? ""} /></label><label>Require parent above (optional)<Input name="parentApprovalThreshold" type="number" inputMode="numeric" min="0" defaultValue={state.settings.parentApprovalThreshold ?? ""} /></label><Button type="submit">Save transfer safeguards</Button></form></CardContent></Card>
      <Card><CardHeader><CardTitle>Add a reward</CardTitle><CardDescription>Define what children can buy with stars.</CardDescription></CardHeader><CardContent><form className="data-form" onSubmit={submitReward}><div className="form-row"><label>Icon<Input name="icon" autoComplete="off" placeholder="🎮" required /></label><label>Cost<Input name="cost" type="number" inputMode="numeric" min="1" required /></label></div><label>Reward<Input name="title" autoComplete="off" required /></label><label>Description<Input name="description" autoComplete="off" required /></label><label>Inventory (optional)<Input name="inventory" type="number" inputMode="numeric" min="0" /></label><Button type="submit">Add reward</Button></form></CardContent></Card>
    </div>
  );
}

function TransfersView({ state, activeMember, onChange }: { readonly state: FamilyState; readonly activeMember: FamilyMember; readonly onChange: (state: FamilyState) => void }) {
  const kids = state.members.filter((member) => member.role === "kid");
  const relevant = activeMember.role === "parent" ? state.transfers : state.transfers.filter((transfer) => transfer.senderId === activeMember.id || transfer.receiverId === activeMember.id);
  const propose = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    onChange(proposeTransfer(state, activeMember.id, String(form.get("receiverId")), Number(form.get("amount")), String(form.get("note")))); event.currentTarget.reset();
  };
  return <div className="transfer-layout">
    {activeMember.role === "kid" ? <Card><CardHeader><CardTitle>Send stars</CardTitle><CardDescription>The stars move only after you confirm and the other child accepts.</CardDescription></CardHeader><CardContent><form className="data-form" onSubmit={propose}><label>Send to<NativeSelect name="receiverId" required><option value="">Select a child</option>{kids.filter((kid) => kid.id !== activeMember.id).map((kid) => <option value={kid.id} key={kid.id}>{kid.name}</option>)}</NativeSelect></label><label>Stars<Input name="amount" type="number" inputMode="numeric" min="1" max={state.settings.transferLimit ?? undefined} required /></label><label>Note<Input name="note" autoComplete="off" required /></label><Button type="submit">Propose transfer</Button></form></CardContent></Card> : null}
    <Card><CardHeader><CardTitle>{activeMember.role === "parent" ? "Transfer history" : "Your transfers"}</CardTitle><CardDescription>Every proposal and confirmation remains visible for review.</CardDescription></CardHeader><CardContent className="transfer-list">{relevant.length === 0 ? <p className="empty-copy">No transfers yet.</p> : relevant.map((transfer) => {
      const sender = state.members.find((member) => member.id === transfer.senderId)!; const receiver = state.members.find((member) => member.id === transfer.receiverId)!;
      return <Item key={transfer.id} variant="outline"><ItemContent><ItemTitle>{sender.name} → {receiver.name} · {transfer.amount} stars</ItemTitle><ItemDescription>{transfer.note}</ItemDescription></ItemContent><ItemActions><Badge variant="outline">{transfer.status}</Badge>{activeMember.id === transfer.senderId && transfer.status === "proposed" ? <Button size="sm" onClick={() => onChange(confirmTransferBySender(state, transfer.id, activeMember.id))}>Confirm send</Button> : null}{activeMember.id === transfer.receiverId && transfer.status === "sender-confirmed" ? <><Button size="sm" onClick={() => onChange(acceptTransferByReceiver(state, transfer.id, activeMember.id))}>Accept</Button><Button size="sm" variant="outline" onClick={() => onChange(declineTransfer(state, transfer.id, activeMember.id))}>Decline</Button></> : null}{activeMember.role === "parent" && transfer.status === "awaiting-parent" ? <Button size="sm" onClick={() => onChange(approveTransferByParent(state, transfer.id, activeMember.id))}>Approve</Button> : null}</ItemActions></Item>;
    })}</CardContent></Card>
  </div>;
}
