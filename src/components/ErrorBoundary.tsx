import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error caught by ErrorBoundary:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // Ignore storage errors
    }
    window.location.href = window.location.pathname;
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 font-mono">
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 text-2xl">
              <i className="fas fa-triangle-exclamation"></i>
            </div>
            
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">Application Encountered An Error</h1>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Cycle.exe encountered an unexpected issue while loading components. You can reload the page or reset cached session data.
              </p>
            </div>

            {this.state.error?.message && (
              <div className="text-left text-xs bg-slate-950 p-3 rounded-lg border border-slate-800 text-rose-400 break-words font-mono overflow-auto max-h-32">
                {this.state.error.message}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={this.handleReload}
                className="flex-1 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium text-xs transition cursor-pointer shadow-lg shadow-violet-600/20"
              >
                <i className="fas fa-rotate-right mr-1.5"></i> Reload App
              </button>
              <button
                type="button"
                onClick={this.handleReset}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs transition cursor-pointer border border-slate-700"
              >
                Clear Cache
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
