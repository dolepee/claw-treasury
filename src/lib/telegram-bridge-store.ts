import path from "node:path";
import { get, put } from "@vercel/blob";
import { readJsonFile, writeJsonFile } from "@/lib/fs-utils";
import { getDataDir } from "@/lib/paths";

type TelegramMessageLink = {
  chatId: string;
  messageId: number;
  roomId: string;
  requestId: string;
  createdAt: string;
};

type TelegramBridgeStore = {
  processedUpdateIds: number[];
  messageLinks: TelegramMessageLink[];
};

const telegramBridgeFile = path.join(getDataDir(), "telegram-bridge.json");
const telegramBridgeBlobPath = "stores/telegram-bridge.json";
const emptyStore: TelegramBridgeStore = {
  processedUpdateIds: [],
  messageLinks: [],
};

function shouldUseBlobStore(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function normalizeStore(store: TelegramBridgeStore): TelegramBridgeStore {
  return {
    processedUpdateIds: [...store.processedUpdateIds].slice(-300),
    messageLinks: [...store.messageLinks].slice(-200),
  };
}

async function loadStore(): Promise<TelegramBridgeStore> {
  if (shouldUseBlobStore()) {
    try {
      const result = await get(telegramBridgeBlobPath, { access: "private", useCache: false });
      if (!result) {
        return emptyStore;
      }
      const raw = await new Response(result.stream).text();
      return normalizeStore(JSON.parse(raw) as TelegramBridgeStore);
    } catch {
      return emptyStore;
    }
  }

  return normalizeStore(await readJsonFile<TelegramBridgeStore>(telegramBridgeFile, emptyStore));
}

async function saveStore(store: TelegramBridgeStore): Promise<void> {
  const normalized = normalizeStore(store);

  if (shouldUseBlobStore()) {
    await put(telegramBridgeBlobPath, `${JSON.stringify(normalized, null, 2)}\n`, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return;
  }

  await writeJsonFile(telegramBridgeFile, normalized);
}

export async function hasProcessedTelegramUpdate(updateId: number): Promise<boolean> {
  const store = await loadStore();
  return store.processedUpdateIds.includes(updateId);
}

export async function rememberProcessedTelegramUpdate(updateId: number): Promise<void> {
  const store = await loadStore();
  if (!store.processedUpdateIds.includes(updateId)) {
    store.processedUpdateIds.push(updateId);
    await saveStore(store);
  }
}

export async function rememberTelegramMessageLink(link: {
  chatId: string;
  messageId: number;
  roomId: string;
  requestId: string;
}): Promise<void> {
  const store = await loadStore();
  const now = new Date().toISOString();
  const filtered = store.messageLinks.filter(
    (entry) => !(entry.chatId === link.chatId && entry.messageId === link.messageId),
  );
  filtered.push({
    chatId: link.chatId,
    messageId: link.messageId,
    roomId: link.roomId,
    requestId: link.requestId,
    createdAt: now,
  });
  store.messageLinks = filtered;
  await saveStore(store);
}

export async function findTelegramMessageLink(
  chatId: string,
  messageId: number,
): Promise<TelegramMessageLink | null> {
  const store = await loadStore();
  return store.messageLinks.find((entry) => entry.chatId === chatId && entry.messageId === messageId) ?? null;
}
