import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  MessageSquare,
  Folder,
  Settings,
  Plug,
  LayoutTemplate,
  FileText,
  Bug,
  ScrollText,
  Monitor,
  Zap,
  BarChart3,
  Clock3,
  Link2,
} from "lucide-react";

interface NavItem {
  path: string;
  label: string;
  icon: ReactNode;
  aliases?: string[];
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: "Chat",
    items: [{ path: "/chat", label: "Chat", icon: <MessageSquare size={16} /> }],
  },
  {
    label: "Control",
    items: [
      { path: "/overview", label: "Overview", icon: <BarChart3 size={16} /> },
      { path: "/channels", label: "Channels", icon: <Link2 size={16} /> },
      { path: "/sessions", label: "Sessions", icon: <FileText size={16} /> },
      { path: "/usage", label: "Usage", icon: <BarChart3 size={16} /> },
      { path: "/cron", label: "Cron", icon: <Clock3 size={16} /> },
    ],
  },
  {
    label: "Agent",
    items: [
      { path: "/agents", label: "Agents", icon: <Folder size={16} /> },
      { path: "/skills", label: "Skills", icon: <Zap size={16} /> },
      { path: "/nodes", label: "Nodes", icon: <Monitor size={16} /> },
    ],
  },
  {
    label: "Settings",
    items: [
      { path: "/config", label: "Config", icon: <Settings size={16} />, aliases: ["/settings"] },
      { path: "/debug", label: "Debug", icon: <Bug size={16} /> },
      { path: "/logs", label: "Logs", icon: <ScrollText size={16} /> },
    ],
  },
];

const utilityNav: NavItem[] = [
  { path: "/connection", label: "Connection", icon: <Plug size={16} /> },
  { path: "/control-ui", label: "Control UI", icon: <LayoutTemplate size={16} /> },
];

function isActiveItem(pathname: string, item: NavItem) {
  if (pathname === item.path || item.aliases?.includes(pathname)) {
    return true;
  }
  return pathname.startsWith(`${item.path}/`) || Boolean(item.aliases?.some((alias) => pathname.startsWith(`${alias}/`)));
}

function NavButton({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`nav-item ${active ? "active" : ""}`} title={item.label}>
      {item.icon}
      <span>{item.label}</span>
    </button>
  );
}

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <aside className="nav no-select">
      {navGroups.map((group) => (
        <div className="nav-group" key={group.label}>
          <div className="nav-label">{group.label}</div>
          {group.items.map((item) => (
            <NavButton
              key={item.path}
              item={item}
              active={isActiveItem(location.pathname, item)}
              onClick={() => navigate(item.path)}
            />
          ))}
        </div>
      ))}

      <div className="nav-group nav-group--utility">
        <div className="nav-label">Utilities</div>
        {utilityNav.map((item) => (
          <NavButton
            key={item.path}
            item={item}
            active={isActiveItem(location.pathname, item)}
            onClick={() => navigate(item.path)}
          />
        ))}
      </div>
    </aside>
  );
}
