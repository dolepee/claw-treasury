import { NextRequest, NextResponse } from "next/server";
import { recordTreasuryExecution } from "@/lib/treasury";

type Body = {
  roomId?: string;
  requestId?: string;
  executedBy?: string;
  txHash?: string;
  explorerUrl?: string;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Body;
  if (!body.roomId?.trim() || !body.requestId?.trim() || !body.executedBy?.trim() || !body.txHash?.trim()) {
    return NextResponse.json({ ok: false, error: "roomId, requestId, executedBy, and txHash are required" }, { status: 400 });
  }

  const hash = body.txHash.trim();
  const explorerUrl = body.explorerUrl?.trim() || `https://plasmascan.to/tx/${hash}`;

  const requestEntry = await recordTreasuryExecution({
    roomId: body.roomId.trim(),
    requestId: body.requestId.trim(),
    executedBy: body.executedBy.trim(),
    txHash: hash,
    explorerUrl,
    mode: "manual-receipt",
  });

  if (!requestEntry) {
    return NextResponse.json({ ok: false, error: "request not found or not ready for execution" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, request: requestEntry });
}
