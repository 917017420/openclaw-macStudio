import { Outlet } from "react-router-dom";
import { TitleBar } from "./TitleBar";
import { Sidebar } from "./Sidebar";

export function AppLayout() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface-0 text-text-primary">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden p-2 sm:p-3">
          <div className="h-full overflow-hidden rounded-2xl border border-border/80 bg-chat-surface shadow-[0_10px_35px_rgba(0,0,0,0.08)] dark:shadow-[0_10px_35px_rgba(0,0,0,0.35)]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
