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
    <aside className="no-select flex h-full w-16 flex-col items-center border-r border-border/70 bg-sidebar/95 py-3 backdrop-blur">
      {/* Connection shortcut */}
      <button
        onClick={() => navigate("/connection")}
        className={`mb-4 flex h-11 w-11 items-center justify-center rounded-2xl transition-all duration-200
          ${location.pathname === "/connection" ? "bg-primary text-text-inverse shadow-md shadow-primary/30" : "text-text-secondary hover:-translate-y-0.5 hover:bg-sidebar-active hover:text-text-primary"}`}
        title="Gateway Connection"
      >
        <Plug size={20} />
      </button>

      {/* Divider */}
      <div className="mb-3 h-px w-9 bg-border" />

      {/* Navigation items */}
      <nav className="flex flex-1 flex-col items-center gap-1">
        {navItems.map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex h-11 w-11 items-center justify-center rounded-2xl transition-all duration-200
                ${isActive ? "bg-sidebar-active text-primary shadow-sm ring-1 ring-border/70" : "text-text-secondary hover:-translate-y-0.5 hover:bg-sidebar-active hover:text-text-primary"}`}
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
