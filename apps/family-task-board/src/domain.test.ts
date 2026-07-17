import { describe, expect, it } from "@rstest/core";
import { acceptTransferByReceiver, addMember, addShopItem, addStarAdjustment, addTask, confirmTransferBySender, createFamily, proposeTransfer, purchaseReward, starBalance, transitionPurchase, updateTaskStatus, updateTransferSettings } from "./domain";

const household = () => {
  let state = createFamily("Rivera", "Alex");
  state = addMember(state, "Sam", "kid");
  const kid = state.members[1]!;
  state = addTask(state, { title: "Laundry", assigneeId: kid.id, kind: "required", stars: 3, dueLabel: "Tonight", durationMinutes: 10 });
  state = addShopItem(state, { title: "Game time", description: "Thirty minutes", cost: 2, icon: "🎮", inventory: null });
  return { state, kid };
};

describe("family task board domain", () => {
  it("creates a household without seeded records", () => {
    const state = createFamily("Rivera", "Alex");
    expect(state.tasks).toHaveLength(0);
    expect(state.events).toHaveLength(0);
    expect(state.shop).toHaveLength(0);
  });
  it("awards a task once", () => {
    const { state, kid } = household();
    const approved = updateTaskStatus(state, state.tasks[0]!.id, "approved");
    expect(starBalance(updateTaskStatus(approved, state.tasks[0]!.id, "approved"), kid.id)).toBe(3);
  });
  it("purchases from persisted ledger data", () => {
    const { state, kid } = household();
    const funded = addStarAdjustment(state, state.members[0]!.id, kid.id, 4, "Bonus");
    const purchased = purchaseReward(funded, kid.id, funded.shop[0]!.id);
    expect(starBalance(purchased, kid.id)).toBe(2);
    expect(purchased.purchases).toHaveLength(1);
  });
  it("moves stars only after sender and receiver confirm", () => {
    let { state, kid } = household();
    state = addMember(state, "Riley", "kid");
    const receiver = state.members[2]!;
    state = addStarAdjustment(state, state.members[0]!.id, kid.id, 6, "Allowance");
    state = proposeTransfer(state, kid.id, receiver.id, 3, "Helped with cleanup");
    const proposal = state.transfers[0]!;
    expect(starBalance(state, kid.id)).toBe(6);
    state = confirmTransferBySender(state, proposal.id, kid.id);
    expect(starBalance(state, receiver.id)).toBe(0);
    state = acceptTransferByReceiver(state, proposal.id, receiver.id);
    expect(starBalance(state, kid.id)).toBe(3);
    expect(starBalance(state, receiver.id)).toBe(3);
    expect(state.ledger.filter((entry) => entry.relatedTransferId === proposal.id)).toHaveLength(2);
  });
  it("requires parent approval above the configured transfer threshold", () => {
    let { state, kid } = household();
    state = addMember(state, "Riley", "kid");
    const receiver = state.members[2]!;
    state = addStarAdjustment(state, state.members[0]!.id, kid.id, 10, "Allowance");
    state = updateTransferSettings(state, 10, 4);
    state = proposeTransfer(state, kid.id, receiver.id, 5, "Shared reward");
    state = confirmTransferBySender(state, state.transfers[0]!.id, kid.id);
    state = acceptTransferByReceiver(state, state.transfers[0]!.id, receiver.id);
    expect(state.transfers[0]?.status).toBe("awaiting-parent");
    expect(starBalance(state, receiver.id)).toBe(0);
  });
  it("enforces purchase transitions and appends a single refund", () => {
    let { state, kid } = household();
    const parent = state.members[0]!;
    state = addStarAdjustment(state, parent.id, kid.id, 4, "Allowance");
    state = purchaseReward(state, kid.id, state.shop[0]!.id);
    const purchase = state.purchases[0]!;
    expect(transitionPurchase(state, purchase.id, "consumed", parent.id)).toBe(state);
    state = transitionPurchase(state, purchase.id, "declined", parent.id);
    expect(state.purchases[0]?.status).toBe("declined");
    expect(starBalance(state, kid.id)).toBe(4);
    expect(state.ledger.filter((entry) => entry.relatedPurchaseId === purchase.id && entry.type === "refund")).toHaveLength(1);
  });
});
