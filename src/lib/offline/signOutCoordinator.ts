export interface SignOutSteps {
  clearActiveOwner: () => void;
  clearPrivateCache: () => Promise<void>;
  signOutBrowser: () => Promise<unknown>;
  removeLocalData?: () => Promise<void>;
  navigateToLogin: () => void;
}

/** Privacy-sensitive ordering shared by the UI and regression tests. */
export async function coordinateSignOut(steps: SignOutSteps) {
  steps.clearActiveOwner();
  await steps.clearPrivateCache();
  try {
    await steps.signOutBrowser();
  } catch {
    // With local scope, Supabase removes the browser session before its best-effort server
    // revocation request. Navigation must still finish if that request reports an error.
  }
  if (steps.removeLocalData) await steps.removeLocalData();
  // Use a full-document GET after the cookie is gone. Calling a Server Action here would POST
  // to the protected current URL, where Proxy redirects before the action can execute.
  steps.navigateToLogin();
}

export function shouldIsolateOwner(previousOwnerId: string | null, nextOwnerId: string) {
  return previousOwnerId !== null && previousOwnerId !== nextOwnerId;
}
