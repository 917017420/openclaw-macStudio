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
import { isChineseLanguage, useAppPreferencesStore } from "@/features/preferences/store";

const NAV_COPY = {
  en: {
    "group.chat": "Chat",
    "group.control": "Control",
    "group.agent": "Agent",
    "group.settings": "Settings",
    "group.utilities": "Utilities",
    "item.chat": "Chat",
    "item.overview": "Overview",
    "item.channels": "Channels",
    "item.sessions": "Sessions",
    "item.usage": "Usage",
    "item.cron": "Cron",
    "item.agents": "Agents",
    "item.skills": "Skills",
    "item.nodes": "Nodes",
    "item.config": "Config",
    "item.debug": "Debug",
    "item.logs": "Logs",
    "item.connection": "Connection",
    "item.controlUi": "Control UI",
  },
  zh: {
    "group.chat": "聊天",
    "group.control": "控制台",
    "group.agent": "智能体",
    "group.settings": "设置",
    "group.utilities": "工具",
    "item.chat": "聊天",
    "item.overview": "概览",
    "item.channels": "渠道",
    "item.sessions": "会话",
    "item.usage": "用量",
    "item.cron": "定时任务",
    "item.agents": "智能体",
    "item.skills": "技能",
    "item.nodes": "节点",
    "item.config": "配置",
    "item.debug": "调试",
    "item.logs": "日志",
    "item.connection": "连接",
    "item.controlUi": "控制界面",
  },
} as const;

type NavCopyKey = keyof typeof NAV_COPY.en;

interface NavItem {
  path: string;
  labelKey: NavCopyKey;
  icon: ReactNode;
  aliases?: string[];
}

interface NavGroup {
  labelKey: NavCopyKey;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    labelKey: "group.chat",
    items: [{ path: "/chat", labelKey: "item.chat", icon: <MessageSquare size={16} /> }],
  },
  {
    labelKey: "group.control",
    items: [
      { path: "/overview", labelKey: "item.overview", icon: <BarChart3 size={16} /> },
      { path: "/channels", labelKey: "item.channels", icon: <Link2 size={16} /> },
      { path: "/sessions", labelKey: "item.sessions", icon: <FileText size={16} /> },
      { path: "/usage", labelKey: "item.usage", icon: <BarChart3 size={16} /> },
      { path: "/cron", labelKey: "item.cron", icon: <Clock3 size={16} /> },
    ],
  },
  {
    labelKey: "group.agent",
    items: [
      { path: "/agents", labelKey: "item.agents", icon: <Folder size={16} /> },
      { path: "/skills", labelKey: "item.skills", icon: <Zap size={16} /> },
      { path: "/nodes", labelKey: "item.nodes", icon: <Monitor size={16} /> },
    ],
  },
  {
    labelKey: "group.settings",
    items: [
      { path: "/config", labelKey: "item.config", icon: <Settings size={16} />, aliases: ["/settings"] },
      { path: "/debug", labelKey: "item.debug", icon: <Bug size={16} /> },
      { path: "/logs", labelKey: "item.logs", icon: <ScrollText size={16} /> },
    ],
  },
];

const utilityNav: NavItem[] = [
  { path: "/connection", labelKey: "item.connection", icon: <Plug size={16} /> },
  { path: "/control-ui", labelKey: "item.controlUi", icon: <LayoutTemplate size={16} /> },
];

function isActiveItem(pathname: string, item: NavItem) {
  if (pathname === item.path || item.aliases?.includes(pathname)) {
    return true;
  }
  return pathname.startsWith(`${item.path}/`) || Boolean(item.aliases?.some((alias) => pathname.startsWith(`${alias}/`)));
}

function NavButton({
  item,
  active,
  label,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className={`nav-item ${active ? "active" : ""}`} title={label}>
      {item.icon}
      <span>{label}</span>
    </button>
  );
}

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const language = useAppPreferencesStore((store) => store.language);
  const copy = isChineseLanguage(language) ? NAV_COPY.zh : NAV_COPY.en;

  return (
    <aside className="nav no-select">
      {navGroups.map((group) => (
        <div className="nav-group" key={group.labelKey}>
          <div className="nav-label">{copy[group.labelKey]}</div>
          {group.items.map((item) => (
            <NavButton
              key={item.path}
              item={item}
              label={copy[item.labelKey]}
              active={isActiveItem(location.pathname, item)}
              onClick={() => navigate(item.path)}
            />
          ))}
        </div>
      ))}

      <div className="nav-group nav-group--utility">
        <div className="nav-label">{copy["group.utilities"]}</div>
        {utilityNav.map((item) => (
          <NavButton
            key={item.path}
            item={item}
            label={copy[item.labelKey]}
            active={isActiveItem(location.pathname, item)}
            onClick={() => navigate(item.path)}
          />
        ))}
      </div>
    </aside>
  );
}
