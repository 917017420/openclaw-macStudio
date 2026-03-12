import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui";
import { getAppCopy } from "@/features/preferences/store";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      const copy = getAppCopy();

      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
          <AlertTriangle size={48} className="text-status-warning" />
          <h2 className="text-lg font-semibold text-text-primary">
            {copy.errorBoundary.title}
          </h2>
          <p className="max-w-md text-center text-sm text-text-secondary">
            {this.state.error?.message ?? copy.errorBoundary.fallback}
          </p>
          <Button variant="secondary" onClick={this.handleReset}>
            {copy.errorBoundary.retry}
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
