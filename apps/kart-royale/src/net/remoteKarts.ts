/**
 * Registry of kart ids whose pose is network-owned in the current race.
 * The Items system reads it to keep remote karts from consuming local item
 * boxes or being hit by local projectiles — those events belong to the kart
 * owner's client. Written by the network adapter when a roster is applied.
 */
const remoteKartIds = new Set<number>();

export function setRemoteKarts(ids: Iterable<number>): void {
  remoteKartIds.clear();
  for (const id of ids) remoteKartIds.add(id);
}

export function clearRemoteKarts(): void {
  remoteKartIds.clear();
}

export function isRemoteKart(kart: { id: number }): boolean {
  return remoteKartIds.has(kart.id);
}
