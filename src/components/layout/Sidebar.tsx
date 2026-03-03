import { useLocation, useNavigate } from "react-router-dom";
import {
  MessageSquare,
  Bot,
  Radio,
  Settings,
  Plug,
} from "lucide-react";

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { path: "/chat", label: "Chat", icon: <MessageSquare size={20} /> },
  { path: "/agents", label: "Agents", icon: <Bot size={20} /> },
  { path: "/channels", label: "Channels", icon: <Radio size={20} /> },
  { path: "/settings", label: "Settings", icon: <Settings size={20} /> },
];

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <aside className="no-select flex h-full w-14 flex-col items-center border-r border-border bg-sidebar py-3">
      {/* Connection shortcut */}
      <button
        onClick={() => navigate("/connection")}
        className={`mb-4 flex h-10 w-10 items-center justify-center rounded-xl transition-colors
          ${location.pathname === "/connection" ? "bg-primary text-text-inverse" : "text-text-secondary hover:bg-sidebar-active hover:text-text-primary"}`}
        title="Gateway Connection"
      >
        <Plug size={20} />
      </button>

      {/* Divider */}
      <div className="mb-3 h-px w-8 bg-border" />

      {/* Navigation items */}
      <nav className="flex flex-1 flex-col items-center gap-1">
        {navItems.map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors
                ${isActive ? "bg-sidebar-active text-text-primary" : "text-text-secondary hover:bg-sidebar-active hover:text-text-primary"}`}
              title={item.label}
            >
              {item.icon}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
