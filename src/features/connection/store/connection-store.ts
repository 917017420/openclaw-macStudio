// Connection store — manages Gateway connection state

import { create } from "zustand";
import type { ConnectionError, ConnectionState, GatewayConfig } from "@/lib/gateway/types";
import { gateway } from "@/lib/gateway/client";

interface ConnectionStore {
  // State
  state: ConnectionState;
  error: ConnectionError | null;
  configs: GatewayConfig[];
  activeConfigId: string | null;

  // Actions
  addConfig: (config: Omit<GatewayConfig, "id">) => GatewayConfig;
  updateConfig: (id: string, updates: Partial<GatewayConfig>) => void;
  removeConfig: (id: string) => void;
  setActiveConfig: (id: string | null) => void;
  connect: (configId: string) => Promise<void>;
  disconnect: () => Promise<void>;
  setState: (state: ConnectionState) => void;
  setError: (error: ConnectionError | null) => void;
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  state: "disconnected",
  error: null,
  configs: [],
  activeConfigId: null,

  addConfig: (configData) => {
    const config: GatewayConfig = {
      ...configData,
      id: crypto.randomUUID(),
    };
    set((s) => ({ configs: [...s.configs, config] }));
    return config;
  },

  updateConfig: (id, updates) => {
    set((s) => ({
      configs: s.configs.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    }));
  },

  removeConfig: (id) => {
    set((s) => ({
      configs: s.configs.filter((c) => c.id !== id),
      activeConfigId: s.activeConfigId === id ? null : s.activeConfigId,
    }));
  },

  setActiveConfig: (id) => {
    set({ activeConfigId: id });
  },

  connect: async (configId) => {
    const existingConfig = get().configs.find((c) => c.id === configId);
    if (!existingConfig) throw new Error("Config not found");
    const config = { ...existingConfig };

    set({ activeConfigId: configId, error: null });

    // Listen for state changes
    const sub = gateway.onStateChange((state) => {
      const normalizedState: ConnectionState =
        state === "reconnecting" ? "disconnected" : state;
      set({ state: normalizedState, error: gateway.error });
    });

    try {
      await gateway.connect(config);

      // Persist issued device token/device identity for future reconnects.
      const auth = gateway.authResult;
      if (auth?.deviceToken) {
        get().updateConfig(configId, {
          deviceToken: auth.deviceToken,
        });
      }
    } catch (err) {
      sub.unsubscribe();
      throw err;
    }
  },

  disconnect: async () => {
    await gateway.disconnect();
    set({ state: "disconnected", error: null });
  },

  setState: (state) => set({ state }),
  setError: (error) => set({ error }),
}));
