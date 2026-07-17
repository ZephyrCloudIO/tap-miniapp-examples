export type Role = "parent" | "kid";
export type TaskKind = "required" | "extra";
export type TaskStatus = "open" | "submitted" | "approved";
export type RewardStatus = "requested" | "approved" | "ready" | "consumed" | "declined" | "cancelled" | "expired" | "refunded";
export type LedgerType = "chore" | "bonus" | "deduction" | "transfer-out" | "transfer-in" | "purchase" | "refund" | "adjustment";
export type TransferStatus = "proposed" | "sender-confirmed" | "awaiting-parent" | "completed" | "declined" | "cancelled";

export interface FamilyMember { readonly id: string; readonly name: string; readonly role: Role; readonly avatar: string; readonly color: string; }
export interface FamilyTask { readonly id: string; readonly title: string; readonly assigneeId: string; readonly kind: TaskKind; readonly stars: number; readonly dueLabel: string; readonly durationMinutes: number; readonly status: TaskStatus; }
export interface CalendarEvent { readonly id: string; readonly memberId: string; readonly title: string; readonly timeLabel: string; readonly tone: "blue" | "purple" | "orange"; }
export interface StarEntry { readonly id: string; readonly memberId: string; readonly actorId: string; readonly type: LedgerType; readonly delta: number; readonly note: string; readonly createdAt: string; readonly relatedTaskId?: string; readonly relatedRewardId?: string; readonly relatedPurchaseId?: string; readonly relatedTransferId?: string; }
export interface ShopItem { readonly id: string; readonly title: string; readonly description: string; readonly cost: number; readonly icon: string; readonly inventory: number | null; }
export interface RewardPurchase { readonly id: string; readonly itemId: string; readonly memberId: string; readonly status: RewardStatus; readonly createdAt: string; }
export interface StarTransfer { readonly id: string; readonly senderId: string; readonly receiverId: string; readonly amount: number; readonly note: string; readonly status: TransferStatus; readonly senderConfirmedAt: string | null; readonly receiverConfirmedAt: string | null; readonly parentConfirmedAt: string | null; readonly createdAt: string; }
export interface FamilySettings { readonly transferLimit: number | null; readonly parentApprovalThreshold: number | null; }
export interface FamilyState { readonly schemaVersion: 2; readonly familyName: string; readonly members: readonly FamilyMember[]; readonly tasks: readonly FamilyTask[]; readonly events: readonly CalendarEvent[]; readonly ledger: readonly StarEntry[]; readonly shop: readonly ShopItem[]; readonly purchases: readonly RewardPurchase[]; readonly transfers: readonly StarTransfer[]; readonly settings: FamilySettings; }

const id = (): string => globalThis.crypto.randomUUID();
const now = (): string => new Date().toISOString();
const avatar = (name: string): string => name.trim().slice(0, 1).toLocaleUpperCase();
const colors = ["coral", "violet", "sky", "mint"] as const;

export const createFamily = (familyName: string, parentName: string): FamilyState => ({
  schemaVersion: 2,
  familyName: familyName.trim(),
  members: [{ id: id(), name: parentName.trim(), role: "parent", avatar: avatar(parentName), color: colors[0] }],
  tasks: [], events: [], ledger: [], shop: [], purchases: [], transfers: [], settings: { transferLimit: null, parentApprovalThreshold: null },
});

export const addMember = (state: FamilyState, name: string, role: Role): FamilyState => ({
  ...state,
  members: [...state.members, { id: id(), name: name.trim(), role, avatar: avatar(name), color: colors[state.members.length % colors.length]! }],
});

export const addTask = (state: FamilyState, input: Omit<FamilyTask, "id" | "status">): FamilyState => ({
  ...state, tasks: [...state.tasks, { ...input, id: id(), status: "open" }],
});

export const addEvent = (state: FamilyState, input: Omit<CalendarEvent, "id" | "tone">): FamilyState => ({
  ...state, events: [...state.events, { ...input, id: id(), tone: colors[state.events.length % 3] === "violet" ? "purple" : colors[state.events.length % 3] === "sky" ? "blue" : "orange" }],
});

export const addShopItem = (state: FamilyState, input: Omit<ShopItem, "id">): FamilyState => ({
  ...state, shop: [...state.shop, { ...input, id: id() }],
});

export const starBalance = (state: FamilyState, memberId: string): number => state.ledger.reduce((total, entry) => total + (entry.memberId === memberId ? entry.delta : 0), 0);
export const tasksFor = (state: FamilyState, memberId: string): readonly FamilyTask[] => state.tasks.filter((task) => task.assigneeId === memberId);

export const updateTaskStatus = (state: FamilyState, taskId: string, status: TaskStatus): FamilyState => {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task || task.status === status) return state;
  const award = status === "approved" && task.status !== "approved";
  return { ...state, tasks: state.tasks.map((candidate) => candidate.id === taskId ? { ...candidate, status } : candidate), ledger: award ? [...state.ledger, { id: id(), memberId: task.assigneeId, actorId: task.assigneeId, type: "chore", delta: task.stars, note: task.title, createdAt: now(), relatedTaskId: task.id }] : state.ledger };
};

export const addStarAdjustment = (state: FamilyState, actorId: string, memberId: string, delta: number, note: string): FamilyState => ({
  ...state, ledger: [...state.ledger, { id: id(), memberId, actorId, type: delta > 0 ? "bonus" : "deduction", delta, note: note.trim(), createdAt: now() }],
});

export const purchaseReward = (state: FamilyState, memberId: string, itemId: string): FamilyState => {
  const item = state.shop.find((candidate) => candidate.id === itemId);
  if (!item || starBalance(state, memberId) < item.cost) return state;
  const purchaseId = id();
  return { ...state, ledger: [...state.ledger, { id: id(), memberId, actorId: memberId, type: "purchase", delta: -item.cost, note: `Purchased ${item.title}`, createdAt: now(), relatedRewardId: item.id, relatedPurchaseId: purchaseId }], purchases: [...state.purchases, { id: purchaseId, itemId, memberId, status: "requested", createdAt: now() }] };
};

const purchaseTransitions: Readonly<Record<RewardStatus, readonly RewardStatus[]>> = {
  requested: ["approved", "declined", "cancelled"], approved: ["ready", "cancelled", "refunded"], ready: ["consumed", "expired", "refunded"], consumed: [], declined: [], cancelled: [], expired: [], refunded: [],
};

export const transitionPurchase = (state: FamilyState, purchaseId: string, status: RewardStatus, actorId: string): FamilyState => {
  const purchase = state.purchases.find((candidate) => candidate.id === purchaseId);
  const actor = state.members.find((member) => member.id === actorId);
  if (!purchase || !purchaseTransitions[purchase.status].includes(status)) return state;
  const childCanCancel = actorId === purchase.memberId && purchase.status === "requested" && status === "cancelled";
  if (actor?.role !== "parent" && !childCanCancel) return state;
  const item = state.shop.find((candidate) => candidate.id === purchase.itemId);
  const refund = status === "declined" || status === "cancelled" || status === "expired" || status === "refunded";
  const alreadyRefunded = state.ledger.some((entry) => entry.relatedPurchaseId === purchase.id && entry.type === "refund");
  return { ...state, purchases: state.purchases.map((candidate) => candidate.id === purchaseId ? { ...candidate, status } : candidate), ledger: refund && !alreadyRefunded && item ? [...state.ledger, { id: id(), memberId: purchase.memberId, actorId, type: "refund", delta: item.cost, note: `Refunded ${item.title}`, createdAt: now(), relatedRewardId: item.id, relatedPurchaseId: purchase.id }] : state.ledger };
};

export const proposeTransfer = (state: FamilyState, senderId: string, receiverId: string, amount: number, note: string): FamilyState => {
  if (senderId === receiverId || amount <= 0 || !Number.isInteger(amount) || !note.trim()) return state;
  if (state.settings.transferLimit !== null && amount > state.settings.transferLimit) return state;
  if (starBalance(state, senderId) < amount) return state;
  return { ...state, transfers: [...state.transfers, { id: id(), senderId, receiverId, amount, note: note.trim(), status: "proposed", senderConfirmedAt: null, receiverConfirmedAt: null, parentConfirmedAt: null, createdAt: now() }] };
};

export const confirmTransferBySender = (state: FamilyState, transferId: string, actorId: string): FamilyState => ({
  ...state, transfers: state.transfers.map((transfer) => transfer.id === transferId && transfer.senderId === actorId && transfer.status === "proposed" ? { ...transfer, status: "sender-confirmed", senderConfirmedAt: now() } : transfer),
});

export const declineTransfer = (state: FamilyState, transferId: string, actorId: string): FamilyState => ({
  ...state, transfers: state.transfers.map((transfer) => transfer.id === transferId && (transfer.receiverId === actorId || transfer.senderId === actorId) && (transfer.status === "proposed" || transfer.status === "sender-confirmed") ? { ...transfer, status: "declined" } : transfer),
});

export const acceptTransferByReceiver = (state: FamilyState, transferId: string, actorId: string): FamilyState => {
  const transfer = state.transfers.find((candidate) => candidate.id === transferId);
  if (!transfer || transfer.receiverId !== actorId || transfer.status !== "sender-confirmed" || starBalance(state, transfer.senderId) < transfer.amount) return state;
  const requiresParent = state.settings.parentApprovalThreshold !== null && transfer.amount > state.settings.parentApprovalThreshold;
  if (requiresParent) return { ...state, transfers: state.transfers.map((candidate) => candidate.id === transfer.id ? { ...candidate, status: "awaiting-parent", receiverConfirmedAt: now() } : candidate) };
  return completeTransfer(state, transfer, now(), null);
};

export const approveTransferByParent = (state: FamilyState, transferId: string, actorId: string): FamilyState => {
  const actor = state.members.find((member) => member.id === actorId);
  const transfer = state.transfers.find((candidate) => candidate.id === transferId);
  if (actor?.role !== "parent" || !transfer || transfer.status !== "awaiting-parent" || starBalance(state, transfer.senderId) < transfer.amount) return state;
  return completeTransfer(state, transfer, transfer.receiverConfirmedAt ?? now(), now());
};

const completeTransfer = (state: FamilyState, transfer: StarTransfer, receiverConfirmedAt: string, parentConfirmedAt: string | null): FamilyState => ({
  ...state,
  transfers: state.transfers.map((candidate) => candidate.id === transfer.id ? { ...candidate, status: "completed", receiverConfirmedAt, parentConfirmedAt } : candidate),
  ledger: [...state.ledger,
    { id: id(), memberId: transfer.senderId, actorId: transfer.senderId, type: "transfer-out", delta: -transfer.amount, note: transfer.note, createdAt: now(), relatedTransferId: transfer.id },
    { id: id(), memberId: transfer.receiverId, actorId: transfer.senderId, type: "transfer-in", delta: transfer.amount, note: transfer.note, createdAt: now(), relatedTransferId: transfer.id },
  ],
});

export const updateTransferSettings = (state: FamilyState, transferLimit: number | null, parentApprovalThreshold: number | null): FamilyState => ({ ...state, settings: { transferLimit, parentApprovalThreshold } });
