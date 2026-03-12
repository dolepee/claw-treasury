import { NextRequest, NextResponse } from "next/server";
import { loadTreasuryRoom } from "@/lib/treasury";
import { buildTreasuryAnalytics } from "@/lib/treasury-analytics";
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

function percentage(value: number): string {
  return `${value.toFixed(1)}%`;
}

function markdownEscape(value: string): string {
  return value.replaceAll("|", "\\|");
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

function roomToMarkdown(room: TreasuryRoom): string {
  const summary = buildSummary(room);
  const analytics = buildTreasuryAnalytics(room);
  const requestRows = room.requests.length
    ? room.requests
        .map((request) => {
          const approvals = request.approvals
            .map((entry) => `${entry.approverName}:${entry.decision}`)
            .join(", ");

          return `| ${request.id.replace(/^req_/, "").slice(0, 8)} | ${request.status} | ${request.amount} ${request.assetSymbol} | ${markdownEscape(request.recipient)} | ${markdownEscape(request.requestedBy)} | ${approvals || "none"} | ${request.execution?.txHash ?? ""} |`;
        })
        .join("\n")
    : "| none | - | - | - | - | - | - |";

  const approverRows = analytics.topApprovers.length
    ? analytics.topApprovers
        .map(
          (entry) =>
            `| ${markdownEscape(entry.approverName)} | ${markdownEscape(entry.handle)} | ${entry.approvedCount} | ${entry.rejectedCount} | ${entry.totalCount} | ${entry.lastActionAt ?? ""} |`,
        )
        .join("\n")
    : "| none | - | 0 | 0 | 0 | - |";

  const allowlistRows = room.allowedRecipients.length
    ? room.allowedRecipients.map((entry) => `- \`${entry.address}\` ${entry.label ? `(${entry.label})` : ""}`).join("\n")
    : "- Open policy";

  return [
    `# ClawTreasury Audit Brief`,
    ``,
    `Exported: ${new Date().toISOString()}`,
    `Room: ${room.name} (\`${room.id}\`)`,
    `Network: ${room.network}`,
    `Session: \`${room.sessionKey}\``,
    `Signer: \`${room.wdkKeyAlias} #${room.wdkAccountIndex}\``,
    `Wallet: \`${room.walletAddress}\``,
    ``,
    `## Summary`,
    `- Requests: ${summary.requestCount}`,
    `- Pending approvals: ${summary.pendingApprovals}`,
    `- Approved: ${summary.approved}`,
    `- Rejected: ${summary.rejected}`,
    `- Executed: ${summary.executed}`,
    `- Settled volume: ${summary.settledVolume} ${room.assetSymbol}`,
    `- Approvers: ${summary.approverCount}`,
    `- Allowlist size: ${summary.allowlistCount}`,
    ``,
    `## Analytics`,
    `- Total requested volume: ${analytics.totalRequestedVolume} ${room.assetSymbol}`,
    `- Average request size: ${analytics.avgRequestAmount} ${room.assetSymbol}`,
    `- Quorum clear rate: ${percentage(analytics.quorumClearRate)}`,
    `- Execution rate: ${percentage(analytics.executionRate)}`,
    `- Average approval lag: ${analytics.avgApprovalLagMinutes === null ? "n/a" : `${analytics.avgApprovalLagMinutes.toFixed(1)} min`}`,
    `- Average execution lag: ${analytics.avgExecutionLagMinutes === null ? "n/a" : `${analytics.avgExecutionLagMinutes.toFixed(1)} min`}`,
    `- Wallet rotations recorded: ${analytics.walletRotationCount}`,
    `- Unique recipients: ${analytics.uniqueRecipientCount}`,
    `- Recipient coverage: ${percentage(analytics.recipientCoverageRate)}`,
    `- Total fee tracked: ${analytics.totalFeeWei} wei`,
    `- Total fee quoted: ${analytics.totalQuotedFeeWei} wei`,
    `- Last execution: ${analytics.lastExecutedAt ?? "n/a"}`,
    ``,
    `## Policy`,
    `- Agent mode: ${room.agentMode}`,
    `- Quorum: ${room.quorum}/${room.approvers.length}`,
    `- Daily limit: ${room.dailyLimit} ${room.assetSymbol}`,
    `- Gas reserve: ${room.gasReserve}`,
    `- Allowlist`,
    allowlistRows,
    ``,
    `## Approver Activity`,
    `| Approver | Handle | Approved | Rejected | Total | Last Action |`,
    `| --- | --- | ---: | ---: | ---: | --- |`,
    approverRows,
    ``,
    `## Request Audit`,
    `| Ref | Status | Amount | Recipient | Requested By | Approvals | Tx Hash |`,
    `| --- | --- | --- | --- | --- | --- | --- |`,
    requestRows,
  ].join("\n");
}

export async function GET(request: NextRequest) {
  const roomId = request.nextUrl.searchParams.get("roomId")?.trim();
  const format = request.nextUrl.searchParams.get("format")?.trim().toLowerCase() || "json";

  if (!roomId) {
    return NextResponse.json({ ok: false, error: "roomId is required" }, { status: 400 });
  }

  if (format !== "json" && format !== "csv" && format !== "md") {
    return NextResponse.json({ ok: false, error: "format must be json, csv, or md" }, { status: 400 });
  }

  const room = await loadTreasuryRoom(roomId);
  if (!room) {
    return NextResponse.json({ ok: false, error: "room not found" }, { status: 404 });
  }

  const filenameBase = `${room.slug || room.id}-audit-${exportTimestamp()}`;
  const analytics = buildTreasuryAnalytics(room);

  if (format === "csv") {
    return new NextResponse(roomToCsv(room), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filenameBase}.csv"`,
        "cache-control": "no-store",
      },
    });
  }

  if (format === "md") {
    return new NextResponse(roomToMarkdown(room), {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${filenameBase}.md"`,
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
      analytics,
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
