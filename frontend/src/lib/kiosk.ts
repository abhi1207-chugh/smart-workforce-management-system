import { api } from "./api";

export interface LaunchCode {
  code: string;
  expires_in_seconds: number;
}

/** The code travels in the URL fragment so it is never sent to the server, logged or put in a Referer. */
export function kioskLaunchUrl(code: string): string {
  return `/kiosk#code=${encodeURIComponent(code)}`;
}

export function parseLaunchCode(hash: string): string | null {
  const m = /^#code=([A-Za-z0-9_-]{20,200})$/.exec(hash);
  return m ? m[1] : null;
}

/**
 * Admin action: mint a one-time code and open the kiosk page with it. The tab is opened
 * synchronously (inside the click) so popup blockers allow it, then pointed at the kiosk.
 */
export async function launchKiosk(): Promise<void> {
  const tab = window.open("about:blank", "_blank");
  if (!tab) throw new Error("Your browser blocked the new tab. Allow pop-ups for this site and try again.");
  try {
    const { code } = await api<LaunchCode>("/kiosk/launch", { method: "POST" });
    tab.opener = null;
    tab.location.href = kioskLaunchUrl(code);
  } catch (e) {
    tab.close();
    throw e;
  }
}
