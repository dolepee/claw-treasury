import path from "node:path";
import { get, put } from "@vercel/blob";
import { getDataDir } from "@/lib/paths";
import { readJsonFile, writeJsonFile } from "@/lib/fs-utils";
import {
  TreasuryAllowedRecipient,
  TreasuryAgentMode,
  TreasuryApprovalDecision,
  TreasuryApprover,
  TreasuryChannel,
  TreasuryExecution,
  TreasuryExecutionMode,
  TreasuryRoom,
  TreasuryRoomStatus,
  TreasurySpendRequest,
  TreasuryStore,
} from "@/lib/types";

const treasuryFile = path.join(getDataDir(), "treasury.json");
const treasuryBlobPath = "stores/treasury.json";

const emptyStore: TreasuryStore = {
  rooms: [],
};

type CreateRoomInput = {
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
  gasReserve?: string;
  quorum: number;
  dailyLimit: string;
  wdkKeyAlias?: string;
  wdkAccountIndex?: number;
  agentMode?: TreasuryAgentMode;
  notes: string;
  status?: TreasuryRoomStatus;
  approvers: TreasuryApprover[];
  allowedRecipients?: TreasuryAllowedRecipient[];
};

type CreateRequestInput = {
  roomId: string;
  requestedBy: string;
  amount: string;
  assetSymbol: string;
  recipient: string;
  memo: string;
};

type RecordApprovalInput = {
  roomId: string;
  requestId: string;
  approverId: string;
  decision: TreasuryApprovalDecision;
  note: string;
};

type RecordExecutionInput = {
  roomId: string;
  requestId: string;
  executedBy: string;
  txHash: string;
  explorerUrl: string;
  mode?: TreasuryExecutionMode;
  feeWei?: string | null;
  quoteFeeWei?: string | null;
  wdkAccountAddress?: string | null;
  nextBalance?: string;
  nextGasReserve?: string;
};

type UpdateRoomControlInput = {
  roomId: string;
  routeCommand?: string;
  sessionKey?: string;
  walletAddress?: string;
  dailyLimit?: string;
  gasReserve?: string;
  wdkKeyAlias?: string;
  wdkAccountIndex?: number;
  agentMode?: TreasuryAgentMode;
  quorum?: number;
  approvers?: TreasuryApprover[];
  allowedRecipients?: TreasuryAllowedRecipient[];
  notes?: string;
};

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function sortRooms(rooms: TreasuryRoom[]): TreasuryRoom[] {
  return [...rooms].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function sortRequests(requests: TreasurySpendRequest[]): TreasurySpendRequest[] {
  return [...requests].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function shouldUseBlobStore(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function isTreasuryAgentMode(value: string | undefined): value is TreasuryAgentMode {
  return value === "observe" || value === "propose" || value === "execute-after-quorum";
}

function numeric(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeAccountIndex(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(Number(value)));
}

function defaultGasReserve(room: Pick<TreasuryRoom, "quorum" | "requests" | "dailyLimit">): string {
  const queuedValue = room.requests.reduce((sum, request) => {
    if (request.status === "approved" || request.status === "pending-approvals") {
      return sum + numeric(request.amount);
    }
    return sum;
  }, 0);
  const computed = 0.018 + room.quorum * 0.004 + Math.min(queuedValue, numeric(room.dailyLimit)) * 0.0002;
  return computed.toFixed(3);
}

function defaultKeyAlias(room: Pick<TreasuryRoom, "name" | "slug">): string {
  const source = room.slug || slugify(room.name) || "vault";
  return `wdk-${source}`.slice(0, 28);
}

function normalizeComparable(value: string): string {
  return value.trim().toLowerCase();
}

function isActiveRequestStatus(status: TreasurySpendRequest["status"]): boolean {
  return status === "pending-approvals" || status === "approved";
}

function normalizeRoom(room: TreasuryRoom): TreasuryRoom {
  return {
    ...room,
    gasReserve: room.gasReserve?.trim() || defaultGasReserve(room),
    wdkKeyAlias: room.wdkKeyAlias?.trim() || defaultKeyAlias(room),
    wdkAccountIndex: normalizeAccountIndex(room.wdkAccountIndex),
    agentMode: isTreasuryAgentMode(room.agentMode) ? room.agentMode : "execute-after-quorum",
    allowedRecipients: normalizeAllowedRecipients(room.allowedRecipients ?? []),
    requests: sortRequests(room.requests.map(normalizeRequest)),
  };
}

function normalizeRequest(request: TreasurySpendRequest): TreasurySpendRequest {
  return {
    ...request,
    execution: request.execution ? normalizeExecution(request.execution) : null,
  };
}

function normalizeExecution(execution: TreasuryExecution): TreasuryExecution {
  return {
    ...execution,
    mode: execution.mode ?? "manual-receipt",
    feeWei: execution.feeWei ?? null,
    quoteFeeWei: execution.quoteFeeWei ?? null,
    wdkAccountAddress: execution.wdkAccountAddress ?? null,
  };
}

function normalizeApprovers(approvers: TreasuryApprover[]): TreasuryApprover[] {
  return approvers.map((entry, index) => ({
    id: entry.id?.trim() || `approver_${index + 1}`,
    name: entry.name.trim(),
    role: entry.role.trim() || "approver",
    handle: entry.handle.trim() || entry.name.trim(),
  }));
}

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function normalizeAllowedRecipients(allowedRecipients: TreasuryAllowedRecipient[]): TreasuryAllowedRecipient[] {
  return allowedRecipients
    .map((entry) => ({
      address: entry.address.trim(),
      label: entry.label.trim(),
    }))
    .filter((entry) => /^0x[a-fA-F0-9]{40}$/.test(entry.address))
    .map((entry) => ({
      address: entry.address,
      label: entry.label || shortAddress(entry.address),
    }))
    .filter((entry, index, collection) => collection.findIndex((candidate) => normalizeComparable(candidate.address) === normalizeComparable(entry.address)) === index)
    .sort((a, b) => a.label.localeCompare(b.label));
}

function normalizeStore(store: TreasuryStore): TreasuryStore {
  return {
    rooms: sortRooms(store.rooms.map(normalizeRoom)),
  };
}

export async function loadTreasuryStore(): Promise<TreasuryStore> {
  if (shouldUseBlobStore()) {
    try {
      const result = await get(treasuryBlobPath, { access: "private", useCache: false });
      if (!result) {
        return emptyStore;
      }
      const raw = await new Response(result.stream).text();
      return normalizeStore(JSON.parse(raw) as TreasuryStore);
    } catch {
      return emptyStore;
    }
  }

  return normalizeStore(await readJsonFile<TreasuryStore>(treasuryFile, emptyStore));
}

export async function saveTreasuryStore(store: TreasuryStore): Promise<void> {
  const normalized = normalizeStore(store);

  if (shouldUseBlobStore()) {
    await put(treasuryBlobPath, `${JSON.stringify(normalized, null, 2)}\n`, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return;
  }

  await writeJsonFile(treasuryFile, normalized);
}

export async function loadTreasuryDashboard(): Promise<{
  rooms: TreasuryRoom[];
}> {
  const store = await loadTreasuryStore();
  return { rooms: store.rooms };
}

export async function loadTreasuryRoom(roomId: string): Promise<TreasuryRoom | null> {
  const store = await loadTreasuryStore();
  return store.rooms.find((entry) => entry.id === roomId) ?? null;
}

export async function loadTreasuryRoomBySessionKey(sessionKey: string): Promise<TreasuryRoom | null> {
  const store = await loadTreasuryStore();
  return store.rooms.find((entry) => entry.sessionKey === sessionKey.trim()) ?? null;
}

export async function loadTreasuryRoomRequest(
  roomId: string,
  requestId: string,
): Promise<{ room: TreasuryRoom; request: TreasurySpendRequest } | null> {
  const room = await loadTreasuryRoom(roomId);
  if (!room) {
    return null;
  }

  const request = room.requests.find((entry) => entry.id === requestId);
  if (!request) {
    return null;
  }

  return { room, request };
}

export async function createTreasuryRoom(input: CreateRoomInput): Promise<TreasuryRoom> {
  const store = await loadTreasuryStore();
  const existing = store.rooms.find((entry) => entry.sessionKey === input.sessionKey.trim());
  if (existing) {
    throw new Error(`A treasury room is already bound to session ${input.sessionKey.trim()}.`);
  }
  const now = new Date().toISOString();
  const room = normalizeRoom({
    id: createId("room"),
    slug: slugify(input.name),
    name: input.name,
    channel: input.channel,
    channelLabel: input.channelLabel,
    routeCommand: input.routeCommand,
    sessionKey: input.sessionKey,
    walletAddress: input.walletAddress,
    network: input.network,
    assetSymbol: input.assetSymbol,
    assetAddress: input.assetAddress,
    balance: input.balance,
    gasReserve: input.gasReserve ?? "",
    quorum: input.quorum,
    dailyLimit: input.dailyLimit,
    wdkKeyAlias: input.wdkKeyAlias ?? "",
    wdkAccountIndex: normalizeAccountIndex(input.wdkAccountIndex),
    agentMode: input.agentMode ?? "execute-after-quorum",
    status: input.status ?? "active",
    approvers: input.approvers,
    allowedRecipients: input.allowedRecipients ?? [],
    notes: input.notes,
    requests: [],
    createdAt: now,
    updatedAt: now,
  });

  store.rooms.push(room);
  await saveTreasuryStore(store);
  return room;
}

export async function createTreasuryRequest(input: CreateRequestInput): Promise<TreasurySpendRequest | null> {
  const store = await loadTreasuryStore();
  const roomIndex = store.rooms.findIndex((entry) => entry.id === input.roomId);
  if (roomIndex === -1) {
    return null;
  }

  const room = store.rooms[roomIndex];
  const requestedAmount = numeric(input.amount);
  if (requestedAmount > numeric(room.dailyLimit)) {
    throw new Error(`Requested amount ${input.amount} exceeds the treasury daily limit of ${room.dailyLimit}.`);
  }

  if (
    room.allowedRecipients.length > 0
    && !room.allowedRecipients.some((entry) => normalizeComparable(entry.address) === normalizeComparable(input.recipient))
  ) {
    throw new Error(`Recipient ${input.recipient} is not allowlisted for this treasury room.`);
  }

  const duplicate = room.requests.find(
    (entry) =>
      isActiveRequestStatus(entry.status)
      && normalizeComparable(entry.amount) === normalizeComparable(input.amount)
      && normalizeComparable(entry.recipient) === normalizeComparable(input.recipient)
      && normalizeComparable(entry.memo) === normalizeComparable(input.memo),
  );
  if (duplicate) {
    throw new Error(`A matching active request already exists (${duplicate.id}).`);
  }

  const now = new Date().toISOString();
  const request: TreasurySpendRequest = {
    id: createId("req"),
    requestedBy: input.requestedBy,
    amount: input.amount,
    assetSymbol: input.assetSymbol,
    recipient: input.recipient,
    memo: input.memo,
    status: "pending-approvals",
    approvals: [],
    execution: null,
    createdAt: now,
    updatedAt: now,
  };

  store.rooms[roomIndex] = normalizeRoom({
    ...room,
    requests: [request, ...room.requests],
    updatedAt: now,
  });

  await saveTreasuryStore(store);
  return request;
}

export async function suggestTreasuryWdkAccountIndex(alias: string, sessionKey: string): Promise<number> {
  const normalizedAlias = alias.trim();
  if (!normalizedAlias) {
    return 0;
  }

  const store = await loadTreasuryStore();
  const existing = store.rooms.find(
    (entry) => entry.wdkKeyAlias === normalizedAlias && entry.sessionKey.trim() === sessionKey.trim(),
  );
  if (existing) {
    return normalizeAccountIndex(existing.wdkAccountIndex);
  }

  const usedIndexes = store.rooms
    .filter((entry) => entry.wdkKeyAlias === normalizedAlias)
    .map((entry) => normalizeAccountIndex(entry.wdkAccountIndex));

  return usedIndexes.length === 0 ? 0 : Math.max(...usedIndexes) + 1;
}

export async function recordTreasuryApproval(input: RecordApprovalInput): Promise<TreasurySpendRequest | null> {
  const store = await loadTreasuryStore();
  const roomIndex = store.rooms.findIndex((entry) => entry.id === input.roomId);
  if (roomIndex === -1) {
    return null;
  }

  const room = store.rooms[roomIndex];
  const approver = room.approvers.find((entry) => entry.id === input.approverId);
  if (!approver) {
    return null;
  }

  const requestIndex = room.requests.findIndex((entry) => entry.id === input.requestId);
  if (requestIndex === -1) {
    return null;
  }

  const current = room.requests[requestIndex];
  if (current.status === "executed") {
    return current;
  }

  const now = new Date().toISOString();
  const nextApprovals = [
    ...current.approvals.filter((entry) => entry.approverId !== input.approverId),
    {
      approverId: approver.id,
      approverName: approver.name,
      decision: input.decision,
      note: input.note,
      createdAt: now,
    },
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const hasRejection = nextApprovals.some((entry) => entry.decision === "rejected");
  const approvedCount = nextApprovals.filter((entry) => entry.decision === "approved").length;
  const nextStatus = hasRejection ? "rejected" : approvedCount >= room.quorum ? "approved" : "pending-approvals";

  const nextRequest: TreasurySpendRequest = {
    ...current,
    approvals: nextApprovals,
    status: nextStatus,
    updatedAt: now,
  };

  const nextRequests = [...room.requests];
  nextRequests[requestIndex] = nextRequest;

  store.rooms[roomIndex] = normalizeRoom({
    ...room,
    requests: nextRequests,
    updatedAt: now,
  });

  await saveTreasuryStore(store);
  return nextRequest;
}

export async function recordTreasuryExecution(input: RecordExecutionInput): Promise<TreasurySpendRequest | null> {
  const store = await loadTreasuryStore();
  const roomIndex = store.rooms.findIndex((entry) => entry.id === input.roomId);
  if (roomIndex === -1) {
    return null;
  }

  const room = store.rooms[roomIndex];
  const requestIndex = room.requests.findIndex((entry) => entry.id === input.requestId);
  if (requestIndex === -1) {
    return null;
  }

  const current = room.requests[requestIndex];
  if (current.status !== "approved" && current.status !== "executed") {
    return null;
  }

  const now = new Date().toISOString();
  const execution: TreasuryExecution = {
    txHash: input.txHash,
    explorerUrl: input.explorerUrl,
    executedBy: input.executedBy,
    executedAt: now,
    mode: input.mode ?? "manual-receipt",
    feeWei: input.feeWei ?? null,
    quoteFeeWei: input.quoteFeeWei ?? null,
    wdkAccountAddress: input.wdkAccountAddress ?? null,
  };

  const nextRequest: TreasurySpendRequest = {
    ...current,
    status: "executed",
    execution,
    updatedAt: now,
  };

  const nextRequests = [...room.requests];
  nextRequests[requestIndex] = nextRequest;

  const nextBalance = input.nextBalance?.trim() || Math.max(0, numeric(room.balance) - numeric(current.amount)).toFixed(2);
  const nextGasReserve = input.nextGasReserve?.trim() || room.gasReserve;

  store.rooms[roomIndex] = normalizeRoom({
    ...room,
    balance: nextBalance,
    gasReserve: nextGasReserve,
    requests: nextRequests,
    updatedAt: now,
  });

  await saveTreasuryStore(store);
  return nextRequest;
}

export async function updateTreasuryRoomControl(input: UpdateRoomControlInput): Promise<TreasuryRoom | null> {
  const store = await loadTreasuryStore();
  const roomIndex = store.rooms.findIndex((entry) => entry.id === input.roomId);
  if (roomIndex === -1) {
    return null;
  }

  const room = store.rooms[roomIndex];
  const nextApprovers = Array.isArray(input.approvers) && input.approvers.length > 0 ? normalizeApprovers(input.approvers) : room.approvers;
  const nextAllowedRecipients = Array.isArray(input.allowedRecipients)
    ? normalizeAllowedRecipients(input.allowedRecipients)
    : room.allowedRecipients;
  const nextQuorum = input.quorum ?? room.quorum;
  if (!Number.isFinite(nextQuorum) || nextQuorum < 1 || nextQuorum > nextApprovers.length) {
    throw new Error(`Quorum must be between 1 and ${nextApprovers.length}.`);
  }

  const now = new Date().toISOString();
  const nextRoom = normalizeRoom({
    ...room,
    routeCommand: input.routeCommand?.trim() || room.routeCommand,
    sessionKey: input.sessionKey?.trim() || room.sessionKey,
    walletAddress: input.walletAddress?.trim() || room.walletAddress,
    dailyLimit: input.dailyLimit?.trim() || room.dailyLimit,
    gasReserve: input.gasReserve?.trim() || room.gasReserve,
    wdkKeyAlias: input.wdkKeyAlias?.trim() || room.wdkKeyAlias,
    wdkAccountIndex: input.wdkAccountIndex !== undefined ? normalizeAccountIndex(input.wdkAccountIndex) : room.wdkAccountIndex,
    agentMode: input.agentMode ?? room.agentMode,
    quorum: nextQuorum,
    approvers: nextApprovers,
    allowedRecipients: nextAllowedRecipients,
    notes: input.notes !== undefined ? input.notes.trim() : room.notes,
    updatedAt: now,
  });

  store.rooms[roomIndex] = nextRoom;
  await saveTreasuryStore(store);
  return nextRoom;
}
