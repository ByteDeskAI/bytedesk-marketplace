import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorPanel } from "../components/ui/ErrorPanel";
import { Button } from "../components/ui/Button";

/** Per screen: a render crash in one panel leaves the rest of the board standing. */
export class ScreenBoundary extends Component<{ children: ReactNode; name: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.name}]`, error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="tm-screen">
        <ErrorPanel title={`${this.props.name} crashed`} detail={this.state.error.message} action={<Button size="sm" onClick={() => this.setState({ error: null })}>Try again</Button>} />
      </div>
    );
  }
}
