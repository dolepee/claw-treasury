import { NextRequest, NextResponse } from "next/server";
import { loadTreasuryRoomRequest, recordTreasuryExecution } from "@/lib/treasury";
import { executeTreasuryRequestWithWdk } from "@/lib/wdk";

type Body = {
  roomId?: string;
  requestId?: string;
  operatorKey?: string;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Body;
  if (!body.roomId?.trim() || !body.requestId?.trim() || !body.operatorKey?.trim()) {
    return NextResponse.json({ ok: false, error: "roomId, requestId, and operatorKey are required" }, { status: 400 });
  }

  const current = await loadTreasuryRoomRequest(body.roomId.trim(), body.requestId.trim());
  if (!current) {
    return NextResponse.json({ ok: false, error: "room or request not found" }, { status: 404 });
  }

  try {
    const result = await executeTreasuryRequestWithWdk({
      room: current.room,
      request: current.request,
      operatorKey: body.operatorKey.trim(),
    });

    const stored = await recordTreasuryExecution({
      roomId: current.room.id,
      requestId: current.request.id,
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

    if (!stored) {
      return NextResponse.json({ ok: false, error: "request not found or not ready for execution" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, request: stored });
  } catch (error) {
    const message = error instanceof Error ? error.message : "wdk_execution_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
