import { AlertTriangle, XCircle, Lightbulb } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ConstraintSuggestion, ConstraintViolation } from "../../types";

type Props = {
  violations: ConstraintViolation[];
  suggestions: ConstraintSuggestion[];
};

export function ConstraintFeedback({ violations, suggestions }: Props) {
  const blocking = violations.filter((v) => v.severity === "BLOCKING");
  const warnings = violations.filter((v) => v.severity === "WARNING");

  return (
    <Card className="border-orange-200">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-orange-700">
          <AlertTriangle size={16} />
          Constraint Violations
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {blocking.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-red-600 uppercase tracking-wider">
              Blocking ({blocking.length})
            </p>
            <ul className="space-y-1.5">
              {blocking.map((v, index) => (
                <li
                  key={`${v.rule}-${v.message}-${index}`}
                  className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2"
                >
                  <XCircle size={14} className="text-red-500 mt-0.5 shrink-0" />
                  <span className="text-sm text-red-700">{v.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-amber-600 uppercase tracking-wider">
              Warnings ({warnings.length})
            </p>
            <ul className="space-y-1.5">
              {warnings.map((v, index) => (
                <li
                  key={`${v.rule}-${v.message}-${index}`}
                  className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2"
                >
                  <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                  <span className="text-sm text-amber-700">{v.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider">
              Suggestions
            </p>
            <ul className="space-y-1.5">
              {suggestions.map((s, index) => (
                <li
                  key={`suggestion-${index}`}
                  className="flex items-start gap-2 rounded-md bg-blue-50 border border-blue-200 px-3 py-2"
                >
                  <Lightbulb size={14} className="text-blue-500 mt-0.5 shrink-0" />
                  <span className="text-sm text-blue-700">
                    <span className="font-medium">{s.name}</span> — {s.reason}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
