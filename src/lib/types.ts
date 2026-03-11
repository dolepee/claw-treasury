export type EventSource = "cron" | "session" | "fallback";

export type ActivityEvent = {
  id: string;
  timestamp: string;
  source: EventSource;
  eventType: string;
  summary: string;
  raw: unknown;
};

export type CronJob = {
  id: string;
  name: string;
  schedule: string;
  nextRun: string | null;
  enabled: boolean;
  source: "openclaw-cli" | "state-jobs" | "state-runs" | "local-json";
};

export type SearchResult = {
  path: string;
  line: number;
  snippet: string;
};

export type LaunchKitCandidateStatus = "sourced" | "contacted" | "reviewing" | "approved" | "rejected" | "launching";

export type LaunchKitKitStatus = "draft" | "sent" | "builder-review" | "approved" | "needs-edits" | "rejected" | "launch-ready";

export type BuilderDecision = "approved" | "needs-edits" | "rejected" | null;

export type LaunchKitFeeSplit = {
  role: string;
  share: number;
  rationale: string;
};

export type LaunchKitChecklistItem = {
  label: string;
  done: boolean;
};

export type BagsReadiness = {
  token: "not-started" | "drafted" | "ready";
  fees: "not-started" | "drafted" | "ready";
  launchPath: "not-started" | "drafted" | "ready";
};

export type LaunchKitCandidate = {
  id: string;
  projectName: string;
  contactName: string;
  contactChannel: string;
  contactHandle: string;
  category: string;
  source: string;
  summary: string;
  status: LaunchKitCandidateStatus;
  createdAt: string;
  updatedAt: string;
};

export type LaunchKit = {
  id: string;
  candidateId: string;
  slug: string;
  tokenName: string;
  tokenSymbol: string;
  positioning: string;
  audience: string;
  launchNarrative: string;
  feeSplitPlan: LaunchKitFeeSplit[];
  launchChecklist: LaunchKitChecklistItem[];
  bagsReadiness: BagsReadiness;
  notes: string;
  status: LaunchKitKitStatus;
  builderDecision: BuilderDecision;
  builderFeedback: string;
  reviewUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type LaunchKitStore = {
  candidates: LaunchKitCandidate[];
  kits: LaunchKit[];
};

export type TreasuryChannel = "telegram-topic" | "telegram-dm" | "whatsapp-group" | "terminal";

export type TreasuryRoomStatus = "draft" | "active" | "paused";

export type TreasuryRequestStatus = "pending-approvals" | "approved" | "rejected" | "executed";

export type TreasuryApprovalDecision = "approved" | "rejected";

export type TreasuryAgentMode = "observe" | "propose" | "execute-after-quorum";

export type TreasuryExecutionMode = "manual-receipt" | "wdk-transfer";

export type TreasuryApprover = {
  id: string;
  name: string;
  role: string;
  handle: string;
};

export type TreasuryApproval = {
  approverId: string;
  approverName: string;
  decision: TreasuryApprovalDecision;
  note: string;
  createdAt: string;
};

export type TreasuryExecution = {
  txHash: string;
  explorerUrl: string;
  executedBy: string;
  executedAt: string;
  mode: TreasuryExecutionMode;
  feeWei: string | null;
  quoteFeeWei: string | null;
  wdkAccountAddress: string | null;
};

export type TreasurySpendRequest = {
  id: string;
  requestedBy: string;
  amount: string;
  assetSymbol: string;
  recipient: string;
  memo: string;
  status: TreasuryRequestStatus;
  approvals: TreasuryApproval[];
  execution: TreasuryExecution | null;
  createdAt: string;
  updatedAt: string;
};

export type TreasuryRoom = {
  id: string;
  slug: string;
  name: string;
  channel: TreasuryChannel;
  channelLabel: string;
  routeCommand: string;
  sessionKey: string;
  walletAddress: string;
  network: string;
  assetSymbol: string;
  assetAddress: string;
  balance: string;
  gasReserve: string;
  quorum: number;
  dailyLimit: string;
  wdkKeyAlias: string;
  agentMode: TreasuryAgentMode;
  status: TreasuryRoomStatus;
  approvers: TreasuryApprover[];
  notes: string;
  requests: TreasurySpendRequest[];
  createdAt: string;
  updatedAt: string;
};

export type TreasuryStore = {
  rooms: TreasuryRoom[];
};

export type TreasuryWdkRuntime = {
  operatorKeyConfigured: boolean;
  configuredAliases: string[];
};
