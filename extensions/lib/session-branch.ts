import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Whether leafId is the current leaf or an ancestor of the active branch. */
export function branchContainsLeaf(
  ctx: ExtensionContext,
  leafId: string | null,
) {
  if (ctx.sessionManager.getLeafId() === leafId) return true;
  if (leafId === null) return false;
  return ctx.sessionManager.getBranch().some((entry) => entry.id === leafId);
}
