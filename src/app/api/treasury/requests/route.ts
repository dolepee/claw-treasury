import { NextRequest, NextResponse } from "next/server";
import { createTreasuryRequest } from "@/lib/treasury";

type Body = {
  roomId?: string;
  requestedBy?: string;
  amount?: string;
  assetSymbol?: string;
  recipient?: string;
  memo?: string;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Body;
  if (!body.roomId?.trim() || !body.requestedBy?.trim() || !body.amount?.trim() || !body.recipient?.trim() || !body.memo?.trim()) {
    return NextResponse.json({ ok: false, error: "roomId, requestedBy, amount, recipient, and memo are required" }, { status: 400 });
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ ok: false, error: "amount must be positive" }, { status: 400 });
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(body.recipient.trim())) {
    return NextResponse.json({ ok: false, error: "recipient must be a valid EVM address" }, { status: 400 });
  }

  try {
    const requestEntry = await createTreasuryRequest({
      roomId: body.roomId.trim(),
      requestedBy: body.requestedBy.trim(),
      amount: amount.toFixed(2),
      assetSymbol: body.assetSymbol?.trim() || "USDT",
      recipient: body.recipient.trim(),
      memo: body.memo.trim(),
    });

    if (!requestEntry) {
      return NextResponse.json({ ok: false, error: "room not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, request: requestEntry });
  } catch (error) {
    const message = error instanceof Error ? error.message : "request_create_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
