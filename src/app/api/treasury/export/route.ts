import { NextRequest, NextResponse } from "next/server";
import { loadTreasuryRoom } from "@/lib/treasury";
import { TreasuryRoom } from "@/lib/types";

function exportTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function buildSummary(room: TreasuryRoom) {
  const pendingApprovals = room.requests.filter((entry) => entry.status === "pending-approvals").length;
  const approved = room.requests.filter((entry) => entry.status === "approved").length;
  const rejected = room.requests.filter((entry) => entry.status === "rejected").length;
  const executed = room.requests.filter((entry) => entry.status === "executed").length;
  const settledVolume = room.requests.reduce((sum, entry) => {
    if (entry.status === "executed") {
      return sum + Number(entry.amount);
    }
    return sum;
  }, 0);

  return {
    requestCount: room.requests.length,
    pendingApprovals,
    approved,
    rejected,
    executed,
    settledVolume: settledVolume.toFixed(2),
    approverCount: room.approvers.length,
    allowlistCount: room.allowedRecipients.length,
  };
}

function quoteCsv(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function roomToCsv(room: TreasuryRoom): string {
  const header = [
    "room_name",
    "room_id",
    "request_id",
    "status",
    "created_at",
    "updated_at",
    "requested_by",
    "amount",
    "asset_symbol",
    "recipient",
    "memo",
    "quorum",
    "approvals_approved",
    "approvals_rejected",
    "approval_summary",
    "execution_mode",
    "executed_by",
    "executed_at",
    "tx_hash",
    "explorer_url",
    "fee_wei",
    "quote_fee_wei",
    "wdk_account_address",
  ];

  const rows = room.requests.map((request) => {
    const approvedCount = request.approvals.filter((entry) => entry.decision === "approved").length;
    const rejectedCount = request.approvals.filter((entry) => entry.decision === "rejected").length;
    const approvalSummary = request.approvals
      .map((entry) => `${entry.approverName}:${entry.decision}${entry.note ? ` (${entry.note})` : ""}`)
      .join(" | ");

    return [
      room.name,
      room.id,
      request.id,
      request.status,
      request.createdAt,
      request.updatedAt,
      request.requestedBy,
      request.amount,
      request.assetSymbol,
      request.recipient,
      request.memo,
      `${room.quorum}/${room.approvers.length}`,
      String(approvedCount),
      String(rejectedCount),
      approvalSummary,
      request.execution?.mode ?? "",
      request.execution?.executedBy ?? "",
      request.execution?.executedAt ?? "",
      request.execution?.txHash ?? "",
      request.execution?.explorerUrl ?? "",
      request.execution?.feeWei ?? "",
      request.execution?.quoteFeeWei ?? "",
      request.execution?.wdkAccountAddress ?? "",
    ].map((value) => quoteCsv(String(value)));
  });

  return [header.join(","), ...rows.map((row) => row.join(","))].join("\n");
}

export async function GET(request: NextRequest) {
  const roomId = request.nextUrl.searchParams.get("roomId")?.trim();
  const format = request.nextUrl.searchParams.get("format")?.trim().toLowerCase() || "json";

  if (!roomId) {
    return NextResponse.json({ ok: false, error: "roomId is required" }, { status: 400 });
  }

  if (format !== "json" && format !== "csv") {
    return NextResponse.json({ ok: false, error: "format must be json or csv" }, { status: 400 });
  }

  const room = await loadTreasuryRoom(roomId);
  if (!room) {
    return NextResponse.json({ ok: false, error: "room not found" }, { status: 404 });
  }

  const filenameBase = `${room.slug || room.id}-audit-${exportTimestamp()}`;

  if (format === "csv") {
    return new NextResponse(roomToCsv(room), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filenameBase}.csv"`,
        "cache-control": "no-store",
      },
    });
  }

  return NextResponse.json(
    {
      ok: true,
      exportedAt: new Date().toISOString(),
      roomId: room.id,
      roomSlug: room.slug,
      summary: buildSummary(room),
      room,
    },
    {
      headers: {
        "content-disposition": `attachment; filename="${filenameBase}.json"`,
        "cache-control": "no-store",
      },
    },
  );
}
