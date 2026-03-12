import { NextRequest, NextResponse } from "next/server";
import { createTreasuryRoom, updateTreasuryRoomControl } from "@/lib/treasury";
import { TreasuryAgentMode, TreasuryAllowedRecipient, TreasuryApprover, TreasuryChannel, TreasuryRoomStatus } from "@/lib/types";

type Body = {
  roomId?: string;
  name?: string;
  channel?: TreasuryChannel;
  channelLabel?: string;
  routeCommand?: string;
  sessionKey?: string;
  walletAddress?: string;
  network?: string;
  assetSymbol?: string;
  assetAddress?: string;
  balance?: string;
  gasReserve?: string;
  quorum?: number;
  dailyLimit?: string;
  wdkKeyAlias?: string;
  wdkAccountIndex?: number;
  agentMode?: TreasuryAgentMode;
  notes?: string;
  status?: TreasuryRoomStatus;
  approvers?: TreasuryApprover[];
  allowedRecipients?: TreasuryAllowedRecipient[];
};

function isTreasuryChannel(value: string | undefined): value is TreasuryChannel {
  return value === "telegram-topic" || value === "telegram-dm" || value === "whatsapp-group" || value === "terminal";
}

function isTreasuryStatus(value: string | undefined): value is TreasuryRoomStatus {
  return value === "draft" || value === "active" || value === "paused";
}

function isTreasuryAgentMode(value: string | undefined): value is TreasuryAgentMode {
  return value === "observe" || value === "propose" || value === "execute-after-quorum";
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Body;
  if (!body.name?.trim()) {
    return NextResponse.json({ ok: false, error: "name is required" }, { status: 400 });
  }
  if (!isTreasuryChannel(body.channel)) {
    return NextResponse.json({ ok: false, error: "valid channel is required" }, { status: 400 });
  }
  if (!body.sessionKey?.trim()) {
    return NextResponse.json({ ok: false, error: "sessionKey is required" }, { status: 400 });
  }
  if (!Array.isArray(body.approvers) || body.approvers.length === 0) {
    return NextResponse.json({ ok: false, error: "at least one approver is required" }, { status: 400 });
  }

  const quorum = Number(body.quorum);
  if (!Number.isFinite(quorum) || quorum < 1 || quorum > body.approvers.length) {
    return NextResponse.json({ ok: false, error: "quorum must be between 1 and the approver count" }, { status: 400 });
  }

  try {
    const room = await createTreasuryRoom({
      name: body.name.trim(),
      channel: body.channel,
      channelLabel: body.channelLabel?.trim() || body.name.trim(),
      routeCommand: body.routeCommand?.trim() || "claw-topic",
      sessionKey: body.sessionKey.trim(),
      walletAddress: body.walletAddress?.trim() || "pending-wallet",
      network: body.network?.trim() || "Plasma",
      assetSymbol: body.assetSymbol?.trim() || "USD₮",
      assetAddress: body.assetAddress?.trim() || "runtime-configured",
      balance: body.balance?.trim() || "0.00",
      gasReserve: body.gasReserve?.trim() || "",
      quorum,
      dailyLimit: body.dailyLimit?.trim() || "0.00",
      wdkKeyAlias: body.wdkKeyAlias?.trim() || "",
      wdkAccountIndex: Number.isFinite(body.wdkAccountIndex) ? Number(body.wdkAccountIndex) : undefined,
      agentMode: isTreasuryAgentMode(body.agentMode) ? body.agentMode : "execute-after-quorum",
      notes: body.notes?.trim() || "",
      status: isTreasuryStatus(body.status) ? body.status : "active",
      approvers: body.approvers.map((entry, index) => ({
        id: entry.id || `approver_${index + 1}`,
        name: entry.name.trim(),
        role: entry.role.trim() || "approver",
        handle: entry.handle.trim() || entry.name.trim(),
      })),
      allowedRecipients: Array.isArray(body.allowedRecipients)
        ? body.allowedRecipients
          .map((entry) => ({
            address: entry.address?.trim() || "",
            label: entry.label?.trim() || "",
          }))
          .filter((entry) => entry.address)
        : [],
    });

    return NextResponse.json({ ok: true, room });
  } catch (error) {
    const message = error instanceof Error ? error.message : "room_create_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Body;
  if (!body.roomId?.trim()) {
    return NextResponse.json({ ok: false, error: "roomId is required" }, { status: 400 });
  }

  if (body.agentMode && !isTreasuryAgentMode(body.agentMode)) {
    return NextResponse.json({ ok: false, error: "agentMode is invalid" }, { status: 400 });
  }

  if (body.approvers && (!Array.isArray(body.approvers) || body.approvers.length === 0)) {
    return NextResponse.json({ ok: false, error: "approvers must be a non-empty array" }, { status: 400 });
  }

  try {
    const room = await updateTreasuryRoomControl({
      roomId: body.roomId.trim(),
      routeCommand: body.routeCommand,
      sessionKey: body.sessionKey,
      walletAddress: body.walletAddress,
      dailyLimit: body.dailyLimit,
      gasReserve: body.gasReserve,
      wdkKeyAlias: body.wdkKeyAlias,
      wdkAccountIndex: body.wdkAccountIndex,
      agentMode: body.agentMode,
      quorum: body.quorum,
      approvers: body.approvers,
      allowedRecipients: body.allowedRecipients,
      notes: body.notes,
    });

    if (!room) {
      return NextResponse.json({ ok: false, error: "room not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, room });
  } catch (error) {
    const message = error instanceof Error ? error.message : "room_update_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
