import { useLocation, useNavigate } from "react-router-dom";
import { MessageSquare, Bot, Radio, Settings, Plug } from "lucide-react";

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
}

const coreNav: NavItem[] = [
  { path: "/chat", label: "Chat", icon: <MessageSquare size={16} /> },
  { path: "/agents", label: "Agents", icon: <Bot size={16} /> },
  { path: "/channels", label: "Channels", icon: <Radio size={16} /> },
  { path: "/settings", label: "Settings", icon: <Settings size={16} /> },
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
    </aside>
  );
}
