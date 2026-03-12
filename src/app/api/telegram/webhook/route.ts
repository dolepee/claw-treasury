import { NextRequest, NextResponse } from "next/server";
import { getTelegramTreasuryCommands, loadTelegramRuntime, syncTelegramTreasuryCommands, TelegramUpdate, verifyTelegramWebhookSecret } from "@/lib/telegram";
import { handleTelegramUpdate } from "@/lib/treasury-telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const runtimeInfo = loadTelegramRuntime();
  let commandsRegistered = false;
  let commandsError: string | null = null;

  if (runtimeInfo.configured) {
    try {
      commandsRegistered = await syncTelegramTreasuryCommands();
    } catch (error) {
      commandsError = error instanceof Error ? error.message : "telegram_command_sync_failed";
    }
  }

  return NextResponse.json({
    ok: true,
    telegram: runtimeInfo,
    commandsRegistered,
    commandsError,
    commands: getTelegramTreasuryCommands(),
  });
}

export async function POST(request: NextRequest) {
  if (!verifyTelegramWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ ok: false, error: "telegram_webhook_secret_invalid" }, { status: 401 });
  }

  void syncTelegramTreasuryCommands().catch(() => null);

  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;
  if (!update) {
    return NextResponse.json({ ok: false, error: "telegram_update_invalid" }, { status: 400 });
  }

  try {
    const result = await handleTelegramUpdate(update);
    return NextResponse.json({ ok: true, handled: result.handled });
  } catch (error) {
    const message = error instanceof Error ? error.message : "telegram_webhook_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
