export const ACTIONS = ["CLICK", "TYPE", "SELECT", "CHECK", "UPLOAD", "SCROLL", "WAIT", "BACK", "EXTRACT", "SUBMIT", "DONE", "FAIL", "ASK_HUMAN"] as const;

export type ActionName = (typeof ACTIONS)[number];

export interface ControlledAction {
  action: ActionName;
  target?: string;
  value?: string;
  confidence: number;
  reason: string;
}

export interface Decision<TAction extends ActionName = ActionName> {
  decision: "continue" | "ask-human" | "stop";
  confidence: number;
  reason: string;
  action: ControlledAction & { action: TAction };
}

export const CONFIDENCE_POLICY = {
  auto: 0.85,
  askHuman: 0.6,
} as const;

export function confidenceDecision(confidence: number): Decision["decision"] {
  if (confidence >= CONFIDENCE_POLICY.auto) return "continue";
  if (confidence >= CONFIDENCE_POLICY.askHuman) return "ask-human";
  return "stop";
}

export function isControlledAction(value: unknown): value is ControlledAction {
  if (typeof value !== "object" || value === null) return false;
  const action = value as Record<string, unknown>;
  return typeof action.action === "string" && ACTIONS.includes(action.action as ActionName)
    && typeof action.confidence === "number" && action.confidence >= 0 && action.confidence <= 1
    && typeof action.reason === "string" && (!("target" in action) || typeof action.target === "string")
    && (!("value" in action) || typeof action.value === "string");
}
