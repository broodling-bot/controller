import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useConnection } from "@/hooks/connection";
import { CreateController } from "./connect";
import { CreateSession } from "./connect/CreateSession";
import Controller from "@/utils/controller";
import type { AuthOptions } from "@cartridge/controller";
import {
  createVerifiedSession,
  requiresSessionApproval,
} from "@/utils/connection/session-creation";

/**
 * Standalone popup page rendered at /popup-auth.
 * Opened by the keychain iframe when `forcePopup` mode is active.
 *
 * - action=connect: Full signup/login flow + session creation
 * - action=create-session: Load controller from shared localStorage, create session
 *
 * On completion, signals the iframe via BroadcastChannel and closes.
 */
export function PopupAuth() {
  const [searchParams] = useSearchParams();
  const {
    controller,
    setController,
    policies,
    origin,
    isPoliciesResolved,
    isConfigLoading,
  } = useConnection();

  const channelId = searchParams.get("channel_id");
  const action = searchParams.get("action") as
    | "connect"
    | "create-session"
    | null;

  const channelRef = useRef<BroadcastChannel | null>(null);
  const [sessionComplete, setSessionComplete] = useState(false);

  // Open BroadcastChannel on mount
  useEffect(() => {
    if (!channelId) return;
    const channel = new BroadcastChannel(`popup-auth-${channelId}`);
    channelRef.current = channel;
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [channelId]);

  const signalComplete = useCallback((address: string, username: string) => {
    channelRef.current?.postMessage({
      type: "auth-complete",
      address,
      username,
    });
    // Small delay to ensure message is sent before closing
    setTimeout(() => window.close(), 300);
  }, []);

  const signalError = useCallback((error: string) => {
    channelRef.current?.postMessage({
      type: "auth-error",
      error,
    });
  }, []);

  // Parse signers from URL for connect flow
  const signers = useMemo(() => {
    const signersParam = searchParams.get("signers");
    if (!signersParam) return undefined;
    try {
      return JSON.parse(decodeURIComponent(signersParam)) as AuthOptions;
    } catch {
      return undefined;
    }
  }, [searchParams]);

  // For action=create-session: try to auto-create verified session
  useEffect(() => {
    if (
      action !== "create-session" ||
      !controller ||
      !policies ||
      sessionComplete
    ) {
      return;
    }

    if (!isPoliciesResolved || isConfigLoading) {
      return;
    }

    // If session doesn't require approval, create it automatically
    if (!requiresSessionApproval(policies)) {
      (async () => {
        try {
          await createVerifiedSession({ controller, origin, policies });
          signalComplete(controller.address(), controller.username());
          setSessionComplete(true);
        } catch (e) {
          console.error("[PopupAuth] Failed to auto-create session:", e);
          signalError(e instanceof Error ? e.message : String(e));
        }
      })();
    }
  }, [
    action,
    controller,
    policies,
    origin,
    isPoliciesResolved,
    isConfigLoading,
    sessionComplete,
    signalComplete,
    signalError,
  ]);

  // For action=connect: once controller exists (user signed up/logged in),
  // attempt auto session creation or show CreateSession
  useEffect(() => {
    if (action !== "connect" || !controller || !policies || sessionComplete) {
      return;
    }

    if (!isPoliciesResolved || isConfigLoading) {
      return;
    }

    // If no approval needed, create session and signal completion
    if (!requiresSessionApproval(policies)) {
      (async () => {
        try {
          await createVerifiedSession({ controller, origin, policies });
          signalComplete(controller.address(), controller.username());
          setSessionComplete(true);
        } catch (e) {
          console.error(
            "[PopupAuth] Failed to auto-create session after connect:",
            e,
          );
          // Don't signal error here — fall through to CreateSession UI
        }
      })();
    }
  }, [
    action,
    controller,
    policies,
    origin,
    isPoliciesResolved,
    isConfigLoading,
    sessionComplete,
    signalComplete,
  ]);

  // Handle no-policy connect: once controller exists, signal complete
  useEffect(() => {
    if (action !== "connect" || !controller || sessionComplete) {
      return;
    }

    if (!policies) {
      signalComplete(controller.address(), controller.username());
      setSessionComplete(true);
    }
  }, [action, controller, policies, sessionComplete, signalComplete]);

  if (!channelId || !action) {
    return (
      <div className="flex items-center justify-center h-screen text-foreground-300">
        <p>Missing popup parameters.</p>
      </div>
    );
  }

  // action=connect and no controller: show signup/login flow
  if (action === "connect" && !controller) {
    return <CreateController isSlot={false} signers={signers} />;
  }

  // action=create-session and no controller: load from storage
  if (action === "create-session" && !controller) {
    return <CreateSessionLoader setController={setController} />;
  }

  // Controller exists but policies need approval UI
  if (
    controller &&
    policies &&
    requiresSessionApproval(policies) &&
    !sessionComplete
  ) {
    return (
      <CreateSession
        policies={policies}
        onConnect={() => {
          signalComplete(controller.address(), controller.username());
          setSessionComplete(true);
        }}
        onSkip={() => {
          signalComplete(controller.address(), controller.username());
          setSessionComplete(true);
        }}
      />
    );
  }

  // Loading / waiting state
  return null;
}

/**
 * Loads controller from shared localStorage when popup opens for create-session.
 */
function CreateSessionLoader({
  setController,
}: {
  setController: (controller?: Controller) => void;
}) {
  const [error, setError] = useState<string>();

  useEffect(() => {
    (async () => {
      try {
        const ctrl = await Controller.fromStore();
        if (!ctrl) {
          setError("No account found. Please sign in first.");
          return;
        }
        window.controller = ctrl;
        setController(ctrl);
      } catch (e) {
        console.error("[PopupAuth] Failed to load controller:", e);
        setError(e instanceof Error ? e.message : "Failed to load account");
      }
    })();
  }, [setController]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen text-foreground-300">
        <p>{error}</p>
      </div>
    );
  }

  return null;
}
