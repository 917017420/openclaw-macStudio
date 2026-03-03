// Hook: useChatEvents — subscribes to Gateway chat/agent events and routes to store

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { gateway } from "@/lib/gateway";
import type { GatewayEvent } from "@/lib/gateway";
import { useChatStore } from "@/features/chat/store";
import { SESSIONS_QUERY_KEY } from "./useSessions";
import { messagesQueryKey } from "./useSessionMessages";
import { createAssistantMessage } from "@/features/chat/utils";
import { useConnectionStore } from "@/features/connection/store";

/**
 * Subscribes to Gateway `chat` and `agent` events.
 *
 * Server event structure:
 * - `agent` events carry streaming content: { stream, text, phase, session, run, aseq }
 *   - stream=lifecycle + phase=start/end → streaming boundaries
 *   - stream=assistant + text=... → cumulative full text (NOT delta)
 * - `chat` events are summary notifications
 *
 * Routing strategy: always use `selectedSessionId` from the store.
 * The sendMessage action sets this BEFORE calling chat.send.
 */
export function useChatEvents() {
  const isConnected = useConnectionStore((s) => s.state === "connected");
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isConnected) return;

    console.log("[useChatEvents] Setting up event subscriptions");

    const subs: Array<{ unsubscribe: () => void }> = [];

    // Wildcard event logger (always on for debugging)
    subs.push(
      gateway.on<GatewayEvent>("*", (event) => {
        console.log("[Gateway Event *]", JSON.stringify(event).slice(0, 300));
      }),
    );

    // ---- Agent events: streaming content ----
    subs.push(
      gateway.on("agent", (payload: unknown) => {
        const data = payload as Record<string, unknown>;
        const stream = data.stream as string | undefined;
        const store = useChatStore.getState();

        // Always route to currently selected session
        const sessionKey = store.selectedSessionId;

        console.log("[useChatEvents] >>> agent event received:", {
          stream,
          phase: data.phase,
          textLen: data.text ? String(data.text).length : 0,
          sessionKey,
          isStreaming: store.isStreaming,
          streamingMsgId: store.streamingMessageId,
          allSessionKeys: Object.keys(store.messagesBySession),
          msgCountInSession: sessionKey
            ? (store.messagesBySession[sessionKey]?.length ?? 0)
            : "N/A",
        });

        if (!sessionKey) {
          console.warn(
            "[useChatEvents] No session selected, dropping event. " +
            "selectedAgentId:", store.selectedAgentId,
          );
          return;
        }

        switch (stream) {
          case "lifecycle": {
            const phase = data.phase as string;
            if (phase === "start") {
              if (!store.streamingMessageId) {
                const msg = createAssistantMessage({ isStreaming: true });
                store.addMessage(sessionKey, msg);
                store.startStreaming(sessionKey, msg.id);
                console.log(
                  "[useChatEvents] Created streaming message:",
                  msg.id,
                  "in session:",
                  sessionKey,
                );
              } else {
                console.log(
                  "[useChatEvents] lifecycle:start but already streaming:",
                  store.streamingMessageId,
                );
              }
            } else if (phase === "end") {
              if (store.streamingMessageId) {
                store.finalizeStream(sessionKey, store.streamingMessageId);
                console.log("[useChatEvents] Finalized stream for session:", sessionKey);
              }
              // Refresh both session list AND message history
              queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
              queryClient.invalidateQueries({
                queryKey: messagesQueryKey(sessionKey),
              });
            }
            break;
          }

          case "assistant": {
            const text = data.text as string | undefined;
            if (text === undefined) {
              console.log("[useChatEvents] assistant event with no text, skipping");
              break;
            }

            if (!store.streamingMessageId) {
              // No lifecycle:start received yet — create message inline
              const msg = createAssistantMessage({
                isStreaming: true,
                content: text,
              });
              store.addMessage(sessionKey, msg);
              store.startStreaming(sessionKey, msg.id);
              console.log(
                "[useChatEvents] Created streaming msg (no lifecycle):",
                msg.id,
                "content:",
                text.slice(0, 100),
              );
            } else {
              store.setStreamContent(
                sessionKey,
                store.streamingMessageId,
                text,
              );
            }
            break;
          }

          default:
            console.log("[useChatEvents] Unhandled stream type:", stream, "data keys:", Object.keys(data));
            break;
        }
      }),
    );

    // ---- Chat events: summary notifications ----
    subs.push(
      gateway.on("chat", (payload: unknown) => {
        console.log("[useChatEvents] chat event:", payload);
        queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
      }),
    );

    return () => {
      console.log("[useChatEvents] Cleaning up event subscriptions");
      for (const sub of subs) {
        sub.unsubscribe();
      }
    };
  }, [isConnected, queryClient]);
}
