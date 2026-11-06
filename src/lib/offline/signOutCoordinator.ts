export interface SignOutSteps {
  clearActiveOwner: () => void;
  clearPrivateCache: () => Promise<void>;
  signOutBrowser: () => Promise<unknown>;
  removeLocalData?: () => Promise<void>;
  signOutServer: () => Promise<unknown>;
}

/** Privacy-sensitive ordering shared by the UI and regression tests. */
export async function coordinateSignOut(steps: SignOutSteps) {
  steps.clearActiveOwner();
  await steps.clearPrivateCache();
  try {
    await steps.signOutBrowser();
  } catch {
    // Cache/owner cleanup must still be followed by the server logout for an expired or already
    // removed browser session.
  }
  if (steps.removeLocalData) await steps.removeLocalData();
  await steps.signOutServer();
}

export function shouldIsolateOwner(previousOwnerId: string | null, nextOwnerId: string) {
  return previousOwnerId !== null && previousOwnerId !== nextOwnerId;
}
