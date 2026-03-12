import { TreasuryAgentMode, TreasuryApprover, TreasuryChannel } from "@/lib/types";

export type TelegramChat = {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export type TelegramUser = {
  id: number;
  username?: string;
  first_name: string;
  last_name?: string;
};

export type TelegramMessage = {
  message_id: number;
  text?: string;
  chat: TelegramChat;
  from?: TelegramUser;
  message_thread_id?: number;
  reply_to_message?: {
    message_id: number;
    text?: string;
  };
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
};

type SendTelegramMessageInput = {
  chatId: string;
  threadId?: number;
  text: string;
  replyToMessageId?: number;
};

export type TelegramRuntime = {
  configured: boolean;
  webhookSecretConfigured: boolean;
  defaultApproversConfigured: boolean;
  defaultWdkAlias: string | null;
};

type TelegramCreateTreasuryDefaults = {
  routeCommand: string;
  network: string;
  assetSymbol: string;
  assetAddress: string;
  dailyLimit: string;
  quorum: number;
  agentMode: TreasuryAgentMode;
  wdkKeyAlias: string;
};

function getBotToken(): string | null {
  return process.env.CLAW_TREASURY_TELEGRAM_BOT_TOKEN?.trim() || null;
}

function getWebhookSecret(): string | null {
  return process.env.CLAW_TREASURY_TELEGRAM_WEBHOOK_SECRET?.trim() || null;
}

function normalizeHandle(value: string | undefined): string {
  return value?.trim().replace(/^@+/, "").toLowerCase() || "";
}

function userDisplayName(user: TelegramUser | undefined): string {
  if (!user) {
    return "Unknown operator";
  }

  const full = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return full || user.username || `user-${user.id}`;
}

function normalizeChatName(chat: TelegramChat): string {
  if (chat.title?.trim()) {
    return chat.title.trim();
  }
  if (chat.username?.trim()) {
    return `@${chat.username.trim()}`;
  }
  return [chat.first_name, chat.last_name].filter(Boolean).join(" ").trim() || `chat-${chat.id}`;
}

export function loadTelegramRuntime(): TelegramRuntime {
  return {
    configured: Boolean(getBotToken()),
    webhookSecretConfigured: Boolean(getWebhookSecret()),
    defaultApproversConfigured: parseTelegramDefaultApprovers().length > 0,
    defaultWdkAlias: process.env.CLAW_TREASURY_TELEGRAM_DEFAULT_WDK_ALIAS?.trim() || null,
  };
}

export function verifyTelegramWebhookSecret(headerValue: string | null): boolean {
  const secret = getWebhookSecret();
  if (!secret) {
    return true;
  }

  return headerValue?.trim() === secret;
}

export function buildTelegramSessionKey(message: TelegramMessage): string {
  const chatId = String(message.chat.id);
  const threadId = message.message_thread_id;
  if (threadId) {
    return `telegram:chat:${chatId}:topic:${threadId}`;
  }

  return `telegram:chat:${chatId}`;
}

export function resolveTelegramChannel(message: TelegramMessage): TreasuryChannel {
  if (message.chat.type === "private") {
    return "telegram-dm";
  }

  return "telegram-topic";
}

export function buildTelegramChannelLabel(message: TelegramMessage): string {
  const base = normalizeChatName(message.chat);
  if (message.message_thread_id) {
    return `${base} / topic ${message.message_thread_id}`;
  }

  return base;
}

export function buildTelegramRoomName(message: TelegramMessage): string {
  const base = normalizeChatName(message.chat);
  if (message.message_thread_id) {
    return `${base} Treasury #${message.message_thread_id}`;
  }

  if (message.chat.type === "private") {
    return `${base} Treasury`;
  }

  return `${base} Treasury`;
}

export function parseTelegramDefaultApprovers(): TreasuryApprover[] {
  const raw = process.env.CLAW_TREASURY_TELEGRAM_DEFAULT_APPROVERS?.trim();
  if (!raw) {
    return [];
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [name, role, handle] = line.split("|").map((part) => part?.trim() ?? "");
      const normalizedName = name || `Approver ${index + 1}`;
      const normalizedHandle = handle || normalizedName;
      return {
        id: `approver_${index + 1}_${normalizedName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "user"}`,
        name: normalizedName,
        role: role || "approver",
        handle: normalizedHandle.startsWith("@") ? normalizedHandle : `@${normalizedHandle.replace(/^@+/, "")}`,
      };
    });
}

export function resolveTelegramDefaultTreasuryConfig(): TelegramCreateTreasuryDefaults {
  const assetAddress = process.env.CLAW_TREASURY_TELEGRAM_DEFAULT_ASSET_ADDRESS?.trim()
    || process.env.CLAW_TREASURY_PLASMA_USDT_ADDRESS?.trim()
    || "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb";
  const wdkKeyAlias = process.env.CLAW_TREASURY_TELEGRAM_DEFAULT_WDK_ALIAS?.trim() || "wdk-plasma-main";
  const configuredQuorum = Number(process.env.CLAW_TREASURY_TELEGRAM_DEFAULT_QUORUM);
  const approverCount = parseTelegramDefaultApprovers().length;

  return {
    routeCommand: process.env.CLAW_TREASURY_TELEGRAM_DEFAULT_ROUTE_COMMAND?.trim() || "telegram-treasury",
    network: process.env.CLAW_TREASURY_TELEGRAM_DEFAULT_NETWORK?.trim() || "Plasma",
    assetSymbol: process.env.CLAW_TREASURY_TELEGRAM_DEFAULT_ASSET_SYMBOL?.trim() || "USD₮",
    assetAddress,
    dailyLimit: process.env.CLAW_TREASURY_TELEGRAM_DEFAULT_DAILY_LIMIT?.trim() || "150.00",
    quorum:
      Number.isFinite(configuredQuorum) && configuredQuorum >= 1
        ? Math.floor(configuredQuorum)
        : Math.min(Math.max(approverCount || 1, 1), 2),
    agentMode:
      process.env.CLAW_TREASURY_TELEGRAM_DEFAULT_AGENT_MODE?.trim() === "observe"
        ? "observe"
        : process.env.CLAW_TREASURY_TELEGRAM_DEFAULT_AGENT_MODE?.trim() === "propose"
          ? "propose"
          : "execute-after-quorum",
    wdkKeyAlias,
  };
}

export function matchTelegramApprover(
  approvers: TreasuryApprover[],
  message: TelegramMessage,
): TreasuryApprover | null {
  const username = normalizeHandle(message.from?.username);
  const senderName = userDisplayName(message.from).trim().toLowerCase();

  if (username) {
    const byHandle = approvers.find((entry) => normalizeHandle(entry.handle) === username);
    if (byHandle) {
      return byHandle;
    }
  }

  return approvers.find((entry) => entry.name.trim().toLowerCase() === senderName) ?? null;
}

export function formatTelegramActor(message: TelegramMessage): string {
  if (!message.from) {
    return "Unknown operator";
  }

  if (message.from.username?.trim()) {
    return `@${message.from.username.trim()}`;
  }

  return userDisplayName(message.from);
}

export async function sendTelegramMessage(input: SendTelegramMessageInput): Promise<{ messageId: number }> {
  const token = getBotToken();
  if (!token) {
    throw new Error("telegram_bot_token_missing");
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: input.chatId,
      message_thread_id: input.threadId,
      reply_to_message_id: input.replyToMessageId,
      text: input.text,
      disable_web_page_preview: true,
    }),
    cache: "no-store",
  });

  const body = (await response.json().catch(() => null)) as
    | { ok?: boolean; description?: string; result?: { message_id: number } }
    | null;

  if (!response.ok || !body?.ok || !body.result?.message_id) {
    throw new Error(body?.description || "telegram_send_failed");
  }

  return { messageId: body.result.message_id };
}
