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
import type { TapFederatedSurfaceMountContext } from "@theaiplatform/miniapp-sdk/surface";
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
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
import { canManageFamily, waitForHostAuthority } from "./authority";
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
  readonly context?: TapFederatedSurfaceMountContext;
  readonly preview?: boolean;
}

type FamilyStateMutation = (
  current: FamilyState | null,
) => FamilyState | null;

type ApplyFamilyMutation = (
  mutation: (current: FamilyState) => FamilyState,
) => void;

export function FamilyTaskBoardApp({ context, preview = false }: AppProps) {
  const [state, setState] = useState<FamilyState | null>(null);
  const [activeMemberId, setActiveMemberId] = useState("");
  const [activeTab, setActiveTab] = useState("today");
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [manageAllowed, setManageAllowed] = useState(preview);
  const [mutationPending, setMutationPending] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const stateRef = useRef<FamilyState | null>(null);
  const mutationPendingRef = useRef(false);

  const announce = useCallback((message: string) => {
    setNotice(message);
    globalThis.setTimeout(() => setNotice(null), 2800);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await waitForHostAuthority(context);
      const [storedResult, manageResult] = await Promise.allSettled([
        loadFamilyState(preview),
        canManageFamily(context, preview),
      ]);
      if (cancelled) return;
      if (storedResult.status === "fulfilled") {
        const stored = storedResult.value;
        if (stored) {
          stateRef.current = stored;
          setState(stored);
          setActiveMemberId(stored.members[0]?.id ?? "");
        }
      } else {
        setStorageError("The household could not be loaded from TAP storage.");
      }
      setManageAllowed(
        manageResult.status === "fulfilled" && manageResult.value,
      );
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [context, preview]);

  useEffect(() => {
    if (preview || !context) return;
    return context.hostAuthority.subscribe(() => {
      if (!context.hostAuthority.getSnapshot()) {
        setManageAllowed(false);
        return;
      }
      void canManageFamily(context, false).then(setManageAllowed);
    });
  }, [context, preview]);

  useEffect(() => {
    if (!manageAllowed && activeTab === "manage") setActiveTab("today");
  }, [activeTab, manageAllowed]);

  const kids = useMemo(() => state ? kidMembers(state) : [], [state]);

  const persistMutation = useCallback(
    async (mutation: FamilyStateMutation): Promise<boolean> => {
      if (mutationPendingRef.current) return false;
      mutationPendingRef.current = true;
      setMutationPending(true);
      try {
        const allowed = await canManageFamily(context, preview);
        setManageAllowed(allowed);
        if (!allowed) {
          announce("TAP has granted view-only access to this family board.");
          return false;
        }
        const current = stateRef.current;
        const next = mutation(current);
        if (!next || next === current) return false;
        const writeAllowed = await canManageFamily(context, preview);
        setManageAllowed(writeAllowed);
        if (!writeAllowed) {
          announce("TAP has granted view-only access to this family board.");
          return false;
        }
        await saveFamilyState(next, preview);
        stateRef.current = next;
        setState(next);
        setStorageError(null);
        return true;
      } catch {
        setStorageError("Changes could not be saved to TAP storage.");
        return false;
      } finally {
        mutationPendingRef.current = false;
        setMutationPending(false);
      }
    },
    [announce, context, preview],
  );

  const submitTask = useCallback(
    (taskId: string) => {
      void persistMutation((current) =>
        current ? updateTaskStatus(current, taskId, "submitted") : current,
      ).then((changed) => {
        if (changed) announce("Chore sent for parent approval.");
      });
    },
    [announce, persistMutation],
  );

  const approveTask = useCallback(
    (taskId: string) => {
      void persistMutation((current) =>
        current ? updateTaskStatus(current, taskId, "approved") : current,
      ).then((changed) => {
        if (changed) announce("Chore approved and stars awarded.");
      });
    },
    [announce, persistMutation],
  );

  const buyReward = useCallback(
    (itemId: string) => {
      if (!state) return;
      const activeMember = state.members.find((member) => member.id === activeMemberId);
      if (!activeMember || activeMember.role !== "kid") return;
      const item = state.shop.find((candidate) => candidate.id === itemId);
      if (item && starBalance(state, activeMember.id) >= item.cost) {
        void persistMutation((current) =>
          current
            ? purchaseReward(current, activeMember.id, itemId)
            : current,
        ).then((changed) => {
          if (changed) {
            announce(`${item.title} requested. A parent can approve it next.`);
          }
        });
      } else {
        announce("You need a few more stars for that reward.");
      }
    },
    [activeMemberId, announce, persistMutation, state],
  );

  if (!loaded) return <div className="loading-state">Loading household…</div>;
  if (storageError && !preview && !state) return <div className="loading-state" role="alert">{storageError}</div>;
  if (!state) {
    return (
      <Onboarding
        canManage={manageAllowed && !mutationPending}
        preview={preview}
        onCreate={(familyName, parentName) => {
          let parentId = "";
          void persistMutation(() => {
            const created = createFamily(familyName, parentName);
            parentId = created.members[0]!.id;
            return created;
          }).then((changed) => {
            if (!changed) return;
            setActiveMemberId(parentId);
            setActiveTab("manage");
          });
        }}
      />
    );
  }

  const activeMember = state.members.find((member) => member.id === activeMemberId) ?? state.members[0]!;
  const activeKids = activeMember.role === "kid" ? [activeMember] : kids;
  const canManage = manageAllowed && !mutationPending;

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
      {!preview && !manageAllowed ? (
        <MiniAppStatusBar className="preview-banner" tone="neutral">
          View-only access. TAP has not granted household management.
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
            {activeMember.role === "parent" && canManage ? <TabsTrigger value="manage"><Settings2 size={16} /> Manage</TabsTrigger> : null}
          </TabsList>

          <TabsContent value="today">
            <TodayView
              activeMember={activeMember}
              activeKids={activeKids}
              canManage={canManage}
              state={state}
              onSubmit={submitTask}
              onApprove={approveTask}
            />
          </TabsContent>
          <TabsContent value="family">
            <FamilyView state={state} kids={kids} />
          </TabsContent>
          <TabsContent value="shop">
            <ShopView
              state={state}
              activeMember={activeMember}
              canManage={canManage}
              onBuy={buyReward}
              onTransition={(purchaseId, status) => {
                void persistMutation((current) =>
                  current
                    ? transitionPurchase(
                        current,
                        purchaseId,
                        status,
                        activeMember.id,
                      )
                    : current,
                );
              }}
            />
          </TabsContent>
          <TabsContent value="transfers">
            <TransfersView
              state={state}
              activeMember={activeMember}
              canManage={canManage}
              onChange={(mutation) => {
                void persistMutation((current) =>
                  current ? mutation(current) : current,
                );
              }}
            />
          </TabsContent>
          {activeMember.role === "parent" && canManage ? (
            <TabsContent value="manage">
              <ManageView
                state={state}
                onChange={(mutation) => {
                  void persistMutation((current) =>
                    current ? mutation(current) : current,
                  );
                }}
              />
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
  canManage,
  state,
  onSubmit,
  onApprove,
}: {
  readonly activeMember: FamilyMember;
  readonly activeKids: readonly FamilyMember[];
  readonly canManage: boolean;
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
                        <Button disabled={!canManage} size="sm" variant="outline" onClick={() => onSubmit(task.id)}>Mark done</Button>
                      ) : null}
                      {task.status === "submitted" && activeMember.role === "parent" ? (
                        <Button disabled={!canManage} size="sm" onClick={() => onApprove(task.id)}>Approve</Button>
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
  canManage,
  onBuy,
  onTransition,
}: {
  readonly state: FamilyState;
  readonly activeMember: FamilyMember;
  readonly canManage: boolean;
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
                <div className="shop-card__footer"><StarPill value={item.cost} /><Button size="sm" disabled={!canManage || !affordable} onClick={() => onBuy(item.id)}>{activeMember.role === "kid" ? "Get reward" : "Kid purchase"}</Button></div>
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
              return <div className="redemption-row" key={purchase.id}><Avatar member={member} small /><div><strong>{item.title}</strong><span>{member.name} · {purchase.status}</span></div><div className="purchase-actions">{activeMember.role === "parent" && purchase.status === "requested" ? <><Button disabled={!canManage} size="sm" onClick={() => onTransition(purchase.id, "approved")}>Approve</Button><Button disabled={!canManage} size="sm" variant="outline" onClick={() => onTransition(purchase.id, "declined")}>Decline</Button></> : null}{activeMember.role === "parent" && purchase.status === "approved" ? <><Button disabled={!canManage} size="sm" onClick={() => onTransition(purchase.id, "ready")}>Mark ready</Button><Button disabled={!canManage} size="sm" variant="outline" onClick={() => onTransition(purchase.id, "refunded")}>Refund</Button></> : null}{activeMember.role === "parent" && purchase.status === "ready" ? <><Button disabled={!canManage} size="sm" onClick={() => onTransition(purchase.id, "consumed")}><CircleCheckBig size={15} /> Mark used</Button><Button disabled={!canManage} size="sm" variant="outline" onClick={() => onTransition(purchase.id, "refunded")}>Refund</Button></> : null}{activeMember.role === "kid" && purchase.status === "requested" ? <Button disabled={!canManage} size="sm" variant="outline" onClick={() => onTransition(purchase.id, "cancelled")}>Cancel</Button> : null}<Badge variant="outline">{purchase.status}</Badge></div></div>;
            })}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Onboarding({
  canManage,
  preview,
  onCreate,
}: {
  readonly canManage: boolean;
  readonly preview: boolean;
  readonly onCreate: (familyName: string, parentName: string) => void;
}) {
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
            <label>Family name<Input name="familyName" autoComplete="organization" value={familyName} onChange={(event) => setFamilyName(event.target.value)} disabled={!canManage} required /></label>
            <label>Your name<Input name="parentName" autoComplete="name" value={parentName} onChange={(event) => setParentName(event.target.value)} disabled={!canManage} required /></label>
            <Button disabled={!canManage} type="submit">Create household</Button>
          </form>
          {preview ? <p className="storage-note">This preview persists to browser storage. The packaged miniapp persists through TAP storage.</p> : null}
          {!preview && !canManage ? <p className="storage-note">TAP has granted view-only access. Household creation is unavailable.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function ManageView({ state, onChange }: { readonly state: FamilyState; readonly onChange: ApplyFamilyMutation }) {
  const kids = state.members.filter((member) => member.role === "kid");
  const submitMember = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get("name") ?? "").trim();
    if (name) { onChange((current) => addMember(current, name, "kid")); event.currentTarget.reset(); }
  };
  const submitTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    onChange((current) => addTask(current, { title: String(form.get("title")), assigneeId: String(form.get("assigneeId")), kind: String(form.get("kind")) as "required" | "extra", stars: Number(form.get("stars")), dueLabel: String(form.get("dueLabel")), durationMinutes: Number(form.get("durationMinutes")) })); event.currentTarget.reset();
  };
  const submitEvent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    onChange((current) => addEvent(current, { title: String(form.get("title")), memberId: String(form.get("memberId")), timeLabel: String(form.get("timeLabel")) })); event.currentTarget.reset();
  };
  const submitReward = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const inventory = String(form.get("inventory") ?? "");
    onChange((current) => addShopItem(current, { title: String(form.get("title")), description: String(form.get("description")), cost: Number(form.get("cost")), icon: String(form.get("icon")), inventory: inventory ? Number(inventory) : null })); event.currentTarget.reset();
  };
  const submitAdjustment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    onChange((current) => addStarAdjustment(current, current.members.find((member) => member.role === "parent")!.id, String(form.get("memberId")), Number(form.get("delta")), String(form.get("note")))); event.currentTarget.reset();
  };
  const submitTransferSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const limit = String(form.get("transferLimit") ?? ""); const threshold = String(form.get("parentApprovalThreshold") ?? "");
    onChange((current) => updateTransferSettings(current, limit ? Number(limit) : null, threshold ? Number(threshold) : null));
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

function TransfersView({
  state,
  activeMember,
  canManage,
  onChange,
}: {
  readonly state: FamilyState;
  readonly activeMember: FamilyMember;
  readonly canManage: boolean;
  readonly onChange: ApplyFamilyMutation;
}) {
  const kids = state.members.filter((member) => member.role === "kid");
  const relevant = activeMember.role === "parent" ? state.transfers : state.transfers.filter((transfer) => transfer.senderId === activeMember.id || transfer.receiverId === activeMember.id);
  const propose = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    onChange((current) => proposeTransfer(current, activeMember.id, String(form.get("receiverId")), Number(form.get("amount")), String(form.get("note")))); event.currentTarget.reset();
  };
  return <div className="transfer-layout">
    {activeMember.role === "kid" ? <Card><CardHeader><CardTitle>Send stars</CardTitle><CardDescription>The stars move only after you confirm and the other child accepts.</CardDescription></CardHeader><CardContent><form className="data-form" onSubmit={propose}><label>Send to<NativeSelect disabled={!canManage} name="receiverId" required><option value="">Select a child</option>{kids.filter((kid) => kid.id !== activeMember.id).map((kid) => <option value={kid.id} key={kid.id}>{kid.name}</option>)}</NativeSelect></label><label>Stars<Input disabled={!canManage} name="amount" type="number" inputMode="numeric" min="1" max={state.settings.transferLimit ?? undefined} required /></label><label>Note<Input disabled={!canManage} name="note" autoComplete="off" required /></label><Button disabled={!canManage} type="submit">Propose transfer</Button></form></CardContent></Card> : null}
    <Card><CardHeader><CardTitle>{activeMember.role === "parent" ? "Transfer history" : "Your transfers"}</CardTitle><CardDescription>Every proposal and confirmation remains visible for review.</CardDescription></CardHeader><CardContent className="transfer-list">{relevant.length === 0 ? <p className="empty-copy">No transfers yet.</p> : relevant.map((transfer) => {
      const sender = state.members.find((member) => member.id === transfer.senderId)!; const receiver = state.members.find((member) => member.id === transfer.receiverId)!;
      return <Item key={transfer.id} variant="outline"><ItemContent><ItemTitle>{sender.name} → {receiver.name} · {transfer.amount} stars</ItemTitle><ItemDescription>{transfer.note}</ItemDescription></ItemContent><ItemActions><Badge variant="outline">{transfer.status}</Badge>{activeMember.id === transfer.senderId && transfer.status === "proposed" ? <Button disabled={!canManage} size="sm" onClick={() => onChange((current) => confirmTransferBySender(current, transfer.id, activeMember.id))}>Confirm send</Button> : null}{activeMember.id === transfer.receiverId && transfer.status === "sender-confirmed" ? <><Button disabled={!canManage} size="sm" onClick={() => onChange((current) => acceptTransferByReceiver(current, transfer.id, activeMember.id))}>Accept</Button><Button disabled={!canManage} size="sm" variant="outline" onClick={() => onChange((current) => declineTransfer(current, transfer.id, activeMember.id))}>Decline</Button></> : null}{activeMember.role === "parent" && transfer.status === "awaiting-parent" ? <Button disabled={!canManage} size="sm" onClick={() => onChange((current) => approveTransferByParent(current, transfer.id, activeMember.id))}>Approve</Button> : null}</ItemActions></Item>;
    })}</CardContent></Card>
  </div>;
}
