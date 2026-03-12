import {
  buildTelegramChannelLabel,
  buildTelegramRoomName,
  buildTelegramSessionKey,
  formatTelegramActor,
  loadTelegramRuntime,
  matchTelegramApprover,
  parseTelegramDefaultApprovers,
  resolveTelegramChannel,
  resolveTelegramDefaultTreasuryConfig,
  sendTelegramMessage,
  TelegramMessage,
  TelegramUpdate,
} from "@/lib/telegram";
import {
  findTelegramMessageLink,
  hasProcessedTelegramUpdate,
  rememberProcessedTelegramUpdate,
  rememberTelegramMessageLink,
} from "@/lib/telegram-bridge-store";
import {
  createTreasuryRequest,
  createTreasuryRoom,
  loadTreasuryRoomBySessionKey,
  recordTreasuryApproval,
  recordTreasuryExecution,
  updateTreasuryRoomControl,
} from "@/lib/treasury";
import type { TreasuryApprover, TreasuryRoom, TreasurySpendRequest } from "@/lib/types";
import {
  executeTreasuryRequestWithWdk,
  getConfiguredTreasuryOperatorKey,
  inspectTreasuryRoomWithWdk,
  inspectWdkAlias,
} from "@/lib/wdk";

type ParsedCommand =
  | { kind: "help" }
  | { kind: "create-treasury" }
  | { kind: "show-treasury" }
  | { kind: "history" }
  | { kind: "allowlist" }
  | { kind: "set-approvers"; handles: string[] }
  | { kind: "set-quorum"; quorum: number }
  | { kind: "set-daily-limit"; dailyLimit: string }
  | { kind: "allow-recipient"; address: string; label: string }
  | { kind: "remove-recipient"; address: string }
  | { kind: "pay"; amount: string; recipient: string; memo: string }
  | { kind: "approve" | "reject"; reference: string | null; note: string }
  | { kind: "invalid"; message: string };

type TelegramContext = {
  message: TelegramMessage;
  chatId: string;
  threadId?: number;
  sessionKey: string;
};

const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

function extractMessage(update: TelegramUpdate): TelegramMessage | null {
  return update.message ?? null;
}

function requestReference(request: TreasurySpendRequest): string {
  return request.id.replace(/^req_/, "").slice(0, 6);
}

function commandHelp(): string {
  return [
    "ClawTreasury commands",
    "create treasury",
    "show treasury",
    "balance",
    "history",
    "allowlist",
    "set approvers @alice @bob",
    "set quorum 2",
    "set daily limit 250",
    "allow 0x... for payroll",
    "remove recipient 0x...",
    "pay 20 USDT to 0x... for design review",
    "approve <ref> or reply 'approve' to a request",
    "reject <ref> or reply 'reject reason' to a request",
  ].join("\n");
}

function normalizeCommandText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function parseTelegramCommand(rawText: string): ParsedCommand | null {
  const text = normalizeCommandText(rawText);
  if (!text) {
    return null;
  }

  const lower = text.toLowerCase();

  if (/^\/?(start|help)\b/.test(lower)) {
    return { kind: "help" };
  }

  if (/^\/?create(?:_treasury|\s+treasury)\b/.test(lower)) {
    return { kind: "create-treasury" };
  }

  if (/^\/?(show(?:_treasury|\s+treasury)|balance)\b/.test(lower) || lower === "show treasury" || lower === "balance") {
    return { kind: "show-treasury" };
  }

  if (/^\/?history\b/.test(lower)) {
    return { kind: "history" };
  }

  if (/^\/?(allowlist|show\s+allowlist)\b/.test(lower)) {
    return { kind: "allowlist" };
  }

  const approverMatch = text.match(/^\/?(?:set\s+approvers?|approvers?)\b\s+(.+)$/i);
  if (approverMatch) {
    const handles = approverMatch[1]
      .split(/\s+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => (entry.startsWith("@") ? entry : `@${entry}`))
      .filter((entry) => /^@[a-zA-Z0-9_]{4,}$/.test(entry));
    if (handles.length === 0) {
      return { kind: "invalid", message: "Add at least one Telegram handle. Example: set approvers @alice @bob" };
    }

    return { kind: "set-approvers", handles: [...new Set(handles.map((entry) => entry.toLowerCase()))] };
  }

  const quorumMatch = text.match(/^\/?(?:set\s+quorum|quorum)\b\s+([0-9]+)$/i);
  if (quorumMatch) {
    const quorum = Number(quorumMatch[1]);
    if (!Number.isFinite(quorum) || quorum < 1) {
      return { kind: "invalid", message: "Quorum must be a positive integer." };
    }

    return { kind: "set-quorum", quorum: Math.floor(quorum) };
  }

  const dailyLimitMatch = text.match(/^\/?(?:set\s+daily\s+limit|daily\s+limit|limit)\b\s+([0-9]+(?:\.[0-9]+)?)$/i);
  if (dailyLimitMatch) {
    return { kind: "set-daily-limit", dailyLimit: Number(dailyLimitMatch[1]).toFixed(2) };
  }

  const allowRecipientMatch = text.match(
    /^\/?(?:allow|allowlist\s+add|allow\s+recipient)\b\s+(0x[a-fA-F0-9]{40})(?:\s+(?:for|as)\s+(.+))?$/i,
  );
  if (allowRecipientMatch) {
    return {
      kind: "allow-recipient",
      address: allowRecipientMatch[1],
      label: allowRecipientMatch[2]?.trim() || "",
    };
  }

  const removeRecipientMatch = text.match(/^\/?(?:remove\s+recipient|unallow|allowlist\s+remove)\b\s+(0x[a-fA-F0-9]{40})$/i);
  if (removeRecipientMatch) {
    return {
      kind: "remove-recipient",
      address: removeRecipientMatch[1],
    };
  }

  const decisionMatch = text.match(/^\/?(approve|reject)\b(?:\s+(.+))?$/i);
  if (decisionMatch) {
    const tail = decisionMatch[2]?.trim() || "";
    const [firstToken = "", ...restTokens] = tail.split(/\s+/).filter(Boolean);
    const looksLikeReference = /^(req_)?[a-z0-9]{6,}$/i.test(firstToken);
    return {
      kind: decisionMatch[1].toLowerCase() === "approve" ? "approve" : "reject",
      reference: looksLikeReference ? firstToken : null,
      note: looksLikeReference ? restTokens.join(" ").trim() : tail,
    };
  }

  const payMatch = text.match(
    /^\/?(?:pay|request(?:\s+payment)?)\s+([0-9]+(?:\.[0-9]+)?)\s*(?:usd[t₮]?|usdt)?\s+to\s+(0x[a-fA-F0-9]{40})(?:\s+for\s+(.+))?$/i,
  );
  if (payMatch) {
    const memo = payMatch[3]?.trim();
    if (!memo) {
      return { kind: "invalid", message: "Add a memo. Example: pay 20 USDT to 0x... for design review" };
    }

    return {
      kind: "pay",
      amount: Number(payMatch[1]).toFixed(2),
      recipient: payMatch[2],
      memo,
    };
  }

  return null;
}

function findRequestByReference(room: TreasuryRoom, reference: string): TreasurySpendRequest | null {
  const normalized = reference.trim().toLowerCase().replace(/^req_/, "");
  if (!normalized) {
    return null;
  }

  return (
    room.requests.find((entry) => entry.id.toLowerCase() === reference.trim().toLowerCase())
    ?? room.requests.find((entry) => requestReference(entry).toLowerCase() === normalized)
    ?? room.requests.find((entry) => entry.id.toLowerCase().replace(/^req_/, "").startsWith(normalized))
    ?? null
  );
}

function summarizeRoom(room: TreasuryRoom, live: { walletAddress: string; balance: string; gasReserve: string } | null): string {
  const pending = room.requests.filter((entry) => entry.status === "pending-approvals").length;
  const approved = room.requests.filter((entry) => entry.status === "approved").length;
  const executed = room.requests.filter((entry) => entry.status === "executed").length;
  const approvers = room.approvers.map((entry) => entry.handle).join(", ");

  return [
    `${room.name}`,
    `Wallet: ${(live?.walletAddress || room.walletAddress).trim()}`,
    `${room.assetSymbol} balance: ${live?.balance || room.balance}`,
    `Native gas: ${live?.gasReserve || room.gasReserve}`,
    `Quorum: ${room.quorum}/${room.approvers.length}`,
    `Daily limit: ${room.dailyLimit} ${room.assetSymbol}`,
    `Approvers: ${approvers}`,
    summarizeAllowlist(room),
    `Queue: ${pending} pending, ${approved} approved, ${executed} executed`,
  ].join("\n");
}

function summarizePolicy(room: TreasuryRoom): string {
  return [
    `${room.name} policy updated`,
    `Quorum: ${room.quorum}/${room.approvers.length}`,
    `Approvers: ${room.approvers.map((entry) => entry.handle).join(", ")}`,
    `Daily limit: ${room.dailyLimit} ${room.assetSymbol}`,
    summarizeAllowlist(room),
    `Mode: ${room.agentMode}`,
  ].join("\n");
}

function summarizeAllowlist(room: TreasuryRoom): string {
  if (room.allowedRecipients.length === 0) {
    return "Allowlist: open";
  }

  const preview = room.allowedRecipients
    .slice(0, 3)
    .map((entry) => `${entry.label} (${entry.address.slice(0, 6)}...${entry.address.slice(-4)})`)
    .join(", ");
  const suffix = room.allowedRecipients.length > 3 ? ` +${room.allowedRecipients.length - 3} more` : "";
  return `Allowlist: ${preview}${suffix}`;
}

function summarizeAllowlistBoard(room: TreasuryRoom): string {
  if (room.allowedRecipients.length === 0) {
    return `${room.name}\nAllowlist is open. Any recipient can be requested while other policy checks pass.`;
  }

  return [
    `${room.name} allowlist`,
    ...room.allowedRecipients.map((entry) => `${entry.label} | ${entry.address}`),
  ].join("\n");
}

function summarizeHistory(room: TreasuryRoom): string {
  if (room.requests.length === 0) {
    return `${room.name}\nNo treasury activity yet.`;
  }

  return [
    `${room.name} history`,
    ...room.requests.slice(0, 5).map((entry) => {
      const parts = [
        `[${requestReference(entry)}]`,
        `${entry.status}`,
        `${entry.amount} ${entry.assetSymbol}`,
        `to ${entry.recipient}`,
      ];
      if (entry.execution?.txHash) {
        parts.push(`tx ${entry.execution.txHash.slice(0, 10)}...`);
      }
      return parts.join(" | ");
    }),
  ].join("\n");
}

function summarizeRequest(request: TreasurySpendRequest, room: TreasuryRoom): string {
  return [
    `Spend request [${requestReference(request)}]`,
    `${request.amount} ${request.assetSymbol} -> ${request.recipient}`,
    `Memo: ${request.memo}`,
    `Requested by: ${request.requestedBy}`,
    `Policy: ${room.quorum}/${room.approvers.length} quorum, limit ${room.dailyLimit} ${room.assetSymbol}`,
    "Approvers: reply 'approve' or 'reject <reason>' to this message.",
  ].join("\n");
}

function summarizeApproval(request: TreasurySpendRequest, room: TreasuryRoom): string {
  const approvals = request.approvals.filter((entry) => entry.decision === "approved").length;
  if (request.status === "rejected") {
    return `Request [${requestReference(request)}] was rejected. Claw will not execute this payout.`;
  }
  if (request.status === "approved") {
    return `Request [${requestReference(request)}] reached quorum (${approvals}/${room.quorum}). Claw is moving to WDK execution.`;
  }

  return `Approval recorded for [${requestReference(request)}]. Progress: ${approvals}/${room.quorum}.`;
}

async function reply(context: TelegramContext, text: string, replyToMessageId?: number): Promise<{ messageId: number }> {
  return sendTelegramMessage({
    chatId: context.chatId,
    threadId: context.threadId,
    text,
    replyToMessageId: replyToMessageId ?? context.message.message_id,
  });
}

async function getRoomForContext(context: TelegramContext): Promise<TreasuryRoom | null> {
  return loadTreasuryRoomBySessionKey(context.sessionKey);
}

async function resolveLiveRoomSnapshot(room: TreasuryRoom): Promise<{ walletAddress: string; balance: string; gasReserve: string } | null> {
  try {
    const snapshot = await inspectTreasuryRoomWithWdk(room);
    return {
      walletAddress: snapshot.walletAddress,
      balance: snapshot.balance,
      gasReserve: snapshot.gasReserve,
    };
  } catch {
    return null;
  }
}

async function handleCreateTreasury(context: TelegramContext, existingRoom: TreasuryRoom | null): Promise<void> {
  if (existingRoom) {
    const live = await resolveLiveRoomSnapshot(existingRoom);
    await reply(context, `Treasury already active for this thread.\n\n${summarizeRoom(existingRoom, live)}`);
    return;
  }

  const runtime = loadTelegramRuntime();
  const approvers = parseTelegramDefaultApprovers();
  if (!runtime.defaultApproversConfigured || approvers.length === 0) {
    await reply(context, "Telegram treasury bootstrap is missing default approvers. Set CLAW_TREASURY_TELEGRAM_DEFAULT_APPROVERS first.");
    return;
  }

  const defaults = resolveTelegramDefaultTreasuryConfig();
  try {
    const aliasSnapshot = await inspectWdkAlias(defaults.wdkKeyAlias);
    const room = await createTreasuryRoom({
      name: buildTelegramRoomName(context.message),
      channel: resolveTelegramChannel(context.message),
      channelLabel: buildTelegramChannelLabel(context.message),
      routeCommand: defaults.routeCommand,
      sessionKey: context.sessionKey,
      walletAddress: aliasSnapshot.walletAddress,
      network: defaults.network,
      assetSymbol: defaults.assetSymbol,
      assetAddress: aliasSnapshot.assetAddress || defaults.assetAddress,
      balance: aliasSnapshot.balance || "0.00",
      gasReserve: aliasSnapshot.gasReserve,
      quorum: Math.min(defaults.quorum, approvers.length),
      dailyLimit: defaults.dailyLimit,
      wdkKeyAlias: defaults.wdkKeyAlias,
      agentMode: defaults.agentMode,
      notes: `Provisioned from Telegram by ${formatTelegramActor(context.message)}.`,
      approvers,
    });

    await reply(
      context,
      [
        "Treasury room provisioned.",
        summarizeRoom(room, {
          walletAddress: aliasSnapshot.walletAddress,
          balance: aliasSnapshot.balance || room.balance,
          gasReserve: aliasSnapshot.gasReserve,
        }),
      ].join("\n\n"),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not provision treasury room.";
    await reply(context, `Treasury bootstrap failed.\n${message}`);
  }
}

async function handleShowTreasury(context: TelegramContext, room: TreasuryRoom | null): Promise<void> {
  if (!room) {
    await reply(context, "No treasury room is bound to this thread yet. Send 'create treasury' first.");
    return;
  }

  const live = await resolveLiveRoomSnapshot(room);
  await reply(context, summarizeRoom(room, live));
}

async function handleHistory(context: TelegramContext, room: TreasuryRoom | null): Promise<void> {
  if (!room) {
    await reply(context, "No treasury room is bound to this thread yet. Send 'create treasury' first.");
    return;
  }

  await reply(context, summarizeHistory(room));
}

async function handleAllowlist(context: TelegramContext, room: TreasuryRoom | null): Promise<void> {
  if (!room) {
    await reply(context, "No treasury room is bound to this thread yet. Send 'create treasury' first.");
    return;
  }

  await reply(context, summarizeAllowlistBoard(room));
}

function requirePolicyActor(room: TreasuryRoom | null, context: TelegramContext): TreasuryApprover | null {
  if (!room) {
    return null;
  }

  return matchTelegramApprover(room.approvers, context.message);
}

async function handleSetApprovers(
  context: TelegramContext,
  room: TreasuryRoom | null,
  input: Extract<ParsedCommand, { kind: "set-approvers" }>,
): Promise<void> {
  if (!room) {
    await reply(context, "No treasury room is bound to this thread yet. Send 'create treasury' first.");
    return;
  }

  const actor = requirePolicyActor(room, context);
  if (!actor) {
    await reply(context, "Only an existing approver can change the treasury policy.");
    return;
  }

  const nextApprovers = input.handles.map((handle, index) => {
    const clean = handle.replace(/^@+/, "");
    return {
      id: `approver_${index + 1}_${clean.toLowerCase()}`,
      name: clean,
      role: clean.toLowerCase() === actor.handle.replace(/^@+/, "").toLowerCase() ? actor.role : "approver",
      handle: `@${clean}`,
    } satisfies TreasuryApprover;
  });

  try {
    const updatedRoom = await updateTreasuryRoomControl({
      roomId: room.id,
      approvers: nextApprovers,
      quorum: Math.min(room.quorum, nextApprovers.length),
      notes: `${room.notes}\nUpdated approvers from Telegram by ${formatTelegramActor(context.message)}.`.trim(),
    });
    if (!updatedRoom) {
      throw new Error("policy_update_failed");
    }

    await reply(context, summarizePolicy(updatedRoom));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update approvers.";
    await reply(context, `Policy update failed.\n${message}`);
  }
}

async function handleSetQuorum(
  context: TelegramContext,
  room: TreasuryRoom | null,
  input: Extract<ParsedCommand, { kind: "set-quorum" }>,
): Promise<void> {
  if (!room) {
    await reply(context, "No treasury room is bound to this thread yet. Send 'create treasury' first.");
    return;
  }

  const actor = requirePolicyActor(room, context);
  if (!actor) {
    await reply(context, "Only an existing approver can change the treasury policy.");
    return;
  }

  try {
    const updatedRoom = await updateTreasuryRoomControl({
      roomId: room.id,
      quorum: input.quorum,
      notes: `${room.notes}\nUpdated quorum from Telegram by ${formatTelegramActor(context.message)}.`.trim(),
    });
    if (!updatedRoom) {
      throw new Error("policy_update_failed");
    }

    await reply(context, summarizePolicy(updatedRoom));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update quorum.";
    await reply(context, `Policy update failed.\n${message}`);
  }
}

async function handleSetDailyLimit(
  context: TelegramContext,
  room: TreasuryRoom | null,
  input: Extract<ParsedCommand, { kind: "set-daily-limit" }>,
): Promise<void> {
  if (!room) {
    await reply(context, "No treasury room is bound to this thread yet. Send 'create treasury' first.");
    return;
  }

  const actor = requirePolicyActor(room, context);
  if (!actor) {
    await reply(context, "Only an existing approver can change the treasury policy.");
    return;
  }

  try {
    const updatedRoom = await updateTreasuryRoomControl({
      roomId: room.id,
      dailyLimit: input.dailyLimit,
      notes: `${room.notes}\nUpdated daily limit from Telegram by ${formatTelegramActor(context.message)}.`.trim(),
    });
    if (!updatedRoom) {
      throw new Error("policy_update_failed");
    }

    await reply(context, summarizePolicy(updatedRoom));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update the daily limit.";
    await reply(context, `Policy update failed.\n${message}`);
  }
}

async function handleAllowRecipient(
  context: TelegramContext,
  room: TreasuryRoom | null,
  input: Extract<ParsedCommand, { kind: "allow-recipient" }>,
): Promise<void> {
  if (!room) {
    await reply(context, "No treasury room is bound to this thread yet. Send 'create treasury' first.");
    return;
  }

  const actor = requirePolicyActor(room, context);
  if (!actor) {
    await reply(context, "Only an existing approver can change the treasury policy.");
    return;
  }

  const nextAllowedRecipients = [
    ...room.allowedRecipients.filter((entry) => entry.address.toLowerCase() !== input.address.toLowerCase()),
    {
      address: input.address,
      label: input.label || input.address.slice(0, 6) + "..." + input.address.slice(-4),
    },
  ];

  try {
    const updatedRoom = await updateTreasuryRoomControl({
      roomId: room.id,
      allowedRecipients: nextAllowedRecipients,
      notes: `${room.notes}\nUpdated allowlist from Telegram by ${formatTelegramActor(context.message)}.`.trim(),
    });
    if (!updatedRoom) {
      throw new Error("policy_update_failed");
    }

    await reply(context, summarizeAllowlistBoard(updatedRoom));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update the allowlist.";
    await reply(context, `Policy update failed.\n${message}`);
  }
}

async function handleRemoveRecipient(
  context: TelegramContext,
  room: TreasuryRoom | null,
  input: Extract<ParsedCommand, { kind: "remove-recipient" }>,
): Promise<void> {
  if (!room) {
    await reply(context, "No treasury room is bound to this thread yet. Send 'create treasury' first.");
    return;
  }

  const actor = requirePolicyActor(room, context);
  if (!actor) {
    await reply(context, "Only an existing approver can change the treasury policy.");
    return;
  }

  const nextAllowedRecipients = room.allowedRecipients.filter((entry) => entry.address.toLowerCase() !== input.address.toLowerCase());
  if (nextAllowedRecipients.length === room.allowedRecipients.length) {
    await reply(context, `Recipient ${input.address} is not on the allowlist.`);
    return;
  }

  try {
    const updatedRoom = await updateTreasuryRoomControl({
      roomId: room.id,
      allowedRecipients: nextAllowedRecipients,
      notes: `${room.notes}\nRemoved allowlist entry from Telegram by ${formatTelegramActor(context.message)}.`.trim(),
    });
    if (!updatedRoom) {
      throw new Error("policy_update_failed");
    }

    await reply(context, summarizeAllowlistBoard(updatedRoom));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update the allowlist.";
    await reply(context, `Policy update failed.\n${message}`);
  }
}

async function handlePay(
  context: TelegramContext,
  room: TreasuryRoom | null,
  input: Extract<ParsedCommand, { kind: "pay" }>,
): Promise<void> {
  if (!room) {
    await reply(context, "No treasury room is bound to this thread yet. Send 'create treasury' first.");
    return;
  }

  if (!EVM_ADDRESS_PATTERN.test(input.recipient)) {
    await reply(context, "Recipient must be a valid EVM address.");
    return;
  }

  const live = await resolveLiveRoomSnapshot(room);
  if (live && Number(live.balance) < Number(input.amount)) {
    await reply(
      context,
      `Insufficient ${room.assetSymbol}. Wallet ${live.walletAddress} has ${live.balance} ${room.assetSymbol}, which is below the requested ${input.amount}.`,
    );
    return;
  }

  try {
    const request = await createTreasuryRequest({
      roomId: room.id,
      requestedBy: formatTelegramActor(context.message),
      amount: input.amount,
      assetSymbol: room.assetSymbol,
      recipient: input.recipient,
      memo: input.memo,
    });

    if (!request) {
      await reply(context, "Treasury room not found while creating the spend request.");
      return;
    }

    const sent = await reply(context, summarizeRequest(request, room));
    await rememberTelegramMessageLink({
      chatId: context.chatId,
      messageId: sent.messageId,
      roomId: room.id,
      requestId: request.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create treasury request.";
    await reply(context, `Request blocked.\n${message}`);
  }
}

async function resolveRequestForDecision(
  context: TelegramContext,
  room: TreasuryRoom,
  reference: string | null,
): Promise<TreasurySpendRequest | null> {
  if (reference) {
    return findRequestByReference(room, reference);
  }

  const replyMessageId = context.message.reply_to_message?.message_id;
  if (replyMessageId) {
    const link = await findTelegramMessageLink(context.chatId, replyMessageId);
    if (link?.roomId === room.id) {
      return room.requests.find((entry) => entry.id === link.requestId) ?? null;
    }
  }

  const activeRequests = room.requests.filter((entry) => entry.status === "pending-approvals" || entry.status === "approved");
  if (activeRequests.length === 1) {
    return activeRequests[0];
  }

  return null;
}

async function attemptTelegramExecution(context: TelegramContext, room: TreasuryRoom, request: TreasurySpendRequest): Promise<void> {
  const operatorKey = getConfiguredTreasuryOperatorKey();
  if (!operatorKey || room.agentMode !== "execute-after-quorum") {
    await reply(context, `Request [${requestReference(request)}] is approved. Execute it from the dashboard to anchor the on-chain receipt.`);
    return;
  }

  try {
    const result = await executeTreasuryRequestWithWdk({
      room,
      request,
      operatorKey,
    });

    const stored = await recordTreasuryExecution({
      roomId: room.id,
      requestId: request.id,
      executedBy: "Claw + WDK",
      txHash: result.txHash,
      explorerUrl: result.explorerUrl,
      mode: "wdk-transfer",
      feeWei: result.feeWei,
      quoteFeeWei: result.quoteFeeWei,
      wdkAccountAddress: result.walletAddress,
      nextBalance: result.balance,
      nextGasReserve: result.gasReserve,
    });

    if (!stored?.execution) {
      await reply(context, `WDK execution completed for [${requestReference(request)}], but the receipt could not be stored.`);
      return;
    }

    await reply(
      context,
      [
        `WDK receipt for [${requestReference(stored)}]`,
        `Tx: ${stored.execution.txHash}`,
        `Explorer: ${stored.execution.explorerUrl}`,
        `Executed by: ${stored.execution.executedBy}`,
        `Updated ${room.assetSymbol} balance: ${result.balance}`,
        `Native gas: ${result.gasReserve}`,
      ].join("\n"),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "WDK execution failed.";
    await reply(context, `WDK execution failed for [${requestReference(request)}].\n${message}`);
  }
}

async function handleDecision(
  context: TelegramContext,
  room: TreasuryRoom | null,
  input: Extract<ParsedCommand, { kind: "approve" | "reject" }>,
): Promise<void> {
  if (!room) {
    await reply(context, "No treasury room is bound to this thread yet. Send 'create treasury' first.");
    return;
  }

  const approver = matchTelegramApprover(room.approvers, context.message);
  if (!approver) {
    await reply(context, "You are not listed as an approver for this treasury room.");
    return;
  }

  const request = await resolveRequestForDecision(context, room, input.reference);
  if (!request) {
    await reply(context, "Could not resolve the request. Reply directly to the request message or specify its short ref, for example: approve ab12cd");
    return;
  }

  const updated = await recordTreasuryApproval({
    roomId: room.id,
    requestId: request.id,
    approverId: approver.id,
    decision: input.kind === "approve" ? "approved" : "rejected",
    note: input.note,
  });

  if (!updated) {
    await reply(context, `Could not record ${input.kind} for [${requestReference(request)}].`);
    return;
  }

  await reply(context, summarizeApproval(updated, room));

  if (updated.status === "approved" && input.kind === "approve") {
    const refreshedRoom = await getRoomForContext(context);
    if (refreshedRoom) {
      const refreshedRequest = refreshedRoom.requests.find((entry) => entry.id === updated.id);
      if (refreshedRequest) {
        await attemptTelegramExecution(context, refreshedRoom, refreshedRequest);
      }
    }
  }
}

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<{ handled: boolean }> {
  const message = extractMessage(update);
  if (!message?.text?.trim()) {
    return { handled: false };
  }

  if (await hasProcessedTelegramUpdate(update.update_id)) {
    return { handled: true };
  }

  const command = parseTelegramCommand(message.text);
  if (!command) {
    return { handled: false };
  }

  await rememberProcessedTelegramUpdate(update.update_id);

  const context: TelegramContext = {
    message,
    chatId: String(message.chat.id),
    threadId: message.message_thread_id,
    sessionKey: buildTelegramSessionKey(message),
  };
  const room = await getRoomForContext(context);

  if (command.kind === "invalid") {
    await reply(context, command.message);
    return { handled: true };
  }

  if (command.kind === "help") {
    await reply(context, commandHelp());
    return { handled: true };
  }

  if (command.kind === "create-treasury") {
    await handleCreateTreasury(context, room);
    return { handled: true };
  }

  if (command.kind === "show-treasury") {
    await handleShowTreasury(context, room);
    return { handled: true };
  }

  if (command.kind === "history") {
    await handleHistory(context, room);
    return { handled: true };
  }

  if (command.kind === "allowlist") {
    await handleAllowlist(context, room);
    return { handled: true };
  }

  if (command.kind === "set-approvers") {
    await handleSetApprovers(context, room, command);
    return { handled: true };
  }

  if (command.kind === "set-quorum") {
    await handleSetQuorum(context, room, command);
    return { handled: true };
  }

  if (command.kind === "set-daily-limit") {
    await handleSetDailyLimit(context, room, command);
    return { handled: true };
  }

  if (command.kind === "allow-recipient") {
    await handleAllowRecipient(context, room, command);
    return { handled: true };
  }

  if (command.kind === "remove-recipient") {
    await handleRemoveRecipient(context, room, command);
    return { handled: true };
  }

  if (command.kind === "pay") {
    await handlePay(context, room, command);
    return { handled: true };
  }

  await handleDecision(context, room, command);
  return { handled: true };
}
