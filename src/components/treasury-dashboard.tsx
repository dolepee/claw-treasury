"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useState, useTransition } from "react";
import { buildTreasuryAnalytics } from "@/lib/treasury-analytics";
import {
  TreasuryAgentMode,
  TreasuryAllowedRecipient,
  TreasuryApprover,
  TreasuryChannel,
  TreasuryExecutionMode,
  TreasuryRoom,
  TreasurySpendRequest,
  TreasuryWdkRuntime,
} from "@/lib/types";

type Props = {
  rooms: TreasuryRoom[];
  wdk: TreasuryWdkRuntime;
};

type FormStatus = "idle" | "saved" | "error";

type CreateRoomForm = {
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
  quorum: string;
  dailyLimit: string;
  wdkKeyAlias: string;
  wdkAccountIndex: string;
  agentMode: TreasuryAgentMode;
  notes: string;
  approvers: string;
  allowlist: string;
};

type DrawerForm = {
  roomId: string;
  routeCommand: string;
  sessionKey: string;
  walletAddress: string;
  gasReserve: string;
  dailyLimit: string;
  wdkKeyAlias: string;
  wdkAccountIndex: string;
  agentMode: TreasuryAgentMode;
  notes: string;
  allowlist: string;
};

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

type WalletActionKind = "rotate" | "rotate-sweep" | "rollback" | "set-index" | "set-index-sweep";

type WalletActionResponse =
  | {
      ok: true;
      room: TreasuryRoom;
      action: {
        kind: WalletActionKind;
        summary: string;
        sweep?: {
          txHash: string | null;
          explorerUrl: string | null;
          gasSweepTxHash: string | null;
          gasSweepExplorerUrl: string | null;
          sweptAmount: string;
          gasSweptAmount: string;
          fromWalletAddress: string;
          toWalletAddress: string;
          fromGasReserve: string;
          toGasReserve: string;
        };
      };
    }
  | {
      ok: false;
      error?: string;
    };

type TerminalBlueprint = {
  scope: string;
  phase: string;
  tone: "info" | "warn" | "action";
  message: string;
  detail: string;
};

type TerminalEntry = TerminalBlueprint & {
  id: string;
  timestamp: string;
};

const defaultRoomForm: CreateRoomForm = {
  name: "",
  channel: "telegram-topic",
  channelLabel: "",
  routeCommand: "claw-topic",
  sessionKey: "",
  walletAddress: "",
  network: "Plasma",
  assetSymbol: "USD₮",
  assetAddress: "",
  balance: "0.00",
  gasReserve: "",
  quorum: "2",
  dailyLimit: "",
  wdkKeyAlias: "",
  wdkAccountIndex: "0",
  agentMode: "execute-after-quorum",
  notes: "",
  approvers: "",
  allowlist: "",
};

const channelOptions: Array<{ value: TreasuryChannel; label: string }> = [
  { value: "telegram-topic", label: "Telegram topic" },
  { value: "telegram-dm", label: "Telegram DM" },
  { value: "whatsapp-group", label: "WhatsApp group" },
  { value: "terminal", label: "Terminal" },
];

const agentModeOptions: Array<{ value: TreasuryAgentMode; label: string; detail: string }> = [
  { value: "observe", label: "Observe only", detail: "Claw monitors balances and produces reasoning, but never proposes or executes." },
  { value: "propose", label: "Propose only", detail: "Claw drafts spend intents while humans move the final transaction manually." },
  {
    value: "execute-after-quorum",
    label: "Execute after quorum",
    detail: "Claw can sign through WDK only after the configured quorum clears the request.",
  },
];

const revealMotion = {
  initial: { opacity: 0, y: 22 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.2 },
  transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
} as const;

function numeric(value: string | number | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatUsd(value: string | number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(numeric(value));
}

function formatToken(value: string | number, symbol: string): string {
  return `${numeric(value).toFixed(2)} ${symbol}`;
}

function formatGasReserve(value: string | number): string {
  const parsed = numeric(value);
  if (parsed === 0) {
    return "0 native";
  }
  return `${parsed.toFixed(parsed >= 1 ? 2 : 4)} native`;
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function formatClock(value: string | Date): string {
  return new Date(value).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatStamp(value: string | Date): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDurationMinutes(value: number | null): string {
  if (value === null) return "n/a";
  if (value < 1) return `${Math.round(value * 60)} sec`;
  if (value < 60) return `${value.toFixed(1)} min`;
  return `${(value / 60).toFixed(1)} hr`;
}

function formatCompactWei(value: string): string {
  try {
    const amount = BigInt(value);
    if (amount === BigInt(0)) {
      return "0 wei";
    }
    const absolute = amount < BigInt(0) ? -amount : amount;
    const units = [
      { threshold: BigInt("1000000000000"), suffix: "T wei" },
      { threshold: BigInt("1000000000"), suffix: "B wei" },
      { threshold: BigInt("1000000"), suffix: "M wei" },
      { threshold: BigInt("1000"), suffix: "K wei" },
    ];

    for (const unit of units) {
      if (absolute >= unit.threshold) {
        const scaled = Number(absolute) / Number(unit.threshold);
        return `${amount < BigInt(0) ? "-" : ""}${scaled.toFixed(scaled >= 100 ? 0 : 1)} ${unit.suffix}`;
      }
    }

    return `${amount.toString()} wei`;
  } catch {
    return `${value} wei`;
  }
}

function shortAddress(value: string): string {
  if (!value) return "not-set";
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function shortHash(value: string): string {
  if (!value) return "pending";
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function shortId(value: string): string {
  if (!value) return "unknown";
  return value.replace(/^req_/, "").slice(0, 10);
}

function channelLabel(channel: TreasuryChannel): string {
  if (channel === "telegram-topic") return "Telegram topic";
  if (channel === "telegram-dm") return "Telegram DM";
  if (channel === "whatsapp-group") return "WhatsApp group";
  return "Terminal";
}

function agentModeLabel(value: TreasuryAgentMode): string {
  if (value === "observe") return "Observe only";
  if (value === "propose") return "Propose only";
  return "Execute after quorum";
}

function agentModeSummary(value: TreasuryAgentMode): string {
  if (value === "observe") return "Claw can only read balances and produce recommendations.";
  if (value === "propose") return "Claw can draft WDK spend intents but humans still execute manually.";
  return "Claw can execute through WDK once quorum clears and policy checks pass.";
}

function executionModeLabel(mode: TreasuryExecutionMode | undefined): string {
  if (mode === "wdk-transfer") return "WDK transfer";
  return "Manual receipt";
}

function hasConfiguredAssetAddress(room: TreasuryRoom): boolean {
  const normalized = room.assetAddress.trim().toLowerCase();
  return Boolean(normalized) && normalized !== "runtime-configured";
}

function hasBoundWalletAddress(room: TreasuryRoom): boolean {
  const normalized = room.walletAddress.trim().toLowerCase();
  return Boolean(normalized) && normalized !== "pending-wallet";
}

function isRoomWdkReady(room: TreasuryRoom, wdk: TreasuryWdkRuntime): boolean {
  return (
    room.agentMode === "execute-after-quorum" &&
    wdk.operatorKeyConfigured &&
    wdk.configuredAliases.includes(room.wdkKeyAlias) &&
    hasConfiguredAssetAddress(room) &&
    hasBoundWalletAddress(room)
  );
}

function requestBadgeStyles(status: TreasurySpendRequest["status"]): string {
  if (status === "executed") return "border-emerald-300/25 bg-emerald-300/10 text-emerald-200";
  if (status === "approved") return "border-cyan-300/25 bg-cyan-300/10 text-cyan-200";
  if (status === "rejected") return "border-rose-300/25 bg-rose-300/10 text-rose-200";
  return "border-amber-300/25 bg-amber-300/10 text-amber-200";
}

function roomBadgeStyles(status: TreasuryRoom["status"]): string {
  if (status === "active") return "border-emerald-300/25 bg-emerald-300/10 text-emerald-200";
  if (status === "paused") return "border-amber-300/25 bg-amber-300/10 text-amber-200";
  return "border-white/10 bg-white/[0.05] text-zinc-300";
}

function terminalToneStyles(tone: TerminalEntry["tone"]): string {
  if (tone === "action") return "border-emerald-300/20 bg-emerald-300/[0.08]";
  if (tone === "warn") return "border-amber-300/20 bg-amber-300/[0.08]";
  return "border-white/10 bg-white/[0.04]";
}

function terminalDotStyles(tone: TerminalEntry["tone"]): string {
  if (tone === "action") return "bg-emerald-300 shadow-[0_0_16px_rgba(57,231,197,0.8)]";
  if (tone === "warn") return "bg-amber-300 shadow-[0_0_16px_rgba(247,185,85,0.8)]";
  return "bg-cyan-300 shadow-[0_0_16px_rgba(103,232,249,0.75)]";
}

function parseApprovers(raw: string): TreasuryApprover[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [name, role, handle] = line.split("|").map((part) => part?.trim() ?? "");
      return {
        id: `approver_${index + 1}_${name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "user"}`,
        name: name || `Approver ${index + 1}`,
        role: role || "approver",
        handle: handle || name || `approver-${index + 1}`,
      };
    });
}

function parseAllowedRecipients(raw: string): TreasuryAllowedRecipient[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [address, label] = line.split("|").map((part) => part?.trim() ?? "");
      return {
        address,
        label,
      };
    })
    .filter((entry) => /^0x[a-fA-F0-9]{40}$/.test(entry.address));
}

function formatAllowedRecipients(allowedRecipients: TreasuryAllowedRecipient[]): string {
  return allowedRecipients.map((entry) => `${entry.address}${entry.label ? ` | ${entry.label}` : ""}`).join("\n");
}

function defaultApprovalSelection(room: TreasuryRoom): string {
  return room.approvers[0]?.id ?? "";
}

function buildTerminalBlueprints(room: TreasuryRoom | null, rooms: TreasuryRoom[]): TerminalBlueprint[] {
  if (!room) {
    return [
      {
        scope: "BOOT",
        phase: "SYNC",
        tone: "info",
        message: "No treasury rooms registered yet. Awaiting first WDK wallet binding.",
        detail: "Claw is idle until a room is provisioned and policy is loaded.",
      },
    ];
  }

  const pendingCount = room.requests.filter((request) => request.status === "pending-approvals").length;
  const approvedRequest = room.requests.find((request) => request.status === "approved");
  const executedRequest = room.requests.find((request) => request.status === "executed");
  const settledVolume = rooms.reduce(
    (sum, currentRoom) =>
      sum +
      currentRoom.requests.reduce((innerSum, request) => {
        if (request.status === "executed") {
          return innerSum + numeric(request.amount);
        }
        return innerSum;
      }, 0),
    0,
  );

  return [
    {
      scope: "BOOT",
      phase: "SYNC",
      tone: "info",
      message: `Hydrating ${room.wdkKeyAlias} policy capsule for ${room.name}.`,
      detail: `Vault ${shortAddress(room.walletAddress)} is bound to ${room.network} and watching ${room.assetSymbol}.`,
    },
    {
      scope: "RISK",
      phase: "ANALYZE",
      tone: pendingCount > 0 ? "warn" : "info",
      message:
        pendingCount > 0
          ? `Evaluating ${pendingCount} pending payout${pendingCount > 1 ? "s" : ""} against the daily spend ceiling.`
          : "Analyzing market volatility... decision: hold.",
      detail: `Live reserve ${formatToken(room.balance, room.assetSymbol)} against daily limit ${formatToken(room.dailyLimit, room.assetSymbol)}.`,
    },
    {
      scope: "POLICY",
      phase: "CHECK",
      tone: "info",
      message: `${agentModeLabel(room.agentMode)} with ${room.quorum}-of-${room.approvers.length} quorum armed.`,
      detail: `Session ${room.sessionKey} remains attached to route command ${room.routeCommand}.`,
    },
    approvedRequest
      ? {
          scope: "WDK",
          phase: "EXEC",
          tone: "action",
          message: `Executing WDK transaction ${shortId(approvedRequest.id)} after quorum unlock.`,
          detail: `${approvedRequest.amount} ${approvedRequest.assetSymbol} -> ${shortAddress(approvedRequest.recipient)}.`,
        }
      : {
          scope: "WDK",
          phase: "HOLD",
          tone: "info",
          message: "No executable payload in the queue. Claw remains inside observation mode.",
          detail: `Gas reserve ${formatGasReserve(room.gasReserve)} is above the configured threshold.`,
        },
    executedRequest?.execution
      ? {
          scope: "PROOF",
          phase: "ANCHOR",
          tone: "action",
          message: `Proof board updated from receipt ${shortHash(executedRequest.execution.txHash)}.`,
          detail: `Settled volume now tracks ${formatUsd(settledVolume)} across ${rooms.length} treasury room${rooms.length === 1 ? "" : "s"}.`,
        }
      : {
          scope: "PROOF",
          phase: "MONITOR",
          tone: "info",
          message: "Proof-of-reserve board is watching live balances and queued intents in real time.",
          detail: `The next execution receipt will anchor directly into the reserve timeline.`,
        },
  ];
}

function createTerminalEntry(template: TerminalBlueprint): TerminalEntry {
  return {
    ...template,
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  };
}

function buildReserveGradient(
  segments: Array<{
    value: number;
    color: string;
  }>,
): string {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (total <= 0) {
    return "conic-gradient(rgba(255,255,255,0.12) 0deg 360deg)";
  }

  let currentDegrees = 0;
  const stops = segments
    .filter((segment) => segment.value > 0)
    .map((segment) => {
      const start = currentDegrees;
      const end = start + (segment.value / total) * 360;
      currentDegrees = end;
      return `${segment.color} ${start}deg ${end}deg`;
    });

  if (currentDegrees < 360) {
    stops.push(`rgba(255,255,255,0.08) ${currentDegrees}deg 360deg`);
  }

  return `conic-gradient(${stops.join(", ")})`;
}

function mapRoomToDrawer(room: TreasuryRoom): DrawerForm {
  return {
    roomId: room.id,
    routeCommand: room.routeCommand,
    sessionKey: room.sessionKey,
    walletAddress: room.walletAddress,
    gasReserve: room.gasReserve,
    dailyLimit: room.dailyLimit,
    wdkKeyAlias: room.wdkKeyAlias,
    wdkAccountIndex: String(room.wdkAccountIndex),
    agentMode: room.agentMode,
    notes: room.notes,
    allowlist: formatAllowedRecipients(room.allowedRecipients),
  };
}

function percentage(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min((value / max) * 100, 100));
}

function MetricBar({
  label,
  value,
  helper,
  pct,
  tone,
}: {
  label: string;
  value: string;
  helper: string;
  pct: number;
  tone: "signal" | "warning" | "info";
}) {
  const fillClass =
    tone === "signal"
      ? "from-emerald-300 via-teal-300 to-cyan-300"
      : tone === "warning"
        ? "from-amber-300 via-orange-300 to-rose-300"
        : "from-cyan-300 via-sky-300 to-indigo-300";

  return (
    <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="ct-label">{label}</p>
          <p className="mt-2 font-mono text-xl text-white">{value}</p>
        </div>
        <span className="text-xs text-zinc-500">{helper}</span>
      </div>
      <div className="mt-4 h-2 rounded-full bg-white/5">
        <motion.div
          className={`h-full rounded-full bg-gradient-to-r ${fillClass}`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}

export function TreasuryDashboard({ rooms, wdk }: Props) {
  const [createForm, setCreateForm] = useState<CreateRoomForm>(defaultRoomForm);
  const [createStatus, setCreateStatus] = useState<FormStatus>("idle");
  const [createError, setCreateError] = useState<string | null>(null);
  const [requestForms, setRequestForms] = useState<Record<string, { requestedBy: string; amount: string; recipient: string; memo: string }>>(
    () =>
      Object.fromEntries(
        rooms.map((room) => [
          room.id,
          { requestedBy: room.approvers[0]?.name ?? "Operator", amount: "", recipient: "", memo: "" },
        ]),
      ),
  );
  const [approvalForms, setApprovalForms] = useState<Record<string, { approverId: string; note: string }>>(
    () =>
      Object.fromEntries(
        rooms.flatMap((room) =>
          room.requests.map((request) => [
            request.id,
            {
              approverId: defaultApprovalSelection(room),
              note: "",
            },
          ]),
        ),
      ),
  );
  const [executionForms, setExecutionForms] = useState<Record<string, { txHash: string; explorerUrl: string; executedBy: string; operatorKey: string }>>(
    () =>
      Object.fromEntries(
        rooms.flatMap((room) =>
          room.requests.map((request) => [
            request.id,
            {
              txHash: "",
              explorerUrl: "",
              executedBy: "Claw + WDK",
              operatorKey: "",
            },
          ]),
        ),
      ),
  );
  const [selectedRoomId, setSelectedRoomId] = useState(rooms[0]?.id ?? "");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerForm, setDrawerForm] = useState<DrawerForm | null>(rooms[0] ? mapRoomToDrawer(rooms[0]) : null);
  const [toast, setToast] = useState<ToastState>(null);
  const [clock, setClock] = useState(() => new Date());
  const [terminalCursor, setTerminalCursor] = useState(0);
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([]);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) ?? rooms[0] ?? null;
  const selectedRoomWdkReady = selectedRoom ? isRoomWdkReady(selectedRoom, wdk) : false;
  const activeWalletActionCount =
    selectedRoom?.requests.filter((request) => request.status === "pending-approvals" || request.status === "approved").length ?? 0;
  const walletActionBlocked = activeWalletActionCount > 0;
  const selectedRoomAnalytics = selectedRoom ? buildTreasuryAnalytics(selectedRoom) : null;

  const totalBalance = rooms.reduce((sum, room) => sum + numeric(room.balance), 0);
  const totalPending = rooms.reduce(
    (sum, room) =>
      sum +
      room.requests.reduce((requestSum, request) => {
        if (request.status === "pending-approvals") {
          return requestSum + numeric(request.amount);
        }
        return requestSum;
      }, 0),
    0,
  );
  const totalApproved = rooms.reduce(
    (sum, room) =>
      sum +
      room.requests.reduce((requestSum, request) => {
        if (request.status === "approved") {
          return requestSum + numeric(request.amount);
        }
        return requestSum;
      }, 0),
    0,
  );
  const totalExecuted = rooms.reduce(
    (sum, room) =>
      sum +
      room.requests.reduce((requestSum, request) => {
        if (request.status === "executed") {
          return requestSum + numeric(request.amount);
        }
        return requestSum;
      }, 0),
    0,
  );
  const totalDailyLimit = rooms.reduce((sum, room) => sum + numeric(room.dailyLimit), 0);
  const approvedCount = rooms.reduce((sum, room) => sum + room.requests.filter((request) => request.status === "approved").length, 0);
  const pendingCount = rooms.reduce((sum, room) => sum + room.requests.filter((request) => request.status === "pending-approvals").length, 0);
  const executedCount = rooms.reduce((sum, room) => sum + room.requests.filter((request) => request.status === "executed").length, 0);
  const activeRooms = rooms.filter((room) => room.status === "active").length;
  const signalCoverage = rooms.length === 0 ? 0 : Math.round((activeRooms / rooms.length) * 100);

  const selectedBalance = numeric(selectedRoom?.balance);
  const selectedDailyLimit = numeric(selectedRoom?.dailyLimit);
  const selectedPendingValue = selectedRoom
    ? selectedRoom.requests.reduce((sum, request) => {
        if (request.status === "pending-approvals") {
          return sum + numeric(request.amount);
        }
        return sum;
      }, 0)
    : 0;
  const selectedApprovedValue = selectedRoom
    ? selectedRoom.requests.reduce((sum, request) => {
        if (request.status === "approved") {
          return sum + numeric(request.amount);
        }
        return sum;
      }, 0)
    : 0;
  const selectedGasReserve = numeric(selectedRoom?.gasReserve);
  const spendPressure = percentage(selectedPendingValue + selectedApprovedValue, Math.max(selectedDailyLimit, 1));
  const gasHealth = percentage(selectedGasReserve, 0.05);
  const readyApprovals = selectedRoom?.requests.filter((request) => request.status === "approved").length ?? 0;
  const reserveSegments = [
    {
      label: "Liquid reserve",
      value: totalBalance,
      helper: "USDT ready for new requests",
      color: "#39e7c5",
      barClass: "from-emerald-300 via-teal-300 to-cyan-300",
    },
    {
      label: "Queued for WDK execution",
      value: totalApproved,
      helper: "Quorum cleared, agent can sign",
      color: "#67e8f9",
      barClass: "from-cyan-300 via-sky-300 to-indigo-300",
    },
    {
      label: "Pending approvals",
      value: totalPending,
      helper: "Still inside human review",
      color: "#f7b955",
      barClass: "from-amber-300 via-orange-300 to-rose-300",
    },
    {
      label: "Settled today",
      value: totalExecuted,
      helper: "Already anchored on-chain",
      color: "#16a34a",
      barClass: "from-emerald-500 via-emerald-300 to-lime-300",
    },
  ];
  const reserveGradient = buildReserveGradient(reserveSegments);
  const reserveTotal = reserveSegments.reduce((sum, segment) => sum + segment.value, 0);

  const terminalBlueprints = useMemo(() => buildTerminalBlueprints(selectedRoom, rooms), [selectedRoom, rooms]);

  useEffect(() => {
    setRequestForms((current) => {
      let changed = false;
      const next = { ...current };
      for (const room of rooms) {
        if (!next[room.id]) {
          next[room.id] = {
            requestedBy: room.approvers[0]?.name ?? "Operator",
            amount: "",
            recipient: "",
            memo: "",
          };
          changed = true;
        }
      }
      return changed ? next : current;
    });

    setApprovalForms((current) => {
      let changed = false;
      const next = { ...current };
      for (const room of rooms) {
        for (const request of room.requests) {
          if (!next[request.id]) {
            next[request.id] = {
              approverId: defaultApprovalSelection(room),
              note: "",
            };
            changed = true;
          }
        }
      }
      return changed ? next : current;
    });

    setExecutionForms((current) => {
      let changed = false;
      const next = { ...current };
      for (const room of rooms) {
        for (const request of room.requests) {
          if (!next[request.id]) {
            next[request.id] = {
              txHash: "",
              explorerUrl: "",
              executedBy: "Claw + WDK",
              operatorKey: "",
            };
            changed = true;
          }
        }
      }
      return changed ? next : current;
    });
  }, [rooms]);

  useEffect(() => {
    if (!rooms.some((room) => room.id === selectedRoomId)) {
      setSelectedRoomId(rooms[0]?.id ?? "");
    }
  }, [rooms, selectedRoomId]);

  useEffect(() => {
    setDrawerForm(selectedRoom ? mapRoomToDrawer(selectedRoom) : null);
  }, [selectedRoom]);

  useEffect(() => {
    const initialEntries = terminalBlueprints.slice(0, Math.min(terminalBlueprints.length, 5)).map(createTerminalEntry);
    setTerminalEntries(initialEntries);
    setTerminalCursor(initialEntries.length);
  }, [terminalBlueprints]);

  const tickClock = useEffectEvent(() => {
    setClock(new Date());
  });

  const streamReasoning = useEffectEvent(() => {
    if (terminalBlueprints.length === 0) return;
    const blueprint = terminalBlueprints[terminalCursor % terminalBlueprints.length];
    setTerminalEntries((current) => [...current.slice(-7), createTerminalEntry(blueprint)]);
    setTerminalCursor((current) => current + 1);
  });

  useEffect(() => {
    const clockInterval = window.setInterval(() => tickClock(), 1000);
    return () => window.clearInterval(clockInterval);
  }, []);

  useEffect(() => {
    const feedInterval = window.setInterval(() => streamReasoning(), 2800);
    return () => window.clearInterval(feedInterval);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 4600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  function setRoomField(name: keyof CreateRoomForm, value: string) {
    setCreateForm((current) => ({ ...current, [name]: value }));
    setCreateStatus("idle");
    setCreateError(null);
  }

  function setRequestField(roomId: string, field: "requestedBy" | "amount" | "recipient" | "memo", value: string) {
    setRequestForms((current) => ({
      ...current,
      [roomId]: {
        requestedBy: current[roomId]?.requestedBy ?? "Operator",
        amount: current[roomId]?.amount ?? "",
        recipient: current[roomId]?.recipient ?? "",
        memo: current[roomId]?.memo ?? "",
        [field]: value,
      },
    }));
  }

  function setApprovalField(requestId: string, field: "approverId" | "note", value: string) {
    setApprovalForms((current) => ({
      ...current,
      [requestId]: {
        approverId: current[requestId]?.approverId ?? "",
        note: current[requestId]?.note ?? "",
        [field]: value,
      },
    }));
  }

  function setExecutionField(requestId: string, field: "txHash" | "explorerUrl" | "executedBy" | "operatorKey", value: string) {
    setExecutionForms((current) => ({
      ...current,
      [requestId]: {
        txHash: current[requestId]?.txHash ?? "",
        explorerUrl: current[requestId]?.explorerUrl ?? "",
        executedBy: current[requestId]?.executedBy ?? "Claw + WDK",
        operatorKey: current[requestId]?.operatorKey ?? "",
        [field]: value,
      },
    }));
  }

  function setDrawerField(name: keyof DrawerForm, value: string) {
    setDrawerForm((current) => (current ? { ...current, [name]: value } : current));
  }

  function refreshWithToast(message: string, tone: "success" | "error" = "success") {
    setToast({ message, tone });
    router.refresh();
  }

  function submitRoom() {
    setCreateStatus("idle");
    setCreateError(null);

    startTransition(() => {
      void (async () => {
        try {
          const approvers = parseApprovers(createForm.approvers);
          const allowedRecipients = parseAllowedRecipients(createForm.allowlist);
          const res = await fetch("/api/treasury/rooms", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              ...createForm,
              quorum: Number(createForm.quorum),
              wdkAccountIndex: Number(createForm.wdkAccountIndex),
              approvers,
              allowedRecipients,
            }),
          });

          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as { error?: string } | null;
            throw new Error(body?.error || "room_create_failed");
          }

          setCreateForm(defaultRoomForm);
          setCreateStatus("saved");
          refreshWithToast("Treasury room provisioned. WDK wallet policy is now live in the registry.");
        } catch (cause) {
          setCreateStatus("error");
          const message = cause instanceof Error ? cause.message : "Could not create room.";
          setCreateError(message);
          setToast({ tone: "error", message });
        }
      })();
    });
  }

  function submitRequest(roomId: string) {
    const form = requestForms[roomId];
    if (!form) return;

    startTransition(() => {
      void (async () => {
        try {
          const res = await fetch("/api/treasury/requests", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              roomId,
              requestedBy: form.requestedBy,
              amount: form.amount,
              recipient: form.recipient,
              memo: form.memo,
            }),
          });

          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as { error?: string } | null;
            throw new Error(body?.error || "request_create_failed");
          }

          setRequestForms((current) => ({
            ...current,
            [roomId]: {
              requestedBy: form.requestedBy,
              amount: "",
              recipient: "",
              memo: "",
            },
          }));
          refreshWithToast("Spend intent routed into the quorum rail.");
        } catch (cause) {
          setToast({
            tone: "error",
            message: cause instanceof Error ? cause.message : "Could not create request.",
          });
        }
      })();
    });
  }

  function submitApproval(roomId: string, requestId: string, decision: "approved" | "rejected") {
    const form = approvalForms[requestId];
    if (!form?.approverId) return;

    startTransition(() => {
      void (async () => {
        try {
          const res = await fetch("/api/treasury/approvals", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              roomId,
              requestId,
              approverId: form.approverId,
              decision,
              note: form.note,
            }),
          });

          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as { error?: string } | null;
            throw new Error(body?.error || "approval_failed");
          }

          setApprovalForms((current) => ({
            ...current,
            [requestId]: {
              approverId: form.approverId,
              note: "",
            },
          }));
          refreshWithToast(
            decision === "approved"
              ? "Approval recorded. Claw recalculated execution readiness."
              : "Request rejected. The WDK queue is now blocked for this spend.",
          );
        } catch (cause) {
          setToast({
            tone: "error",
            message: cause instanceof Error ? cause.message : "Could not record approval.",
          });
        }
      })();
    });
  }

  function submitManualExecution(roomId: string, requestId: string) {
    const form = executionForms[requestId];
    if (!form?.txHash.trim()) return;

    startTransition(() => {
      void (async () => {
        try {
          const res = await fetch("/api/treasury/execution", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              roomId,
              requestId,
              executedBy: form.executedBy,
              txHash: form.txHash,
              explorerUrl: form.explorerUrl,
            }),
          });

          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as { error?: string } | null;
            throw new Error(body?.error || "execution_failed");
          }

          setExecutionForms((current) => ({
            ...current,
            [requestId]: {
              txHash: "",
              explorerUrl: "",
              executedBy: form.executedBy,
              operatorKey: form.operatorKey,
            },
          }));
          refreshWithToast("Manual execution receipt stored. Proof-of-reserve board refreshed with the new on-chain state.");
        } catch (cause) {
          setToast({
            tone: "error",
            message: cause instanceof Error ? cause.message : "Could not store execution receipt.",
          });
        }
      })();
    });
  }

  function submitWdkExecution(roomId: string, requestId: string) {
    const form = executionForms[requestId];
    if (!form?.operatorKey.trim()) return;

    startTransition(() => {
      void (async () => {
        try {
          const res = await fetch("/api/treasury/execution/wdk", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              roomId,
              requestId,
              operatorKey: form.operatorKey,
            }),
          });

          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as { error?: string } | null;
            throw new Error(body?.error || "wdk_execution_failed");
          }

          setExecutionForms((current) => ({
            ...current,
            [requestId]: {
              txHash: "",
              explorerUrl: "",
              executedBy: "Claw + WDK",
              operatorKey: "",
            },
          }));
          refreshWithToast("WDK transfer submitted. Claw anchored the request and refreshed the reserve board.");
        } catch (cause) {
          setToast({
            tone: "error",
            message: cause instanceof Error ? cause.message : "Could not execute transfer with WDK.",
          });
        }
      })();
    });
  }

  function saveDrawerPolicy() {
    if (!drawerForm) return;

    startTransition(() => {
      void (async () => {
        try {
          const allowedRecipients = parseAllowedRecipients(drawerForm.allowlist);
          const res = await fetch("/api/treasury/rooms", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              ...drawerForm,
              wdkAccountIndex: Number(drawerForm.wdkAccountIndex),
              allowedRecipients,
            }),
          });

          const body = (await res.json().catch(() => null)) as { room?: TreasuryRoom; error?: string } | null;
          if (!res.ok) {
            throw new Error(body?.error || "policy_update_failed");
          }

          if (body?.room) {
            setDrawerForm(mapRoomToDrawer(body.room));
          }
          setDrawerOpen(false);
          refreshWithToast("Wallet management module updated. Claw will use the refreshed WDK policy on the next cycle.");
        } catch (cause) {
          setToast({
            tone: "error",
            message: cause instanceof Error ? cause.message : "Could not update wallet policy.",
          });
        }
      })();
    });
  }

  function summarizeWalletAction(body: Extract<WalletActionResponse, { ok: true }>): string {
    const parts = [body.action.summary];
    if (body.action.sweep) {
      if (numeric(body.action.sweep.sweptAmount) > 0) {
        parts.push(`Moved ${body.action.sweep.sweptAmount} ${body.room.assetSymbol} into the new vault.`);
      }
      if (numeric(body.action.sweep.gasSweptAmount) > 0) {
        parts.push(`Carried forward ${body.action.sweep.gasSweptAmount} native gas.`);
      }
      parts.push(`Residual gas on the old wallet: ${body.action.sweep.fromGasReserve}.`);
    }
    return parts.join(" ");
  }

  function submitWalletAction(action: WalletActionKind) {
    if (!selectedRoom) return;

    const targetAccountIndex =
      action === "set-index" || action === "set-index-sweep" ? Number(drawerForm?.wdkAccountIndex ?? selectedRoom.wdkAccountIndex) : undefined;

    startTransition(() => {
      void (async () => {
        try {
          const res = await fetch("/api/treasury/wallet-actions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              roomId: selectedRoom.id,
              action,
              targetAccountIndex,
            }),
          });

          const body = (await res.json().catch(() => null)) as WalletActionResponse | null;
          if (!res.ok || !body) {
            throw new Error((body && "error" in body && body.error) || "wallet_action_failed");
          }
          if (!body.ok) {
            throw new Error(body.error || "wallet_action_failed");
          }

          setDrawerForm(mapRoomToDrawer(body.room));
          refreshWithToast(summarizeWalletAction(body));
        } catch (cause) {
          setToast({
            tone: "error",
            message: cause instanceof Error ? cause.message : "Could not run the wallet action.",
          });
        }
      })();
    });
  }

  function exportAudit(format: "json" | "csv" | "md") {
    if (!selectedRoom) return;
    const url = `/api/treasury/export?roomId=${encodeURIComponent(selectedRoom.id)}&format=${format}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const selectedRequestForm = selectedRoom
    ? requestForms[selectedRoom.id] ?? { requestedBy: selectedRoom.approvers[0]?.name ?? "Operator", amount: "", recipient: "", memo: "" }
    : null;

  const liveFlowSteps = selectedRoom
    ? [
        {
          label: "Room bound",
          detail: hasBoundWalletAddress(selectedRoom)
            ? `${shortAddress(selectedRoom.walletAddress)} bound to ${selectedRoom.channelLabel}`
            : "Set a real wallet address for this treasury room.",
          done: hasBoundWalletAddress(selectedRoom),
        },
        {
          label: "Asset configured",
          detail: hasConfiguredAssetAddress(selectedRoom)
            ? `${selectedRoom.assetSymbol} asset contract loaded for ${selectedRoom.network}`
            : "Set the Plasma USD₮ asset contract on the room or in the WDK alias config.",
          done: hasConfiguredAssetAddress(selectedRoom),
        },
        {
          label: "Quorum ready",
          detail:
            selectedRoom.requests.some((request) => request.status === "approved")
              ? "At least one spend request is approved and ready for WDK execution."
              : "Create a request and clear quorum approval first.",
          done: selectedRoom.requests.some((request) => request.status === "approved"),
        },
        {
          label: "WDK live",
          detail: selectedRoomWdkReady
            ? `Alias ${selectedRoom.wdkKeyAlias} is configured and the operator key is present.`
            : wdk.operatorKeyConfigured
              ? `Add a matching WDK wallet config for alias ${selectedRoom.wdkKeyAlias}.`
              : "Set CLAW_TREASURY_OPERATOR_KEY and CLAW_TREASURY_WDK_WALLETS_JSON in Vercel.",
          done: selectedRoomWdkReady,
        },
      ]
    : [];

  const topMetrics = [
    {
      label: "TVL under policy",
      value: formatUsd(totalBalance),
      detail: `${rooms.length} wallet module${rooms.length === 1 ? "" : "s"} tracked by Claw`,
    },
    {
      label: "WDK queue ready",
      value: formatUsd(totalApproved),
      detail: `${approvedCount} ready • ${pendingCount} awaiting • ${executedCount} settled`,
    },
    {
      label: "Protected by quorum",
      value: `${signalCoverage}%`,
      detail: `${activeRooms}/${rooms.length || 1} rooms currently active`,
    },
    {
      label: "Delegated daily cap",
      value: formatUsd(totalDailyLimit),
      detail: "Non-custodial allowance controlled in the wallet module",
    },
  ];

  return (
    <div className="space-y-6 pb-10">
      <motion.section {...revealMotion} id="overview" className="ct-panel px-6 py-7 sm:px-7 sm:py-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(57,231,197,0.16),transparent_30%),radial-gradient(circle_at_86%_18%,rgba(34,211,238,0.12),transparent_22%),linear-gradient(135deg,rgba(255,255,255,0.03),transparent_55%)]" />

        <div className="relative grid gap-8 2xl:grid-cols-[minmax(0,1.15fr)_420px]">
          <div className="space-y-5">
            <div className="ct-label">Autonomous Treasury Workstation</div>
            <div className="space-y-4">
              <h2 className="max-w-4xl text-4xl font-semibold leading-tight tracking-[-0.05em] text-white sm:text-5xl">
                Claw reasons in the open. Tether WDK enforces the wallet boundary.
              </h2>
              <p className="max-w-3xl text-base leading-7 text-zinc-400">
                This dashboard turns ClawTreasury into a premium command surface for AI-managed finance: monitor non-custodial balances, inspect
                the agent’s reasoning stream, and reconfigure wallet permissions without ever handing Claw direct custody.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <span className="ct-chip">Terminal-chic dashboard</span>
              <span className="ct-chip">Live proof board</span>
              <span className="ct-chip">Human quorum before WDK execution</span>
              <span className="ct-chip">Mission Control for USDT ops</span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-1">
            <div className="rounded-[24px] border border-white/10 bg-black/35 p-5">
              <div className="ct-label">Operator posture</div>
              <p className="mt-3 text-sm leading-7 text-zinc-300">
                Claw manages the treasury like an autonomous ops agent, but the WDK wallet remains modular, non-custodial, and policy-bound.
              </p>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-black/35 p-5">
              <div className="ct-label">Live clock</div>
              <p className="mt-3 font-mono text-2xl text-white">{formatClock(clock)}</p>
              <p className="mt-2 text-sm text-zinc-500">Reasoning feed and reserve board stream from the same treasury state.</p>
            </div>
          </div>
        </div>
      </motion.section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {topMetrics.map((metric, index) => (
          <motion.article
            key={metric.label}
            className="ct-panel px-5 py-5"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.06 * index, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="ct-label">{metric.label}</div>
            <p className="mt-3 font-mono text-[1.85rem] text-white">{metric.value}</p>
            <p className="mt-3 text-sm leading-6 text-zinc-500">{metric.detail}</p>
          </motion.article>
        ))}
      </div>

      <motion.section {...revealMotion} className="ct-panel px-6 py-6 sm:px-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="ct-label">Real Test Flow</div>
            <h3 className="text-2xl font-semibold tracking-[-0.03em] text-white">One visible path from room setup to a real Plasma execution.</h3>
            <p className="max-w-3xl text-sm leading-7 text-zinc-400">
              The product is now operator-first: bind a real wallet, configure the USD₮ contract, clear quorum, then execute through WDK with the
              operator key. No seeded shortcuts are required.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="ct-chip">{wdk.operatorKeyConfigured ? "Operator key loaded" : "Operator key missing"}</span>
            <span className="ct-chip">{wdk.configuredAliases.length} WDK alias{wdk.configuredAliases.length === 1 ? "" : "es"} configured</span>
          </div>
        </div>

        {selectedRoom ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {liveFlowSteps.map((step, index) => (
              <div key={step.label} className="rounded-[22px] border border-white/10 bg-black/25 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="ct-label">{`0${index + 1}`}</div>
                  <span
                    className={`rounded-full border px-3 py-1 text-[0.68rem] uppercase tracking-[0.24em] ${
                      step.done
                        ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-200"
                        : "border-white/10 bg-white/[0.05] text-zinc-400"
                    }`}
                  >
                    {step.done ? "ready" : "pending"}
                  </span>
                </div>
                <h4 className="mt-3 text-lg font-medium text-white">{step.label}</h4>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{step.detail}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-[24px] border border-dashed border-white/10 bg-black/20 px-6 py-8 text-center text-zinc-400">
            Provision the first room to unlock the live operator checklist.
          </div>
        )}
      </motion.section>

      <motion.section {...revealMotion} id="command-center" className="ct-panel px-6 py-6 sm:px-7">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(57,231,197,0.07),transparent_36%,rgba(34,211,238,0.08)_100%)]" />

        <div className="relative space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="ct-label">WDK Wallet Command Center</div>
              <h3 className="text-2xl font-semibold tracking-[-0.03em] text-white">Secure wallet modules, live balances, and agent authority in one rail.</h3>
              <p className="max-w-3xl text-sm leading-7 text-zinc-400">
                The command center treats the WDK wallet like a composable hardware module: inspect the non-custodial vault, gas reserve, and
                execution posture before Claw touches a single transaction.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button type="button" className="ct-button-ghost" disabled={!selectedRoom} onClick={() => exportAudit("md")}>
                Export Brief
              </button>
              <button type="button" className="ct-button-ghost" disabled={!selectedRoom} onClick={() => exportAudit("json")}>
                Export JSON
              </button>
              <button type="button" className="ct-button-ghost" disabled={!selectedRoom} onClick={() => exportAudit("csv")}>
                Export CSV
              </button>
              <button type="button" className="ct-button-secondary" disabled={!selectedRoom} onClick={() => setDrawerOpen(true)}>
                Wallet Management
              </button>
              <a href="#rooms" className="ct-button-ghost">
                Open request rail
              </a>
            </div>
          </div>

          {selectedRoom ? (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_380px]">
              <div className="rounded-[26px] border border-white/10 bg-black/35 p-5">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <h4 className="text-2xl font-semibold text-white">{selectedRoom.name}</h4>
                      <span className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.24em] ${roomBadgeStyles(selectedRoom.status)}`}>
                        {selectedRoom.status}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="ct-chip">{channelLabel(selectedRoom.channel)}</span>
                      <span className="ct-chip">{selectedRoom.network}</span>
                      <span className="ct-chip">{selectedRoom.assetSymbol}</span>
                      <span className="ct-chip">{selectedRoom.wdkKeyAlias}</span>
                      <span className="ct-chip">acct #{selectedRoom.wdkAccountIndex}</span>
                    </div>
                    <p className="max-w-2xl text-sm leading-7 text-zinc-400">
                      Bound to <span className="font-mono text-zinc-200">{selectedRoom.sessionKey}</span> with route command{" "}
                      <span className="font-mono text-zinc-200">{selectedRoom.routeCommand}</span>. Claw can reason continuously, but WDK execution
                      stays gated by quorum.
                    </p>
                  </div>

                  <div className="rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-3 text-right">
                    <div className="ct-label justify-end">Vault address</div>
                    <div className="mt-2 font-mono text-sm text-white">{shortAddress(selectedRoom.walletAddress)}</div>
                    <div className="mt-2 text-xs text-zinc-500">{selectedRoom.channelLabel}</div>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <MetricBar
                    label="USDT balance"
                    value={formatToken(selectedRoom.balance, selectedRoom.assetSymbol)}
                    helper="live reserve"
                    pct={percentage(selectedBalance, Math.max(totalBalance, selectedBalance, 1))}
                    tone="signal"
                  />
                  <MetricBar
                    label="Gas reserve"
                    value={formatGasReserve(selectedRoom.gasReserve)}
                    helper={gasHealth >= 60 ? "healthy" : "watch"}
                    pct={gasHealth}
                    tone={gasHealth >= 60 ? "info" : "warning"}
                  />
                  <MetricBar
                    label="Daily WDK cap"
                    value={formatToken(selectedRoom.dailyLimit, selectedRoom.assetSymbol)}
                    helper={`${Math.round(spendPressure)}% pressured`}
                    pct={spendPressure}
                    tone={spendPressure < 60 ? "signal" : "warning"}
                  />
                  <MetricBar
                    label="Quorum status"
                    value={`${selectedRoom.quorum}/${selectedRoom.approvers.length}`}
                    helper={`${readyApprovals} ready`}
                    pct={percentage(readyApprovals, Math.max(selectedRoom.requests.length, 1))}
                    tone="info"
                  />
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
                    <div className="ct-label">Session binding</div>
                    <div className="mt-3 space-y-3">
                      <div className="flex items-center justify-between gap-3 text-sm text-zinc-300">
                        <span>Key alias</span>
                        <span className="font-mono text-zinc-100">{selectedRoom.wdkKeyAlias}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-sm text-zinc-300">
                        <span>Derived account</span>
                        <span className="font-mono text-zinc-100">#{selectedRoom.wdkAccountIndex}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-sm text-zinc-300">
                        <span>Route command</span>
                        <span className="font-mono text-zinc-100">{selectedRoom.routeCommand}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-sm text-zinc-300">
                        <span>Authority mode</span>
                        <span className="font-mono text-zinc-100">{agentModeLabel(selectedRoom.agentMode)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
                    <div className="ct-label">Execution posture</div>
                    <p className="mt-3 text-sm leading-7 text-zinc-300">{agentModeSummary(selectedRoom.agentMode)}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {selectedRoom.approvers.map((approver) => (
                        <span key={approver.id} className="ct-chip !text-[0.64rem]">
                          {approver.name}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[26px] border border-white/10 bg-black/40 p-5">
                <div className="ct-label">Security mesh</div>
                <div className="mt-5 space-y-5">
                  <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Modular key rack</p>
                    <div className="mt-4 space-y-3">
                      {[
                        { label: "WDK signer", value: `${selectedRoom.wdkKeyAlias} #${selectedRoom.wdkAccountIndex}`, status: "armed" },
                        { label: "Session route", value: shortAddress(selectedRoom.walletAddress), status: "bound" },
                        { label: "Recovery posture", value: `${selectedRoom.quorum}-of-${selectedRoom.approvers.length}`, status: "quorum" },
                      ].map((module) => (
                        <div key={module.label} className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                          <div>
                            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">{module.label}</p>
                            <p className="mt-1 font-mono text-sm text-white">{module.value}</p>
                          </div>
                          <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1 text-[0.68rem] uppercase tracking-[0.24em] text-emerald-200">
                            {module.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Module pressure</p>
                    <div className="mt-4 space-y-4">
                      <div>
                        <div className="mb-2 flex items-center justify-between text-sm text-zinc-300">
                          <span>Spend pressure</span>
                          <span className="font-mono text-zinc-100">{Math.round(spendPressure)}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-white/5">
                          <motion.div
                            className="h-full rounded-full bg-gradient-to-r from-emerald-300 via-teal-300 to-cyan-300"
                            initial={{ width: 0 }}
                            animate={{ width: `${spendPressure}%` }}
                            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="mb-2 flex items-center justify-between text-sm text-zinc-300">
                          <span>Gas coverage</span>
                          <span className="font-mono text-zinc-100">{Math.round(gasHealth)}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-white/5">
                          <motion.div
                            className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-sky-300 to-indigo-300"
                            initial={{ width: 0 }}
                            animate={{ width: `${gasHealth}%` }}
                            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-[26px] border border-dashed border-white/10 bg-black/20 px-6 py-8 text-center text-zinc-400">
              Provision the first treasury room to activate the WDK command center.
            </div>
          )}
        </div>
      </motion.section>

      <motion.section {...revealMotion} id="analytics" className="ct-panel px-6 py-6 sm:px-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="ct-label">Treasury Analytics</div>
            <h3 className="text-2xl font-semibold tracking-[-0.03em] text-white">Approval velocity, execution drag, and signer churn in one operator layer.</h3>
            <p className="max-w-3xl text-sm leading-7 text-zinc-400">
              These metrics are computed from the live room state, so the same data feeding Claw’s reasoning stream also drives the operator audit brief.
            </p>
          </div>
          {selectedRoomAnalytics ? (
            <div className="flex flex-wrap gap-2">
              <span className="ct-chip">{selectedRoomAnalytics.requestCount} requests tracked</span>
              <span className="ct-chip">{selectedRoomAnalytics.activeApproverCount} active approver{selectedRoomAnalytics.activeApproverCount === 1 ? "" : "s"}</span>
              <span className="ct-chip">{selectedRoomAnalytics.walletRotationCount} wallet rotation{selectedRoomAnalytics.walletRotationCount === 1 ? "" : "s"}</span>
            </div>
          ) : null}
        </div>

        {selectedRoom && selectedRoomAnalytics ? (
          <div className="mt-6 space-y-5">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  label: "Quorum throughput",
                  value: formatPercent(selectedRoomAnalytics.quorumClearRate),
                  detail: `${selectedRoomAnalytics.approved + selectedRoomAnalytics.executed}/${Math.max(selectedRoomAnalytics.requestCount, 1)} requests reached quorum`,
                },
                {
                  label: "Execution velocity",
                  value: formatDurationMinutes(selectedRoomAnalytics.avgExecutionLagMinutes),
                  detail: selectedRoomAnalytics.executed > 0 ? `${selectedRoomAnalytics.executed} request${selectedRoomAnalytics.executed === 1 ? "" : "s"} settled on-chain` : "Waiting for the first on-chain receipt",
                },
                {
                  label: "Approval lag",
                  value: formatDurationMinutes(selectedRoomAnalytics.avgApprovalLagMinutes),
                  detail: selectedRoomAnalytics.pendingApprovals > 0 ? `${selectedRoomAnalytics.pendingApprovals} request${selectedRoomAnalytics.pendingApprovals === 1 ? "" : "s"} still in review` : "No quorum backlog right now",
                },
                {
                  label: "Fee tracked",
                  value: formatCompactWei(selectedRoomAnalytics.totalFeeWei),
                  detail: `Quoted ${formatCompactWei(selectedRoomAnalytics.totalQuotedFeeWei)} across executed WDK receipts`,
                },
              ].map((metric, index) => (
                <motion.article
                  key={metric.label}
                  className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4"
                  initial={{ opacity: 0, y: 18 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ duration: 0.45, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="ct-label">{metric.label}</div>
                  <p className="mt-3 font-mono text-2xl text-white">{metric.value}</p>
                  <p className="mt-3 text-sm leading-6 text-zinc-500">{metric.detail}</p>
                </motion.article>
              ))}
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <div className="rounded-[24px] border border-white/10 bg-black/30 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="ct-label">Policy performance</div>
                    <p className="mt-2 text-sm leading-7 text-zinc-400">
                      Coverage tracks how much of the live recipient set is already protected by the room’s allowlist. Wallet churn reflects operational signer changes.
                    </p>
                  </div>
                  <span className="ct-chip">{selectedRoom.name}</span>
                </div>

                <div className="mt-5 space-y-4">
                  <div>
                    <div className="mb-2 flex items-center justify-between text-sm text-zinc-300">
                      <span>Execution rate</span>
                      <span className="font-mono text-zinc-100">{formatPercent(selectedRoomAnalytics.executionRate)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/5">
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-300 via-teal-300 to-cyan-300"
                        initial={{ width: 0 }}
                        whileInView={{ width: `${selectedRoomAnalytics.executionRate}%` }}
                        viewport={{ once: true, amount: 0.5 }}
                        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between text-sm text-zinc-300">
                      <span>Recipient coverage</span>
                      <span className="font-mono text-zinc-100">{formatPercent(selectedRoomAnalytics.recipientCoverageRate)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/5">
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-sky-300 to-indigo-300"
                        initial={{ width: 0 }}
                        whileInView={{ width: `${selectedRoomAnalytics.recipientCoverageRate}%` }}
                        viewport={{ once: true, amount: 0.5 }}
                        transition={{ duration: 0.8, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Requested volume</p>
                      <p className="mt-2 font-mono text-lg text-white">{formatToken(selectedRoomAnalytics.totalRequestedVolume, selectedRoom.assetSymbol)}</p>
                      <p className="mt-2 text-xs text-zinc-500">Average size {formatToken(selectedRoomAnalytics.avgRequestAmount, selectedRoom.assetSymbol)}</p>
                    </div>
                    <div className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Wallet churn</p>
                      <p className="mt-2 font-mono text-lg text-white">{selectedRoomAnalytics.walletRotationCount}</p>
                      <p className="mt-2 text-xs text-zinc-500">{selectedRoomAnalytics.uniqueRecipientCount} unique recipient{selectedRoomAnalytics.uniqueRecipientCount === 1 ? "" : "s"} touched</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-5">
                <div className="rounded-[24px] border border-white/10 bg-black/30 p-5">
                  <div className="ct-label">Approver participation</div>
                  {selectedRoomAnalytics.topApprovers.length === 0 ? (
                    <p className="mt-4 text-sm leading-7 text-zinc-500">No approval activity yet. The first treasury request will start the participation board.</p>
                  ) : (
                    <ul className="mt-4 space-y-3">
                      {selectedRoomAnalytics.topApprovers.slice(0, 4).map((entry) => (
                        <li key={entry.approverId} className="rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="font-medium text-white">{entry.approverName}</p>
                              <p className="mt-1 text-xs text-zinc-500">{entry.handle}</p>
                            </div>
                            <span className="font-mono text-sm text-zinc-100">{entry.totalCount}</span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-3 text-xs text-zinc-400">
                            <span>{entry.approvedCount} approved</span>
                            <span>{entry.rejectedCount} rejected</span>
                            <span>{entry.lastActionAt ? `Last action ${formatStamp(entry.lastActionAt)}` : "No actions yet"}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="rounded-[24px] border border-white/10 bg-black/30 p-5">
                  <div className="ct-label">Latest operator pulse</div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Last execution</p>
                      <p className="mt-2 font-mono text-sm text-white">{selectedRoomAnalytics.lastExecutedAt ? formatStamp(selectedRoomAnalytics.lastExecutedAt) : "n/a"}</p>
                    </div>
                    <div className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Latest request</p>
                      <p className="mt-2 font-mono text-sm text-white">{selectedRoomAnalytics.latestRequestAt ? formatStamp(selectedRoomAnalytics.latestRequestAt) : "n/a"}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-6 rounded-[24px] border border-dashed border-white/10 bg-black/20 px-6 py-8 text-center text-zinc-400">
            Provision the first treasury room to activate live approval and execution analytics.
          </div>
        )}
      </motion.section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_420px]">
        <div className="space-y-6">
          <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
            <motion.section {...revealMotion} id="reserves" className="ct-panel px-6 py-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div className="space-y-2">
                  <div className="ct-label">Proof-of-Reserve Visualization</div>
                  <h3 className="text-2xl font-semibold tracking-[-0.03em] text-white">Graphical reserve board synced to Claw’s live treasury state.</h3>
                </div>
                <span className="ct-chip">Updated {formatClock(clock)}</span>
              </div>

              <div className="mt-6 grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
                <div className="flex items-center justify-center">
                  <motion.div
                    className="relative grid h-[280px] w-[280px] place-items-center rounded-full border border-white/10 p-[1px]"
                    initial={{ scale: 0.92, opacity: 0 }}
                    whileInView={{ scale: 1, opacity: 1 }}
                    viewport={{ once: true, amount: 0.3 }}
                    transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    style={{ background: reserveGradient }}
                  >
                    <div className="absolute inset-2 rounded-full bg-[#050708] shadow-[inset_0_0_40px_rgba(57,231,197,0.08)]" />
                    <div className="relative z-10 space-y-2 text-center">
                      <div className="ct-label justify-center">Tracked assets</div>
                      <div className="font-mono text-[2.6rem] text-white">{formatUsd(reserveTotal)}</div>
                      <p className="mx-auto max-w-[180px] text-sm leading-6 text-zinc-500">Liquid reserve, queued intents, and settled receipts shown in one proof board.</p>
                    </div>
                  </motion.div>
                </div>

                <div className="space-y-4">
                  {reserveSegments.map((segment, index) => (
                    <motion.div
                      key={segment.label}
                      className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4"
                      initial={{ opacity: 0, x: 16 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true, amount: 0.2 }}
                      transition={{ duration: 0.45, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="ct-label">{segment.label}</div>
                          <p className="mt-2 font-mono text-lg text-white">{formatUsd(segment.value)}</p>
                        </div>
                        <span className="text-right text-xs leading-5 text-zinc-500">{segment.helper}</span>
                      </div>
                      <div className="mt-4 h-2 rounded-full bg-white/5">
                        <motion.div
                          className={`h-full rounded-full bg-gradient-to-r ${segment.barClass}`}
                          initial={{ width: 0 }}
                          animate={{ width: `${reserveTotal > 0 ? (segment.value / reserveTotal) * 100 : 0}%` }}
                          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.04 * index }}
                        />
                      </div>
                    </motion.div>
                  ))}

                  <div className="grid gap-3 md:grid-cols-2">
                    {rooms.map((room) => (
                      <div key={room.id} className="rounded-[22px] border border-white/10 bg-black/30 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-white">{room.name}</p>
                            <p className="mt-1 text-xs text-zinc-500">{room.channelLabel}</p>
                          </div>
                          <span className="ct-chip !text-[0.62rem]">{room.wdkKeyAlias}</span>
                          <span className="ct-chip !text-[0.62rem]">#{room.wdkAccountIndex}</span>
                        </div>
                        <div className="mt-3 flex items-center justify-between">
                          <span className="text-xs uppercase tracking-[0.24em] text-zinc-500">Live reserve</span>
                          <span className="font-mono text-sm text-zinc-100">{formatToken(room.balance, room.assetSymbol)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.section>

            <motion.section {...revealMotion} className="ct-panel px-6 py-6">
              <div className="space-y-2">
                <div className="ct-label">WDK Dispatch Composer</div>
                <h3 className="text-2xl font-semibold tracking-[-0.03em] text-white">Turn an intent into a policy-bound spend request.</h3>
                <p className="text-sm leading-7 text-zinc-400">
                  Create a spend request for the selected room. Claw pushes it into the quorum rail, then the agent feed and reserve board update as
                  approvals or receipts arrive.
                </p>
              </div>

              {selectedRoom && selectedRequestForm ? (
                <div className="mt-6 space-y-5">
                  <div className="rounded-[24px] border border-white/10 bg-black/30 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="ct-label">Target wallet module</p>
                        <p className="mt-2 text-lg font-medium text-white">{selectedRoom.name}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="ct-chip">{selectedRoom.network}</span>
                        <span className="ct-chip">{selectedRoom.assetSymbol}</span>
                        <span className="ct-chip">{agentModeLabel(selectedRoom.agentMode)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2 text-sm text-zinc-300">
                      Requested by
                      <input
                        className="ct-input"
                        value={selectedRequestForm.requestedBy}
                        onChange={(event) => setRequestField(selectedRoom.id, "requestedBy", event.target.value)}
                        placeholder="Treasury Lead"
                      />
                    </label>
                    <label className="space-y-2 text-sm text-zinc-300">
                      Amount
                      <input
                        className="ct-input font-mono"
                        value={selectedRequestForm.amount}
                        onChange={(event) => setRequestField(selectedRoom.id, "amount", event.target.value)}
                        placeholder="24.00"
                      />
                    </label>
                    <label className="space-y-2 text-sm text-zinc-300 sm:col-span-2">
                      Recipient
                      <input
                        className="ct-input font-mono"
                        value={selectedRequestForm.recipient}
                        onChange={(event) => setRequestField(selectedRoom.id, "recipient", event.target.value)}
                        placeholder="0x..."
                      />
                    </label>
                    <label className="space-y-2 text-sm text-zinc-300 sm:col-span-2">
                      Memo
                      <textarea
                        className="ct-textarea"
                        rows={4}
                        value={selectedRequestForm.memo}
                        onChange={(event) => setRequestField(selectedRoom.id, "memo", event.target.value)}
                        placeholder="Treasury intent, rationale, and checkpoint notes"
                      />
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" className="ct-button-primary" disabled={isPending} onClick={() => submitRequest(selectedRoom.id)}>
                      {isPending ? "Dispatching..." : "Route into quorum"}
                    </button>
                    <button type="button" className="ct-button-ghost" disabled={isPending} onClick={() => setDrawerOpen(true)}>
                      Review wallet permissions
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-6 rounded-[24px] border border-dashed border-white/10 bg-black/20 px-6 py-8 text-center text-zinc-400">
                  Provision the first room to start routing spend intents.
                </div>
              )}
            </motion.section>
          </div>

          <motion.section {...revealMotion} id="rooms" className="ct-panel px-6 py-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div className="space-y-2">
                <div className="ct-label">Decision Rail & Receipts</div>
                <h3 className="text-2xl font-semibold tracking-[-0.03em] text-white">Every spend request moves through one visible approval and execution lane.</h3>
              </div>
              {selectedRoom ? <span className="ct-chip">{selectedRoom.name}</span> : null}
            </div>

            {selectedRoom ? (
              selectedRoom.requests.length > 0 ? (
                <div className="mt-6 grid gap-4 xl:grid-cols-2">
                  {selectedRoom.requests.map((request) => {
                    const approvalForm = approvalForms[request.id] ?? {
                      approverId: defaultApprovalSelection(selectedRoom),
                      note: "",
                    };
                    const executionForm = executionForms[request.id] ?? {
                      txHash: "",
                      explorerUrl: "",
                      executedBy: "Claw + WDK",
                      operatorKey: "",
                    };

                    return (
                      <motion.article
                        key={request.id}
                        layout
                        className="rounded-[26px] border border-white/10 bg-black/30 p-5"
                        initial={{ opacity: 0, y: 16 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, amount: 0.2 }}
                        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div>
                            <p className="font-mono text-2xl text-white">
                              {request.amount} {request.assetSymbol}
                            </p>
                            <p className="mt-2 text-sm leading-7 text-zinc-400">{request.memo}</p>
                          </div>
                          <span className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.24em] ${requestBadgeStyles(request.status)}`}>
                            {request.status.replaceAll("-", " ")}
                          </span>
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-3">
                          <div className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4">
                            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Requester</p>
                            <p className="mt-2 font-medium text-white">{request.requestedBy}</p>
                          </div>
                          <div className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4">
                            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Recipient</p>
                            <p className="mt-2 font-mono text-sm text-white">{shortAddress(request.recipient)}</p>
                          </div>
                          <div className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4">
                            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Created</p>
                            <p className="mt-2 font-mono text-sm text-white">{formatClock(request.createdAt)}</p>
                          </div>
                        </div>

                        <div className="mt-5 rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="ct-label">Approval ledger</div>
                            <span className="font-mono text-sm text-zinc-100">
                              {request.approvals.filter((entry) => entry.decision === "approved").length}/{selectedRoom.quorum}
                            </span>
                          </div>
                          <ul className="mt-4 space-y-3">
                            {request.approvals.length === 0 ? (
                              <li className="rounded-2xl border border-dashed border-white/10 px-4 py-3 text-sm text-zinc-500">No approvals recorded yet.</li>
                            ) : (
                              request.approvals.map((approval) => (
                                <li key={`${request.id}_${approval.approverId}`} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                                  <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                      <span
                                        className={`rounded-full border px-3 py-1 text-[0.68rem] uppercase tracking-[0.24em] ${
                                          approval.decision === "approved"
                                            ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-200"
                                            : "border-rose-300/25 bg-rose-300/10 text-rose-200"
                                        }`}
                                      >
                                        {approval.decision}
                                      </span>
                                      <span className="font-medium text-white">{approval.approverName}</span>
                                    </div>
                                    <span className="font-mono text-xs text-zinc-500">{formatClock(approval.createdAt)}</span>
                                  </div>
                                  {approval.note ? <p className="mt-2 text-sm leading-6 text-zinc-400">{approval.note}</p> : null}
                                </li>
                              ))
                            )}
                          </ul>
                        </div>

                        {request.status !== "executed" ? (
                          <div className="mt-5 rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
                            <div className="ct-label">Quorum controls</div>
                            <div className="mt-4 grid gap-4">
                              <label className="space-y-2 text-sm text-zinc-300">
                                Approver
                                <select
                                  className="ct-select"
                                  value={approvalForm.approverId}
                                  onChange={(event) => setApprovalField(request.id, "approverId", event.target.value)}
                                >
                                  {selectedRoom.approvers.map((approver) => (
                                    <option key={approver.id} value={approver.id}>
                                      {approver.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="space-y-2 text-sm text-zinc-300">
                                Approval note
                                <input
                                  className="ct-input"
                                  value={approvalForm.note}
                                  onChange={(event) => setApprovalField(request.id, "note", event.target.value)}
                                  placeholder="Budget, memo, and risk check passed"
                                />
                              </label>
                            </div>
                            <div className="mt-4 flex flex-wrap gap-3">
                              <button
                                type="button"
                                className="ct-button-secondary"
                                disabled={isPending}
                                onClick={() => submitApproval(selectedRoom.id, request.id, "approved")}
                              >
                                {isPending ? "Saving..." : "Approve request"}
                              </button>
                              <button
                                type="button"
                                className="ct-button-ghost !text-rose-200 hover:!text-rose-100"
                                disabled={isPending}
                                onClick={() => submitApproval(selectedRoom.id, request.id, "rejected")}
                              >
                                Reject request
                              </button>
                            </div>
                          </div>
                        ) : null}

                        {request.status === "approved" ? (
                          <div className="mt-5 rounded-[22px] border border-emerald-300/15 bg-emerald-300/[0.05] p-4">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                              <div>
                                <div className="ct-label">Execute With WDK</div>
                                <p className="mt-2 text-sm leading-7 text-zinc-300">
                                  Use the operator key to let Claw submit the real Plasma transfer through the configured WDK wallet module.
                                </p>
                              </div>
                              <span
                                className={`rounded-full border px-3 py-1 text-[0.68rem] uppercase tracking-[0.24em] ${
                                  selectedRoomWdkReady
                                    ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-200"
                                    : "border-amber-300/25 bg-amber-300/10 text-amber-200"
                                }`}
                              >
                                {selectedRoomWdkReady ? "wdk ready" : "config needed"}
                              </span>
                            </div>

                            <div className="mt-4 grid gap-4">
                              <label className="space-y-2 text-sm text-zinc-300">
                                Operator key
                                <input
                                  className="ct-input font-mono"
                                  type="password"
                                  value={executionForm.operatorKey}
                                  onChange={(event) => setExecutionField(request.id, "operatorKey", event.target.value)}
                                  placeholder="Matches CLAW_TREASURY_OPERATOR_KEY"
                                />
                              </label>
                              {!selectedRoomWdkReady ? (
                                <div className="rounded-[18px] border border-amber-300/15 bg-amber-300/[0.06] px-4 py-4 text-sm leading-6 text-amber-100">
                                  WDK execution is blocked until this room has a real wallet address, a real Plasma USD₮ asset contract, a matching
                                  alias in <span className="font-mono">CLAW_TREASURY_WDK_WALLETS_JSON</span>, and an operator key in{" "}
                                  <span className="font-mono">CLAW_TREASURY_OPERATOR_KEY</span>.
                                </div>
                              ) : null}
                            </div>

                            <div className="mt-4 flex flex-wrap gap-3">
                              <button
                                type="button"
                                className="ct-button-primary"
                                disabled={isPending || !selectedRoomWdkReady || !executionForm.operatorKey.trim()}
                                onClick={() => submitWdkExecution(selectedRoom.id, request.id)}
                              >
                                {isPending ? "Executing..." : "Execute with WDK"}
                              </button>
                            </div>

                            <div className="mt-5 rounded-[20px] border border-white/10 bg-black/25 p-4">
                              <div className="ct-label">Manual fallback</div>
                              <p className="mt-2 text-sm leading-6 text-zinc-400">
                                If you executed outside ClawTreasury, attach the resulting receipt manually instead of using the WDK button above.
                              </p>
                              <div className="mt-4 grid gap-4">
                                <label className="space-y-2 text-sm text-zinc-300">
                                  Executed by
                                  <input
                                    className="ct-input"
                                    value={executionForm.executedBy}
                                    onChange={(event) => setExecutionField(request.id, "executedBy", event.target.value)}
                                  />
                                </label>
                                <label className="space-y-2 text-sm text-zinc-300">
                                  Transaction hash
                                  <input
                                    className="ct-input font-mono"
                                    value={executionForm.txHash}
                                    onChange={(event) => setExecutionField(request.id, "txHash", event.target.value)}
                                    placeholder="0x..."
                                  />
                                </label>
                                <label className="space-y-2 text-sm text-zinc-300">
                                  Explorer URL
                                  <input
                                    className="ct-input font-mono"
                                    value={executionForm.explorerUrl}
                                    onChange={(event) => setExecutionField(request.id, "explorerUrl", event.target.value)}
                                    placeholder="https://plasmascan.to/tx/0x..."
                                  />
                                </label>
                              </div>
                              <div className="mt-4 flex flex-wrap gap-3">
                                <button
                                  type="button"
                                  className="ct-button-secondary"
                                  disabled={isPending || !executionForm.txHash.trim()}
                                  onClick={() => submitManualExecution(selectedRoom.id, request.id)}
                                >
                                  {isPending ? "Anchoring..." : "Attach manual receipt"}
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : null}

                        {request.execution ? (
                          <div className="mt-5 rounded-[22px] border border-cyan-300/15 bg-cyan-300/[0.06] p-4">
                            <div className="ct-label">Execution receipt</div>
                            <div className="mt-3 space-y-3">
                              <p className="font-mono text-sm text-white">{shortHash(request.execution.txHash)}</p>
                              <div className="flex flex-wrap gap-3 text-sm text-zinc-300">
                                <span>Executed by {request.execution.executedBy}</span>
                                <span>{formatClock(request.execution.executedAt)}</span>
                                <span>{executionModeLabel(request.execution.mode)}</span>
                              </div>
                              {request.execution.feeWei || request.execution.wdkAccountAddress ? (
                                <div className="flex flex-wrap gap-3 text-xs text-zinc-500">
                                  {request.execution.feeWei ? <span>Fee {request.execution.feeWei} wei</span> : null}
                                  {request.execution.quoteFeeWei ? <span>Quote {request.execution.quoteFeeWei} wei</span> : null}
                                  {request.execution.wdkAccountAddress ? (
                                    <span>Vault {shortAddress(request.execution.wdkAccountAddress)}</span>
                                  ) : null}
                                </div>
                              ) : null}
                              <a
                                href={request.execution.explorerUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-2 text-sm text-cyan-200 transition hover:text-cyan-100"
                              >
                                Open explorer
                              </a>
                            </div>
                          </div>
                        ) : null}
                      </motion.article>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-6 rounded-[24px] border border-dashed border-white/10 bg-black/20 px-6 py-8 text-center text-zinc-400">
                  No spend requests yet for this room. Route the first intent from the WDK dispatch composer.
                </div>
              )
            ) : (
              <div className="mt-6 rounded-[24px] border border-dashed border-white/10 bg-black/20 px-6 py-8 text-center text-zinc-400">
                Provision a room to unlock approvals and receipts.
              </div>
            )}
          </motion.section>

          <motion.section {...revealMotion} className="ct-panel px-6 py-6">
            <div className="space-y-2">
              <div className="ct-label">Provision Treasury Room</div>
              <h3 className="text-2xl font-semibold tracking-[-0.03em] text-white">Launch a real wallet module with routing, policy, and signers pre-wired.</h3>
              <p className="text-sm leading-7 text-zinc-400">
                This is the provisioning surface for additional treasury rooms. Each room becomes a modular WDK wallet capsule with its own route
                command, spend ceiling, and approval roster.
              </p>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-2 text-sm text-zinc-300">
                Room name
                <input className="ct-input" value={createForm.name} onChange={(event) => setRoomField("name", event.target.value)} placeholder="Growth Ops Treasury" />
              </label>
              <label className="space-y-2 text-sm text-zinc-300">
                Channel
                <select className="ct-select" value={createForm.channel} onChange={(event) => setRoomField("channel", event.target.value)}>
                  {channelOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm text-zinc-300">
                Route command
                <input className="ct-input font-mono" value={createForm.routeCommand} onChange={(event) => setRoomField("routeCommand", event.target.value)} placeholder="claw-topic" />
              </label>
              <label className="space-y-2 text-sm text-zinc-300">
                WDK key alias
                <input className="ct-input font-mono" value={createForm.wdkKeyAlias} onChange={(event) => setRoomField("wdkKeyAlias", event.target.value)} placeholder="wdk-plasma-main" />
              </label>
              <label className="space-y-2 text-sm text-zinc-300 sm:col-span-2 xl:col-span-2">
                Channel label
                <input
                  className="ct-input"
                  value={createForm.channelLabel}
                  onChange={(event) => setRoomField("channelLabel", event.target.value)}
                  placeholder="Telegram group -100... / topic 12"
                />
              </label>
              <label className="space-y-2 text-sm text-zinc-300 sm:col-span-2 xl:col-span-2">
                Session key
                <input
                  className="ct-input font-mono"
                  value={createForm.sessionKey}
                  onChange={(event) => setRoomField("sessionKey", event.target.value)}
                  placeholder="agent:main:telegram:group:-100...:topic:12"
                />
              </label>
              <label className="space-y-2 text-sm text-zinc-300 sm:col-span-2">
                Wallet address
                <input className="ct-input font-mono" value={createForm.walletAddress} onChange={(event) => setRoomField("walletAddress", event.target.value)} placeholder="0x..." />
              </label>
              <label className="space-y-2 text-sm text-zinc-300">
                Network
                <input className="ct-input" value={createForm.network} onChange={(event) => setRoomField("network", event.target.value)} />
              </label>
              <label className="space-y-2 text-sm text-zinc-300">
                Asset symbol
                <input className="ct-input" value={createForm.assetSymbol} onChange={(event) => setRoomField("assetSymbol", event.target.value)} />
              </label>
              <label className="space-y-2 text-sm text-zinc-300 sm:col-span-2">
                Asset address
                <input className="ct-input font-mono" value={createForm.assetAddress} onChange={(event) => setRoomField("assetAddress", event.target.value)} placeholder="Plasma USD₮ contract address" />
              </label>
              <label className="space-y-2 text-sm text-zinc-300">
                Balance
                <input className="ct-input font-mono" value={createForm.balance} onChange={(event) => setRoomField("balance", event.target.value)} placeholder="0.00" />
              </label>
              <label className="space-y-2 text-sm text-zinc-300">
                Gas reserve
                <input className="ct-input font-mono" value={createForm.gasReserve} onChange={(event) => setRoomField("gasReserve", event.target.value)} placeholder="0.028" />
              </label>
              <label className="space-y-2 text-sm text-zinc-300">
                Quorum
                <input className="ct-input font-mono" value={createForm.quorum} onChange={(event) => setRoomField("quorum", event.target.value)} placeholder="2" />
              </label>
              <label className="space-y-2 text-sm text-zinc-300">
                Daily limit
                <input className="ct-input font-mono" value={createForm.dailyLimit} onChange={(event) => setRoomField("dailyLimit", event.target.value)} placeholder="150.00" />
              </label>
              <label className="space-y-2 text-sm text-zinc-300 sm:col-span-2 xl:col-span-4">
                Agent mode
                <select className="ct-select" value={createForm.agentMode} onChange={(event) => setRoomField("agentMode", event.target.value)}>
                  {agentModeOptions.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm text-zinc-300">
                WDK account index
                <input className="ct-input font-mono" value={createForm.wdkAccountIndex} onChange={(event) => setRoomField("wdkAccountIndex", event.target.value)} placeholder="0" />
              </label>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-3">
              <label className="space-y-2 text-sm text-zinc-300">
                Approvers
                <textarea
                  className="ct-textarea"
                  rows={5}
                  value={createForm.approvers}
                  onChange={(event) => setRoomField("approvers", event.target.value)}
                  placeholder={"Treasury Lead | finance | @treasurylead\nOperator | ops | @treasuryops"}
                />
                <span className="text-xs text-zinc-500">Use one approver per line in the format: Name | role | @handle</span>
              </label>
              <label className="space-y-2 text-sm text-zinc-300">
                Recipient allowlist
                <textarea
                  className="ct-textarea font-mono"
                  rows={5}
                  value={createForm.allowlist}
                  onChange={(event) => setRoomField("allowlist", event.target.value)}
                  placeholder={"0x1234...abcd | Payroll hot wallet\n0xabcd...7890 | Growth agency"}
                />
                <span className="text-xs text-zinc-500">Optional. One recipient per line in the format: 0x... | label</span>
              </label>
              <label className="space-y-2 text-sm text-zinc-300">
                Notes
                <textarea
                  className="ct-textarea"
                  rows={5}
                  value={createForm.notes}
                  onChange={(event) => setRoomField("notes", event.target.value)}
                  placeholder="Policy notes, counterparty restrictions, or escalation rules"
                />
              </label>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button type="button" className="ct-button-primary" disabled={isPending} onClick={submitRoom}>
                {isPending ? "Provisioning..." : "Provision treasury room"}
              </button>
              {createStatus === "saved" ? <span className="ct-chip">saved</span> : null}
              {createStatus === "error" ? <span className="ct-chip !border-rose-300/25 !bg-rose-300/10 !text-rose-200">error</span> : null}
            </div>

            {createError ? <p className="mt-4 text-sm text-rose-300">{createError}</p> : null}
          </motion.section>
        </div>

        <div className="space-y-6">
          <motion.section {...revealMotion} id="agent-feed" className="ct-panel overflow-hidden p-0">
            <div className="border-b border-white/10 bg-white/[0.04] px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="ct-label">Live Agent Reasoning Feed</div>
                  <p className="mt-2 text-sm text-zinc-400">Terminal view of Claw’s thought process, policy checks, and WDK actions.</p>
                </div>
                <span className="ct-chip">
                  <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(57,231,197,0.85)]" />
                  streaming
                </span>
              </div>
            </div>

            <div className="bg-black/55 px-5 py-5 font-mono">
              <div className="mb-4 flex items-center justify-between text-[0.68rem] uppercase tracking-[0.28em] text-zinc-500">
                <span>Claw agent terminal</span>
                <span>{formatClock(clock)}</span>
              </div>

              <div className="space-y-3">
                <AnimatePresence initial={false}>
                  {terminalEntries.map((entry) => (
                    <motion.article
                      key={entry.id}
                      layout
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -12 }}
                      transition={{ duration: 0.28 }}
                      className={`rounded-[22px] border px-4 py-4 ${terminalToneStyles(entry.tone)}`}
                    >
                      <div className="flex items-center justify-between gap-3 text-[0.68rem] uppercase tracking-[0.24em] text-zinc-500">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${terminalDotStyles(entry.tone)}`} />
                          <span>{entry.scope}</span>
                          <span>{entry.phase}</span>
                        </div>
                        <span>{formatClock(entry.timestamp)}</span>
                      </div>
                      <p className="mt-3 text-sm leading-7 text-zinc-100">{entry.message}</p>
                      <p className="mt-2 text-xs leading-6 text-zinc-500">{entry.detail}</p>
                    </motion.article>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </motion.section>

          <motion.section {...revealMotion} className="ct-panel px-6 py-6">
            <div className="space-y-2">
              <div className="ct-label">Room Registry</div>
              <h3 className="text-2xl font-semibold tracking-[-0.03em] text-white">Switch the active wallet module and inspect the signer roster.</h3>
            </div>

            <div className="mt-6 space-y-3">
              {rooms.length === 0 ? (
                <div className="rounded-[22px] border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-zinc-500">
                  No treasury rooms registered yet.
                </div>
              ) : (
                rooms.map((room) => (
                  <button
                    key={room.id}
                    type="button"
                    onClick={() => setSelectedRoomId(room.id)}
                    className={`w-full rounded-[22px] border px-4 py-4 text-left transition ${
                      room.id === selectedRoom?.id
                        ? "border-emerald-300/25 bg-emerald-300/[0.08] shadow-[0_0_30px_rgba(57,231,197,0.08)]"
                        : "border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.06]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-white">{room.name}</p>
                        <p className="mt-1 text-xs text-zinc-500">{room.channelLabel}</p>
                      </div>
                      <span className={`rounded-full border px-3 py-1 text-[0.68rem] uppercase tracking-[0.24em] ${roomBadgeStyles(room.status)}`}>
                        {room.status}
                      </span>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className="ct-chip !text-[0.62rem]">{room.wdkKeyAlias}</span>
                      <span className="ct-chip !text-[0.62rem]">#{room.wdkAccountIndex}</span>
                      <span className="ct-chip !text-[0.62rem]">{agentModeLabel(room.agentMode)}</span>
                    </div>
                  </button>
                ))
              )}
            </div>

            {selectedRoom ? (
              <div className="mt-6 space-y-4">
                <div className="rounded-[22px] border border-white/10 bg-black/25 p-4">
                  <div className="ct-label">Signer roster</div>
                  <ul className="mt-4 space-y-3">
                    {selectedRoom.approvers.map((approver) => (
                      <li key={approver.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3">
                        <div>
                          <p className="font-medium text-white">{approver.name}</p>
                          <p className="text-xs text-zinc-500">
                            {approver.role} • {approver.handle}
                          </p>
                        </div>
                        <span className="ct-chip !text-[0.62rem]">{selectedRoom.quorum}-of-{selectedRoom.approvers.length}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-[22px] border border-white/10 bg-black/25 p-4">
                  <div className="ct-label">Control notes</div>
                  <p className="mt-3 text-sm leading-7 text-zinc-400">{selectedRoom.notes || "No policy notes attached yet."}</p>
                </div>

                <div className="rounded-[22px] border border-white/10 bg-black/25 p-4">
                  <div className="ct-label">Recipient allowlist</div>
                  {selectedRoom.allowedRecipients.length === 0 ? (
                    <p className="mt-3 text-sm leading-7 text-zinc-400">Open policy. Any recipient can be requested while the other checks pass.</p>
                  ) : (
                    <ul className="mt-4 space-y-3">
                      {selectedRoom.allowedRecipients.map((recipient) => (
                        <li key={recipient.address} className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3">
                          <p className="font-medium text-white">{recipient.label}</p>
                          <p className="mt-1 font-mono text-xs text-zinc-500">{recipient.address}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}
          </motion.section>
        </div>
      </div>

      <AnimatePresence>
        {toast ? (
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 18 }}
            className={`fixed bottom-5 right-5 z-[70] max-w-sm rounded-[22px] border px-4 py-4 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl ${
              toast.tone === "success"
                ? "border-emerald-300/25 bg-emerald-300/[0.12] text-emerald-50"
                : "border-rose-300/25 bg-rose-300/[0.12] text-rose-50"
            }`}
          >
            <div className="ct-label !text-current/80">{toast.tone === "success" ? "System update" : "Operator alert"}</div>
            <p className="mt-2 text-sm leading-6">{toast.message}</p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {drawerOpen && drawerForm ? (
          <>
            <motion.div
              className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawerOpen(false)}
            />

            <motion.aside
              className="fixed inset-y-4 right-4 z-[90] flex w-[calc(100vw-2rem)] max-w-xl flex-col overflow-hidden rounded-[32px] border border-white/10 bg-[#0b0d10]/95 shadow-[0_30px_120px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
              initial={{ opacity: 0, x: 44 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 44 }}
              transition={{ type: "spring", stiffness: 280, damping: 28 }}
            >
              <div className="border-b border-white/10 px-5 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="ct-label">WDK Integration Overlay</div>
                    <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-white">Wallet Management</h3>
                    <p className="mt-2 text-sm leading-7 text-zinc-400">
                      Swap the bound key alias, re-route the session, or tighten autonomous spend limits without changing custody assumptions.
                    </p>
                  </div>
                  <button type="button" className="ct-button-ghost !px-0" onClick={() => setDrawerOpen(false)}>
                    Close
                  </button>
                </div>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
                <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                  <div className="ct-label">Modular wallet posture</div>
                  <p className="mt-3 text-sm leading-7 text-zinc-400">
                    This drawer mirrors the WDK philosophy: wallet controls are modular. You can rotate the session binding, narrow the daily cap,
                    or reduce agent authority while leaving the underlying treasury vault non-custodial.
                  </p>
                </div>

                {selectedRoom ? (
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                    <div className="rounded-[24px] border border-white/10 bg-black/25 p-4">
                      <div className="ct-label">Live binding</div>
                      <div className="mt-4 space-y-3">
                        <div>
                          <p className="text-sm text-zinc-500">Signer capsule</p>
                          <p className="mt-1 font-mono text-sm text-white">
                            {selectedRoom.wdkKeyAlias} #{selectedRoom.wdkAccountIndex}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-zinc-500">Bound wallet</p>
                          <p className="mt-1 font-mono text-sm text-white break-all">{selectedRoom.walletAddress}</p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <p className="text-sm text-zinc-500">{selectedRoom.assetSymbol} reserve</p>
                            <p className="mt-1 font-mono text-sm text-white">{selectedRoom.balance}</p>
                          </div>
                          <div>
                            <p className="text-sm text-zinc-500">Native gas</p>
                            <p className="mt-1 font-mono text-sm text-white">{selectedRoom.gasReserve}</p>
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-xs leading-6 text-zinc-400">
                          {walletActionBlocked
                            ? `Wallet actions are locked until ${activeWalletActionCount} pending or approved request${activeWalletActionCount === 1 ? "" : "s"} is cleared.`
                            : "Wallet actions are clear. Rotate, sweep, or rebind directly from this drawer without editing raw fields."}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-white/10 bg-black/25 p-4">
                      <div className="ct-label">Binding history</div>
                      {selectedRoom.walletHistory.length === 0 ? (
                        <p className="mt-4 text-sm leading-7 text-zinc-500">No previous wallet binding stored yet. The first rotate or rebind will start the rollback trail.</p>
                      ) : (
                        <ul className="mt-4 space-y-3">
                          {selectedRoom.walletHistory
                            .slice(-4)
                            .reverse()
                            .map((entry) => (
                              <li key={`${entry.wdkKeyAlias}_${entry.wdkAccountIndex}_${entry.recordedAt}`} className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3">
                                <p className="font-mono text-sm text-white">
                                  {entry.wdkKeyAlias} #{entry.wdkAccountIndex}
                                </p>
                                <p className="mt-1 font-mono text-xs text-zinc-500">{entry.walletAddress}</p>
                                <p className="mt-2 text-xs text-zinc-400">{formatStamp(entry.recordedAt)}</p>
                              </li>
                            ))}
                        </ul>
                      )}
                    </div>
                  </div>
                ) : null}

                <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                  <div className="ct-label">Wallet actions</div>
                  <p className="mt-3 text-sm leading-7 text-zinc-400">
                    Rotate to the next unused derived account, roll back to the last binding, or rebind this room to the index in the field below.
                    Sweep operations move the treasury token balance and then best-effort carry forward leftover native gas into the new wallet.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button type="button" className="ct-button-primary" disabled={isPending || !selectedRoom || walletActionBlocked} onClick={() => submitWalletAction("rotate")}>
                      Rotate wallet
                    </button>
                    <button type="button" className="ct-button-secondary" disabled={isPending || !selectedRoom || walletActionBlocked} onClick={() => submitWalletAction("rotate-sweep")}>
                      Rotate + sweep
                    </button>
                    <button
                      type="button"
                      className="ct-button-ghost"
                      disabled={isPending || !selectedRoom || walletActionBlocked || selectedRoom.walletHistory.length === 0}
                      onClick={() => submitWalletAction("rollback")}
                    >
                      Rollback
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <button
                      type="button"
                      className="ct-button-ghost"
                      disabled={isPending || !selectedRoom || walletActionBlocked || !drawerForm?.wdkAccountIndex.trim()}
                      onClick={() => submitWalletAction("set-index")}
                    >
                      Rebind to index
                    </button>
                    <button
                      type="button"
                      className="ct-button-ghost"
                      disabled={isPending || !selectedRoom || walletActionBlocked || !drawerForm?.wdkAccountIndex.trim()}
                      onClick={() => submitWalletAction("set-index-sweep")}
                    >
                      Rebind + sweep
                    </button>
                  </div>
                  <p className="mt-3 text-xs leading-6 text-zinc-500">
                    Rebind actions use the current <span className="font-mono text-zinc-300">WDK account index</span> field as the target. Save is still
                    available below for manual route, alias, and policy changes.
                  </p>
                </div>

                <div className="grid gap-4">
                  <label className="space-y-2 text-sm text-zinc-300">
                    WDK key alias
                    <input
                      className="ct-input font-mono"
                      value={drawerForm.wdkKeyAlias}
                      onChange={(event) => setDrawerField("wdkKeyAlias", event.target.value)}
                      placeholder="wdk-plasma-main"
                    />
                  </label>
                  <label className="space-y-2 text-sm text-zinc-300">
                    WDK account index
                    <input
                      className="ct-input font-mono"
                      value={drawerForm.wdkAccountIndex}
                      onChange={(event) => setDrawerField("wdkAccountIndex", event.target.value)}
                      placeholder="0"
                    />
                  </label>
                  <label className="space-y-2 text-sm text-zinc-300">
                    Session key
                    <input
                      className="ct-input font-mono"
                      value={drawerForm.sessionKey}
                      onChange={(event) => setDrawerField("sessionKey", event.target.value)}
                      placeholder="agent:main:telegram:..."
                    />
                  </label>
                  <label className="space-y-2 text-sm text-zinc-300">
                    Route command
                    <input className="ct-input font-mono" value={drawerForm.routeCommand} onChange={(event) => setDrawerField("routeCommand", event.target.value)} />
                  </label>
                  <label className="space-y-2 text-sm text-zinc-300">
                    Wallet address
                    <input className="ct-input font-mono" value={drawerForm.walletAddress} onChange={(event) => setDrawerField("walletAddress", event.target.value)} />
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2 text-sm text-zinc-300">
                      Daily spend limit
                      <input className="ct-input font-mono" value={drawerForm.dailyLimit} onChange={(event) => setDrawerField("dailyLimit", event.target.value)} />
                    </label>
                    <label className="space-y-2 text-sm text-zinc-300">
                      Gas reserve
                      <input className="ct-input font-mono" value={drawerForm.gasReserve} onChange={(event) => setDrawerField("gasReserve", event.target.value)} />
                    </label>
                  </div>
                  <label className="space-y-2 text-sm text-zinc-300">
                    Agent mode
                    <select className="ct-select" value={drawerForm.agentMode} onChange={(event) => setDrawerField("agentMode", event.target.value)}>
                      {agentModeOptions.map((mode) => (
                        <option key={mode.value} value={mode.value}>
                          {mode.label}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-zinc-500">{agentModeOptions.find((mode) => mode.value === drawerForm.agentMode)?.detail}</span>
                  </label>
                  <label className="space-y-2 text-sm text-zinc-300">
                    Policy notes
                    <textarea className="ct-textarea" rows={6} value={drawerForm.notes} onChange={(event) => setDrawerField("notes", event.target.value)} />
                  </label>
                  <label className="space-y-2 text-sm text-zinc-300">
                    Recipient allowlist
                    <textarea
                      className="ct-textarea font-mono"
                      rows={6}
                      value={drawerForm.allowlist}
                      onChange={(event) => setDrawerField("allowlist", event.target.value)}
                      placeholder={"0x1234...abcd | Payroll hot wallet\n0xabcd...7890 | Growth agency"}
                    />
                    <span className="text-xs text-zinc-500">Leave empty to keep the treasury open to any recipient.</span>
                  </label>
                </div>
              </div>

              <div className="border-t border-white/10 px-5 py-4">
                <div className="flex flex-wrap gap-3">
                  <button type="button" className="ct-button-primary" disabled={isPending} onClick={saveDrawerPolicy}>
                    {isPending ? "Saving..." : "Save wallet module"}
                  </button>
                  <button type="button" className="ct-button-secondary" disabled={isPending} onClick={() => setDrawerOpen(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
