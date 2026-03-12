import { useEffect, useRef } from "react";
import { LazyStore } from "@tauri-apps/plugin-store";
import { useChatStore } from "@/features/chat/store";

const STORE_FILE = "openclaw-chat.json";
const CHAT_STATE_KEY = "chat-state-v2";
const SAVE_DEBOUNCE_MS = 350;

interface PersistedChatState {
  version: 2;
  selectedAgentId: string | null;
  selectedSessionId: string | null;
  selectedModelId: string | null;
}

let store: LazyStore | null = null;

function getStore(): LazyStore {
  if (!store) {
    store = new LazyStore(STORE_FILE);
  }
  return store;
}

async function loadPersistedChatState(): Promise<PersistedChatState | null> {
  try {
    const s = getStore();
    const raw = await s.get<PersistedChatState>(CHAT_STATE_KEY);
    if (!raw || raw.version !== 2) return null;

    return {
      version: 2,
      selectedAgentId: raw.selectedAgentId ?? null,
      selectedSessionId: raw.selectedSessionId ?? null,
      selectedModelId: raw.selectedModelId ?? null,
    };
  } catch {
    return null;
  }
}

async function savePersistedChatState(state: PersistedChatState): Promise<void> {
  const s = getStore();
  await s.set(CHAT_STATE_KEY, state);
  await s.save();
}

export function useChatPersistence() {
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  const selectedSessionId = useChatStore((s) => s.selectedSessionId);
  const selectedModelId = useChatStore((s) => s.selectedModelId);

  const hydratedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let mounted = true;

    async function hydrate() {
      try {
        const persisted = await loadPersistedChatState();
        if (!mounted || !persisted) return;

        useChatStore.setState((state) => {
          if (
            state.selectedAgentId === persisted.selectedAgentId &&
            state.selectedSessionId === (persisted.selectedSessionId ?? state.selectedSessionId) &&
            state.selectedModelId === persisted.selectedModelId
          ) {
            return state;
          }
          return {
            ...state,
            selectedAgentId: persisted.selectedAgentId,
            selectedSessionId: persisted.selectedSessionId ?? state.selectedSessionId,
            selectedModelId: persisted.selectedModelId,
          };
        });
      } finally {
        hydratedRef.current = true;
      }
    }

    void hydrate();

    return () => {
      mounted = false;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      const payload: PersistedChatState = {
        version: 2,
        selectedAgentId,
        selectedSessionId,
        selectedModelId,
      };
      void savePersistedChatState(payload);
    }, SAVE_DEBOUNCE_MS);
  }, [
    selectedAgentId,
    selectedSessionId,
    selectedModelId,
  ]);
}
