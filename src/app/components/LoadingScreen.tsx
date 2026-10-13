import { Clapperboard, LoaderCircle } from "lucide-react";
import { Button } from "../../ui";

export function LoadingScreen({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <div className="boot">
      <span className="brand-mark">
        <Clapperboard />
      </span>
      <h1>映序</h1>
      <p>正在打开你的创作工作台</p>
      {error ? (
        <>
          <p className="error-text">{error}</p>
          <Button variant="primary" onClick={() => onRetry()}>
            重新连接
          </Button>
        </>
      ) : (
        <LoaderCircle className="spin" />
      )}
    </div>
  );
}
