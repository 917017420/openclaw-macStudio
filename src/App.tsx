import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import { ErrorBoundary } from "@/components/common";
import { ConnectionPage } from "@/features/connection";
import { ChatPage } from "@/features/chat";
import { AgentsPage } from "@/features/agents";
import { ChannelsPage } from "@/features/channels";
import { SettingsPage } from "@/features/settings";
import { SessionsPage } from "@/features/sessions";
import { ControlUIPage } from "@/features/control";
import { OverviewPage } from "@/features/overview";
import { DebugPage } from "@/features/debug";
import { LogsPage } from "@/features/logs";
import { NodesPage } from "@/features/nodes";
import { SkillsPage } from "@/features/skills";
import { UsagePage } from "@/features/usage";
import { CronPage } from "@/features/cron";
import { useGateway } from "@/features/connection/hooks/useGateway";
import { useChatPersistence } from "@/features/chat/hooks/useChatPersistence";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

function AppBootstrap() {
  // Initialize persisted gateway configs + active gateway id.
  useGateway();
  // Persist and restore chat snapshots locally.
  useChatPersistence();
  return null;
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AppBootstrap />
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<Navigate to="/chat" replace />} />
              <Route path="/connection" element={<ConnectionPage />} />
              <Route path="/overview" element={<OverviewPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/sessions" element={<SessionsPage />} />
              <Route path="/channels" element={<ChannelsPage />} />
              <Route path="/skills" element={<SkillsPage />} />
              <Route path="/usage" element={<UsagePage />} />
              <Route path="/cron" element={<CronPage />} />
              <Route path="/logs" element={<LogsPage />} />
              <Route path="/nodes" element={<NodesPage />} />
              <Route path="/debug" element={<DebugPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/control-ui" element={<ControlUIPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
