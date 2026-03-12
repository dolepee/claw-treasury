import { TreasuryApproval, TreasuryApprover, TreasuryRoom, TreasurySpendRequest } from "@/lib/types";

export type TreasuryApproverActivity = {
  approverId: string;
  approverName: string;
  handle: string;
  approvedCount: number;
  rejectedCount: number;
  totalCount: number;
  lastActionAt: string | null;
};

export type TreasuryAnalytics = {
  requestCount: number;
  pendingApprovals: number;
  approved: number;
  rejected: number;
  executed: number;
  totalRequestedVolume: string;
  totalSettledVolume: string;
  avgRequestAmount: string;
  quorumClearRate: number;
  executionRate: number;
  avgApprovalLagMinutes: number | null;
  avgExecutionLagMinutes: number | null;
  walletRotationCount: number;
  uniqueRecipientCount: number;
  recipientCoverageRate: number;
  activeApproverCount: number;
  totalFeeWei: string;
  totalQuotedFeeWei: string;
  topApprovers: TreasuryApproverActivity[];
  lastExecutedAt: string | null;
  latestRequestAt: string | null;
};

function numeric(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeDate(value: string): number | null {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function minutesBetween(start: string, end: string): number | null {
  const startTime = safeDate(start);
  const endTime = safeDate(end);
  if (startTime === null || endTime === null || endTime < startTime) {
    return null;
  }
  return (endTime - startTime) / 60000;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function findQuorumApprovalTimestamp(request: TreasurySpendRequest, quorum: number): string | null {
  const approvals = request.approvals
    .filter((entry) => entry.decision === "approved")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (approvals.length < quorum) {
    return null;
  }

  return approvals[quorum - 1]?.createdAt ?? null;
}

function buildApproverActivity(approvers: TreasuryApprover[], requests: TreasurySpendRequest[]): TreasuryApproverActivity[] {
  const activityMap = new Map<string, TreasuryApproverActivity>();

  for (const approver of approvers) {
    activityMap.set(approver.id, {
      approverId: approver.id,
      approverName: approver.name,
      handle: approver.handle,
      approvedCount: 0,
      rejectedCount: 0,
      totalCount: 0,
      lastActionAt: null,
    });
  }

  for (const request of requests) {
    for (const approval of request.approvals) {
      const current = activityMap.get(approval.approverId) ?? {
        approverId: approval.approverId,
        approverName: approval.approverName,
        handle: approval.approverName,
        approvedCount: 0,
        rejectedCount: 0,
        totalCount: 0,
        lastActionAt: null,
      };

      const next = applyApprovalToActivity(current, approval);
      activityMap.set(approval.approverId, next);
    }
  }

  return Array.from(activityMap.values()).sort((left, right) => {
    if (right.totalCount !== left.totalCount) {
      return right.totalCount - left.totalCount;
    }
    const rightTime = right.lastActionAt ? safeDate(right.lastActionAt) ?? 0 : 0;
    const leftTime = left.lastActionAt ? safeDate(left.lastActionAt) ?? 0 : 0;
    return rightTime - leftTime;
  });
}

function applyApprovalToActivity(activity: TreasuryApproverActivity, approval: TreasuryApproval): TreasuryApproverActivity {
  const approvedCount = activity.approvedCount + (approval.decision === "approved" ? 1 : 0);
  const rejectedCount = activity.rejectedCount + (approval.decision === "rejected" ? 1 : 0);
  return {
    ...activity,
    approvedCount,
    rejectedCount,
    totalCount: activity.totalCount + 1,
    lastActionAt:
      !activity.lastActionAt || approval.createdAt > activity.lastActionAt
        ? approval.createdAt
        : activity.lastActionAt,
  };
}

export function buildTreasuryAnalytics(room: TreasuryRoom): TreasuryAnalytics {
  const requestCount = room.requests.length;
  const pendingApprovals = room.requests.filter((entry) => entry.status === "pending-approvals").length;
  const approved = room.requests.filter((entry) => entry.status === "approved").length;
  const rejected = room.requests.filter((entry) => entry.status === "rejected").length;
  const executed = room.requests.filter((entry) => entry.status === "executed").length;

  const totalRequestedVolume = room.requests.reduce((sum, entry) => sum + numeric(entry.amount), 0);
  const totalSettledVolume = room.requests.reduce((sum, entry) => {
    if (entry.status === "executed") {
      return sum + numeric(entry.amount);
    }
    return sum;
  }, 0);

  const approvalLagSamples = room.requests
    .map((request) => {
      const quorumAt = findQuorumApprovalTimestamp(request, room.quorum);
      return quorumAt ? minutesBetween(request.createdAt, quorumAt) : null;
    })
    .filter((value): value is number => value !== null);

  const executionLagSamples = room.requests
    .map((request) => {
      if (!request.execution) {
        return null;
      }
      const quorumAt = findQuorumApprovalTimestamp(request, room.quorum);
      return quorumAt ? minutesBetween(quorumAt, request.execution.executedAt) : null;
    })
    .filter((value): value is number => value !== null);

  const uniqueRecipients = Array.from(
    new Set(
      room.requests
        .map((entry) => entry.recipient.trim().toLowerCase())
        .filter(Boolean),
    ),
  );

  const allowedRecipientSet = new Set(room.allowedRecipients.map((entry) => entry.address.trim().toLowerCase()));
  const coveredRecipientCount =
    room.allowedRecipients.length === 0
      ? uniqueRecipients.length
      : uniqueRecipients.filter((recipient) => allowedRecipientSet.has(recipient)).length;

  const totalFeeWei = room.requests.reduce((sum, request) => {
    if (!request.execution?.feeWei) {
      return sum;
    }
    try {
      return sum + BigInt(request.execution.feeWei);
    } catch {
      return sum;
    }
  }, BigInt(0));

  const totalQuotedFeeWei = room.requests.reduce((sum, request) => {
    if (!request.execution?.quoteFeeWei) {
      return sum;
    }
    try {
      return sum + BigInt(request.execution.quoteFeeWei);
    } catch {
      return sum;
    }
  }, BigInt(0));

  const topApprovers = buildApproverActivity(room.approvers, room.requests);
  const lastExecutedAt = room.requests
    .filter((request) => request.execution?.executedAt)
    .map((request) => request.execution?.executedAt ?? null)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  const latestRequestAt = room.requests.map((entry) => entry.createdAt).sort().at(-1) ?? null;

  return {
    requestCount,
    pendingApprovals,
    approved,
    rejected,
    executed,
    totalRequestedVolume: totalRequestedVolume.toFixed(2),
    totalSettledVolume: totalSettledVolume.toFixed(2),
    avgRequestAmount: requestCount > 0 ? (totalRequestedVolume / requestCount).toFixed(2) : "0.00",
    quorumClearRate: requestCount > 0 ? ((approved + executed) / requestCount) * 100 : 0,
    executionRate: requestCount > 0 ? (executed / requestCount) * 100 : 0,
    avgApprovalLagMinutes: average(approvalLagSamples),
    avgExecutionLagMinutes: average(executionLagSamples),
    walletRotationCount: room.walletHistory.length,
    uniqueRecipientCount: uniqueRecipients.length,
    recipientCoverageRate: uniqueRecipients.length > 0 ? (coveredRecipientCount / uniqueRecipients.length) * 100 : 100,
    activeApproverCount: topApprovers.filter((entry) => entry.totalCount > 0).length,
    totalFeeWei: totalFeeWei.toString(),
    totalQuotedFeeWei: totalQuotedFeeWei.toString(),
    topApprovers,
    lastExecutedAt,
    latestRequestAt,
  };
}
