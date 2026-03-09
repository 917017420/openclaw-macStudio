import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  MessageSquare,
  Bot,
  Radio,
  Settings,
  Plug,
  LayoutTemplate,
  FileText,
  LayoutDashboard,
  Bug,
  ScrollText,
  Network,
  Wrench,
  BarChart3,
  Clock3,
} from "lucide-react";

interface NavItem {
  path: string;
  label: string;
  icon: ReactNode;
}

const coreNav: NavItem[] = [
  { path: "/overview", label: "Overview", icon: <LayoutDashboard size={16} /> },
  { path: "/chat", label: "Chat", icon: <MessageSquare size={16} /> },
  { path: "/sessions", label: "Sessions", icon: <FileText size={16} /> },
  { path: "/agents", label: "Agents", icon: <Bot size={16} /> },
  { path: "/channels", label: "Channels", icon: <Radio size={16} /> },
  { path: "/skills", label: "Skills", icon: <Wrench size={16} /> },
  { path: "/usage", label: "Usage", icon: <BarChart3 size={16} /> },
  { path: "/cron", label: "Cron", icon: <Clock3 size={16} /> },
  { path: "/settings", label: "Settings", icon: <Settings size={16} /> },
  { path: "/control-ui", label: "Control UI", icon: <LayoutTemplate size={16} /> },
];

const diagnosticsNav: NavItem[] = [
  { path: "/logs", label: "Logs", icon: <ScrollText size={16} /> },
  { path: "/nodes", label: "Nodes", icon: <Network size={16} /> },
  { path: "/debug", label: "Debug", icon: <Bug size={16} /> },
];

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <aside className="nav no-select">
      <div className="nav-group">
        <div className="nav-label">Gateway</div>
        <button
          onClick={() => navigate("/connection")}
          className={`nav-item ${location.pathname === "/connection" ? "active" : ""}`}
          title="Connection"
        >
          <Plug size={16} />
          <span>Connection</span>
        </button>
      </div>

      <div className="nav-group">
        <div className="nav-label">Workspace</div>
        {coreNav.map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`nav-item ${isActive ? "active" : ""}`}
              title={item.label}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className="nav-group">
        <div className="nav-label">Diagnostics</div>
        {diagnosticsNav.map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`nav-item ${isActive ? "active" : ""}`}
              title={item.label}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
