import { ScrollText } from "lucide-react";
import { Card } from "@/components/ui";
import { useConnectionStore } from "@/features/connection/store";
import { gateway } from "@/lib/gateway";
import { formatRelativeTime } from "@/lib/utils";

export function LogsPage() {
  const state = useConnectionStore((store) => store.state);
  const recentEvents = gateway.recentEvents.slice().reverse();

  if (state !== "connected") {
    return (
      <div className="workspace-empty-state">
        <ScrollText size={40} className="text-text-tertiary" />
        <h2 className="workspace-title">Logs</h2>
        <p className="workspace-subtitle">Connect a gateway to inspect the desktop client's recent event log.</p>
      </div>
    );
  }

  return (
    <div className="workspace-page">
      <div className="workspace-toolbar">
        <div>
          <h2 className="workspace-title">Logs</h2>
          <p className="workspace-subtitle">Recent gateway events captured locally by the desktop client.</p>
        </div>
      </div>

      <Card className="workspace-section">
        <div className="workspace-section__header">
          <div>
            <h3>Recent Events</h3>
            <p>{recentEvents.length} entries buffered in memory.</p>
          </div>
        </div>

        {recentEvents.length === 0 ? (
          <div className="workspace-empty-inline">No gateway events captured yet.</div>
        ) : (
          <div className="event-log-list">
            {recentEvents.map((event, index) => (
              <div key={`${event.event}-${event.time}-${index}`} className="event-log-row">
                <div>
                  <div className="tool-item__title">{event.event}</div>
                  <div className="workspace-subcopy">{formatRelativeTime(event.time)}</div>
                </div>
                <div className="workspace-subcopy mono">{new Date(event.time).toLocaleTimeString()}</div>
                <pre className="code-block code-block--compact">{event.payloadSnippet}</pre>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
