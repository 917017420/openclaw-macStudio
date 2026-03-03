import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import { ErrorBoundary } from "@/components/common";
import { ConnectionPage } from "@/features/connection";
import { ChatPage } from "@/features/chat";
import { AgentsPage } from "@/features/agents";
import { ChannelsPage } from "@/features/channels";
import { SettingsPage } from "@/features/settings";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<Navigate to="/connection" replace />} />
              <Route path="/connection" element={<ConnectionPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/channels" element={<ChannelsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
