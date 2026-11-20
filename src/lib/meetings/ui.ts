import type { Tone } from "@/components/ui";
import type { InsightType, MeetingSource, MeetingStatus } from "@/lib/meetings/store";

export const INSIGHT_META: Record<InsightType, { label: string; tone: Tone }> = {
  win: { label: "Win", tone: "good" },
  risk: { label: "Risk", tone: "bad" },
  opportunity: { label: "Opportunity", tone: "brand" },
  decision: { label: "Decision", tone: "info" },
  client_request: { label: "Client request", tone: "warn" },
};

export const STATUS_META: Record<MeetingStatus, { label: string; tone: Tone }> = {
  pending: { label: "Queued", tone: "neutral" },
  processing: { label: "Analyzing…", tone: "info" },
  done: { label: "Analyzed", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
  skipped: { label: "Notes only", tone: "neutral" },
};

export const SOURCE_LABEL: Record<MeetingSource, string> = {
  paste: "Pasted",
  claude: "Saved from Claude",
  webhook: "Recorder (auto)",
};
