const POPUP_WIDTH = 432;
const POPUP_HEIGHT = 700;
const POPUP_POLL_INTERVAL_MS = 500;

export type PopupAuthAction = "connect" | "create-session";

export interface PopupAuthOptions {
  action: PopupAuthAction;
  policies?: string;
  preset?: string;
  rpcUrl?: string;
  signers?: string;
  origin?: string;
}

export interface PopupAuthResult {
  address: string;
  username: string;
}

let activePopup: Window | null = null;

export function openPopupAuth(
  options: PopupAuthOptions,
): Promise<PopupAuthResult> {
  // Prevent multiple concurrent popups
  if (activePopup && !activePopup.closed) {
    activePopup.focus();
    return Promise.reject(new Error("A popup auth window is already open"));
  }

  const channelId = crypto.randomUUID();
  const channel = new BroadcastChannel(`popup-auth-${channelId}`);

  const url = new URL(`${window.location.origin}/popup-auth`);
  url.searchParams.set("channel_id", channelId);
  url.searchParams.set("action", options.action);

  if (options.policies) {
    url.searchParams.set("policies", options.policies);
  }
  if (options.preset) {
    url.searchParams.set("preset", options.preset);
  }
  if (options.rpcUrl) {
    url.searchParams.set("rpc_url", options.rpcUrl);
  }
  if (options.signers) {
    url.searchParams.set("signers", options.signers);
  }
  if (options.origin) {
    url.searchParams.set("origin", options.origin);
  }

  // Center the popup on screen
  const left = Math.round(
    (window.screen.width - POPUP_WIDTH) / 2 + (window.screenX || 0),
  );
  const top = Math.round(
    (window.screen.height - POPUP_HEIGHT) / 2 + (window.screenY || 0),
  );

  const popup = window.open(
    url.toString(),
    "cartridge-popup-auth",
    `width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top},scrollbars=yes,resizable=yes`,
  );

  if (!popup) {
    channel.close();
    return Promise.reject(
      new Error(
        "Popup blocked. Please allow popups for this site and try again.",
      ),
    );
  }

  activePopup = popup;

  return new Promise<PopupAuthResult>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      settled = true;
      activePopup = null;
      clearInterval(pollInterval);
      channel.close();
    };

    channel.onmessage = (event: MessageEvent) => {
      if (settled) return;

      const { type, address, username, error } = event.data ?? {};

      if (type === "auth-complete" && address) {
        cleanup();
        resolve({ address, username: username ?? "" });
      } else if (type === "auth-error") {
        cleanup();
        reject(new Error(error ?? "Popup authentication failed"));
      }
    };

    // Poll for popup closed (user manually closed the window)
    const pollInterval = setInterval(() => {
      if (popup.closed && !settled) {
        cleanup();
        reject(new Error("Popup was closed"));
      }
    }, POPUP_POLL_INTERVAL_MS);
  });
}
