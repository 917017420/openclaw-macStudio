// StreamingIndicator — animated dots indicating streaming in progress

import { memo } from "react";

export const StreamingIndicator = memo(function StreamingIndicator() {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label="Generating response">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:0ms]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:300ms]" />
    </span>
  );
});
