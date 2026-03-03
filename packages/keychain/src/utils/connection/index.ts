import Controller from "@/utils/controller";
import { connectToParent } from "@cartridge/penpal";
import { normalize } from "@cartridge/ui/utils";
import { connect } from "./connect";
import { deployFactory } from "./deploy";
import { estimateInvokeFee } from "./estimate";
import { execute } from "./execute";
import type {
  HeadlessConnectParent,
  HeadlessConnectionState,
} from "./headless";
import { headlessConnect } from "./headless";
import { probe } from "./probe";
import { openSettingsFactory } from "./settings";
import { signMessageFactory } from "./sign";
import { switchChain } from "./switchChain";
import { navigateFactory } from "./navigate";
import { updateSession } from "./update-session";
import { openPopupAuth } from "./popup";
import type {
  AuthOptions,
  ConnectOptions,
  ConnectReply,
  SessionPolicies,
  StarterpackOptions,
} from "@cartridge/controller";
import { ResponseCodes } from "@cartridge/controller";
import { waitForHeadlessApprovalRequest } from "./headless-requests";
import { createConnectHandler } from "./connect-routing";

export type { ControllerError } from "./execute";

export function connectToController<
  ParentMethods extends HeadlessConnectParent,
>({
  setRpcUrl,
  setController,
  navigate,
  propagateError,
  errorDisplayMode,
  getParent,
  getConnectionState,
}: {
  setRpcUrl: (url: string) => void;
  setController: (controller?: Controller) => void;
  navigate: (
    to: string | number,
    options?: { replace?: boolean; state?: unknown },
  ) => void;
  propagateError?: boolean;
  errorDisplayMode?: "modal" | "notification" | "silent";
  getParent: () => ParentMethods | undefined;
  getConnectionState: () => HeadlessConnectionState;
}) {
  const uiConnect = connect({
    navigate,
    setRpcUrl,
  });

  const headlessConnectImpl = headlessConnect({
    setController,
    getParent,
    getConnectionState,
  });

  return connectToParent<ParentMethods>({
    methods: {
      connect: normalize((origin) => {
        const uiConnectFn = uiConnect();
        const headlessConnectFn = headlessConnectImpl(origin);

        return async (
          policiesOrOptions?: SessionPolicies | AuthOptions | ConnectOptions,
          rpcUrl?: string,
          signupOptions?: AuthOptions,
        ) => {
          // Check if forcePopup mode is enabled via URL params
          const isForcePopup =
            new URLSearchParams(window.location.search).get("force_popup") ===
            "true";

          if (isForcePopup) {
            return popupConnect({
              setController,
              signupOptions,
              policiesOrOptions,
            });
          }

          const handler = createConnectHandler({
            uiConnect: uiConnectFn,
            headlessConnect: headlessConnectFn,
            navigate,
            getParent,
            waitForApproval: waitForHeadlessApprovalRequest,
            getConnectedAddress: () => window.controller?.address?.(),
          });

          return handler(policiesOrOptions, rpcUrl, signupOptions);
        };
      }),
      deploy: () => deployFactory({ navigate }),
      execute: normalize(
        execute({ navigate, propagateError, errorDisplayMode }),
      ),
      estimateInvokeFee: () => estimateInvokeFee,
      probe: normalize(probe({ setController })),
      signMessage: normalize(
        signMessageFactory({
          navigate,
        }),
      ),
      openSettings: () => openSettingsFactory(),
      navigate: () => navigateFactory(),
      reset: () => () => {
        // Reset handled by navigation
      },
      disconnect: () => async () => {
        // First clear the React state
        setController(undefined);
        // Then cleanup the controller
        await window.controller?.disconnect();
      },
      logout: () => async () => {
        // First clear the React state
        setController(undefined);
        // Then cleanup the controller
        await window.controller?.disconnect();
      },
      username: () => () => window.controller?.username(),
      delegateAccount: () => () => window.controller?.delegateAccount(),
      openPurchaseCredits: () => () => {
        navigate("/funding", { replace: true });
      },
      openStarterPack:
        () => (id: string | number, options?: StarterpackOptions) => {
          navigate(
            `/purchase/starterpack/${id}${options?.preimage ? `?preimage=${options.preimage}` : ""}`,
            { replace: true },
          );
        },
      switchChain: () => switchChain({ setController, setRpcUrl }),
      updateSession: updateSession({ navigate }),
    },
  });
}

/**
 * Opens a popup for the connect flow when popup mode is enabled.
 * The popup handles WebAuthn operations (signup, login, session creation)
 * at the top level where WebAuthn always works.
 * Since the popup is same-origin, localStorage is shared — the controller
 * state written by the popup is automatically available to the iframe.
 */
async function popupConnect({
  setController,
  signupOptions,
  policiesOrOptions,
}: {
  setController: (controller?: Controller) => void;
  signupOptions?: AuthOptions;
  policiesOrOptions?: SessionPolicies | AuthOptions | ConnectOptions;
}): Promise<ConnectReply> {
  // Determine the action based on whether a controller already exists
  const action = window.controller ? "create-session" : "connect";

  // Forward relevant URL params from the iframe to the popup
  const iframeParams = new URLSearchParams(window.location.search);

  const popupOptions: Parameters<typeof openPopupAuth>[0] = {
    action,
    preset: iframeParams.get("preset") ?? undefined,
    rpcUrl: iframeParams.get("rpc_url")
      ? decodeURIComponent(iframeParams.get("rpc_url")!)
      : undefined,
    policies: iframeParams.get("policies") ?? undefined,
    origin: iframeParams.get("origin") ?? undefined,
  };

  // Pass signers for connect flow
  if (action === "connect") {
    let signers: AuthOptions | undefined;
    if (Array.isArray(policiesOrOptions)) {
      signers = policiesOrOptions as AuthOptions;
    } else if (
      policiesOrOptions &&
      typeof policiesOrOptions === "object" &&
      "signupOptions" in policiesOrOptions
    ) {
      signers = (policiesOrOptions as ConnectOptions).signupOptions;
    }
    signers = signers ?? signupOptions;

    if (signers) {
      popupOptions.signers = encodeURIComponent(JSON.stringify(signers));
    }
  }

  const result = await openPopupAuth(popupOptions);

  // Reload controller from shared localStorage
  const controller = await Controller.fromStore();
  if (controller) {
    window.controller = controller;
    setController(controller);
  }

  return {
    code: ResponseCodes.SUCCESS,
    address: result.address,
  };
}
