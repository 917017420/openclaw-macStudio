// Hook: useGateway — provides Gateway connection management

import { useCallback, useEffect, useRef } from "react";
import { useConnectionStore } from "@/features/connection/store";
import {
  loadConfigs,
  saveConfigs,
  loadActiveConfigId,
  saveActiveConfigId,
} from "@/features/connection/services";

/**
 * Hook for managing Gateway connection lifecycle.
 * Handles config persistence and connection state.
 */
export function useGateway() {
  const store = useConnectionStore();
  const hydratedRef = useRef(false);

  // Load persisted configs on mount
  useEffect(() => {
    let mounted = true;

    async function init() {
      const [configs, activeId] = await Promise.all([
        loadConfigs(),
        loadActiveConfigId(),
      ]);
      if (!mounted) return;

      // Hydrate store with persisted configs as-is (preserve ids and optional fields).
      const activeConfigId = activeId && configs.some((cfg) => cfg.id === activeId)
        ? activeId
        : null;
      useConnectionStore.setState((state) => ({
        ...state,
        configs,
        activeConfigId,
      }));
      hydratedRef.current = true;
    }

    init();
    return () => {
      mounted = false;
    };
  }, []);

  // Persist configs when they change
  useEffect(() => {
    if (!hydratedRef.current) return;
    saveConfigs(store.configs);
  }, [store.configs]);

  // Persist active config ID
  useEffect(() => {
    if (!hydratedRef.current) return;
    saveActiveConfigId(store.activeConfigId);
  }, [store.activeConfigId]);

  const connectToGateway = useCallback(
    async (configId: string) => {
      await store.connect(configId);
    },
    [store],
  );

  const disconnectFromGateway = useCallback(async () => {
    await store.disconnect();
  }, [store]);

  return {
    state: store.state,
    error: store.error,
    configs: store.configs,
    activeConfigId: store.activeConfigId,
    isConnected: store.state === "connected",
    connect: connectToGateway,
    disconnect: disconnectFromGateway,
    addConfig: store.addConfig,
    updateConfig: store.updateConfig,
    removeConfig: store.removeConfig,
  };
}
