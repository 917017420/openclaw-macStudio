// Device identity persistence via tauri-plugin-store

import { LazyStore } from "@tauri-apps/plugin-store";
import type { DeviceIdentity } from "./auth";

const DEVICE_STORE_KEY = "device-identity";

let store: LazyStore | null = null;

function getStore(): LazyStore {
  if (!store) {
    store = new LazyStore("openclaw-device.json");
  }
  return store;
}

/** Load persisted device identity */
export async function loadDeviceIdentity(): Promise<DeviceIdentity | null> {
  try {
    const s = getStore();
    return (await s.get<DeviceIdentity>(DEVICE_STORE_KEY)) ?? null;
  } catch {
    return null;
  }
}

/** Save device identity to secure store */
export async function saveDeviceIdentity(identity: DeviceIdentity): Promise<void> {
  const s = getStore();
  await s.set(DEVICE_STORE_KEY, identity);
  await s.save();
}
