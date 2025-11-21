export function ThinkingIndicator() {
  return (
    <div className="text-sm text-muted-foreground italic flex items-center gap-2">
      <div className="flex space-x-1">
        <div className="w-1 h-1 bg-current rounded-full animate-pulse"></div>
        <div className="w-1 h-1 bg-current rounded-full animate-pulse" style={{ animationDelay: "0.2s" }}></div>
        <div className="w-1 h-1 bg-current rounded-full animate-pulse" style={{ animationDelay: "0.4s" }}></div>
      </div>
      <span>Thinking...</span>
    </div>
  );
}
