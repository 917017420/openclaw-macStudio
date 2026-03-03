// Gateway connection persistence service

import { LazyStore } from "@tauri-apps/plugin-store";
import type { GatewayConfig } from "@/lib/gateway/types";

const STORE_KEY = "gateway-configs";
const ACTIVE_KEY = "active-gateway";

let store: LazyStore | null = null;

function getStore(): LazyStore {
  if (!store) {
    store = new LazyStore("openclaw-settings.json");
  }
  return store;
}

/** Load saved Gateway configs */
export async function loadConfigs(): Promise<GatewayConfig[]> {
  try {
    const s = getStore();
    const configs = await s.get<GatewayConfig[]>(STORE_KEY);
    return configs ?? [];
  } catch {
    return [];
  }
}

/** Save Gateway configs */
export async function saveConfigs(configs: GatewayConfig[]): Promise<void> {
  const s = getStore();
  await s.set(STORE_KEY, configs);
  await s.save();
}

/** Load active config ID */
export async function loadActiveConfigId(): Promise<string | null> {
  try {
    const s = getStore();
    return (await s.get<string>(ACTIVE_KEY)) ?? null;
  } catch {
    return null;
  }
}

/** Save active config ID */
export async function saveActiveConfigId(id: string | null): Promise<void> {
  const s = getStore();
  await s.set(ACTIVE_KEY, id);
  await s.save();
}
