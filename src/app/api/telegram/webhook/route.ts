import { NextRequest, NextResponse } from "next/server";
import { loadTelegramRuntime, TelegramUpdate, verifyTelegramWebhookSecret } from "@/lib/telegram";
import { handleTelegramUpdate } from "@/lib/treasury-telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const runtimeInfo = loadTelegramRuntime();
  return NextResponse.json({
    ok: true,
    telegram: runtimeInfo,
    commands: [
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
      "approve <ref>",
      "reject <ref>",
    ],
  });
}

export async function POST(request: NextRequest) {
  if (!verifyTelegramWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ ok: false, error: "telegram_webhook_secret_invalid" }, { status: 401 });
  }

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
