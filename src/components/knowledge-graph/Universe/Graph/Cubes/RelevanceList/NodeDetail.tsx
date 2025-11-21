import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

const formatLabel = (label: string) => label.replaceAll("_", " ").replaceAll(/\b\w/g, (char) => char.toUpperCase());

const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

interface NodeDetailProps {
  label: string;
  value: unknown;
  compact?: boolean;
}

export const NodeDetail = ({ label, value, compact = false }: NodeDetailProps) => {
  if (!value || value === "") {
    return null;
  }

  const stringValue = String(value);
  const isLong = stringValue.length > 100;
  const isCode = ["frame", "code", "body", "content", "interface"].includes(label.toLowerCase());
  const isDate = label.toLowerCase().includes("date") && !Number.isNaN(Number(value));

  let displayValue: string = stringValue;
  if (isDate) {
    displayValue = formatDate(Number(value));
  }

  if (compact) {
    return (
      <div className="text-xs text-gray-400">
        <span className="font-medium">{formatLabel(label)}:</span>{" "}
        <span className="text-gray-300">
          {isDate ? displayValue : stringValue.length > 50 ? `${stringValue.slice(0, 50)}...` : displayValue}
        </span>
      </div>
    );
  }

  return (
    <div className="mb-3 pb-3 border-b border-gray-700/50 last:border-b-0">
      <div className="text-sm font-semibold text-gray-300 mb-2">{formatLabel(label)}</div>
      <div className="text-sm text-gray-100">
        {isCode && stringValue.length > 50 ? (
          <div className="rounded overflow-hidden">
            <SyntaxHighlighter
              language="javascript"
              style={vscDarkPlus}
              customStyle={{
                margin: 0,
                padding: "12px",
                fontSize: "11px",
                maxHeight: "200px",
                overflow: "auto",
              }}
            >
              {displayValue}
            </SyntaxHighlighter>
          </div>
        ) : (
          <div className={`${isLong ? "max-h-32 overflow-y-auto" : ""} whitespace-pre-wrap break-words`}>
            {displayValue}
          </div>
        )}
      </div>
    </div>
  );
};
