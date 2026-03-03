// Hook: useGateway — provides Gateway connection management

import { useCallback, useEffect } from "react";
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

  // Load persisted configs on mount
  useEffect(() => {
    let mounted = true;

    async function init() {
      const [configs, activeId] = await Promise.all([
        loadConfigs(),
        loadActiveConfigId(),
      ]);
      if (!mounted) return;

      if (configs.length > 0) {
        // Hydrate store with saved configs
        for (const config of configs) {
          useConnectionStore.getState().addConfig({
            name: config.name,
            url: config.url,
            token: config.token,
            deviceToken: config.deviceToken,
          });
        }
        if (activeId) {
          useConnectionStore.getState().setActiveConfig(activeId);
        }
      }
    }

    init();
    return () => {
      mounted = false;
    };
  }, []);

  // Persist configs when they change
  useEffect(() => {
    saveConfigs(store.configs);
  }, [store.configs]);

  // Persist active config ID
  useEffect(() => {
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
