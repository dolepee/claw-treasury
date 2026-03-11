import { NextRequest, NextResponse } from "next/server";
import { recordTreasuryApproval } from "@/lib/treasury";
import { TreasuryApprovalDecision } from "@/lib/types";

type Body = {
  roomId?: string;
  requestId?: string;
  approverId?: string;
  decision?: TreasuryApprovalDecision;
  note?: string;
};

function isDecision(value: string | undefined): value is TreasuryApprovalDecision {
  return value === "approved" || value === "rejected";
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Body;
  if (!body.roomId?.trim() || !body.requestId?.trim() || !body.approverId?.trim() || !isDecision(body.decision)) {
    return NextResponse.json({ ok: false, error: "roomId, requestId, approverId, and decision are required" }, { status: 400 });
  }

  const requestEntry = await recordTreasuryApproval({
    roomId: body.roomId.trim(),
    requestId: body.requestId.trim(),
    approverId: body.approverId.trim(),
    decision: body.decision,
    note: body.note?.trim() || "",
  });

  if (!requestEntry) {
    return NextResponse.json({ ok: false, error: "room, approver, or request not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, request: requestEntry });
}
