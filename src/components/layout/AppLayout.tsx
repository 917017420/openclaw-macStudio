import { Outlet } from "react-router-dom";
import { TitleBar } from "./TitleBar";
import { Sidebar } from "./Sidebar";

export function AppLayout() {
  return (
    <div className="shell">
      <TitleBar />
      <Sidebar />
      <main className="content">
        <div className="page-card">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
