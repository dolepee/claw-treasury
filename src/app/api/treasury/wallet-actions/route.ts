import { NextRequest, NextResponse } from "next/server";
import { loadTreasuryStore, suggestNextTreasuryWdkAccountIndex, updateTreasuryRoomControl } from "@/lib/treasury";
import { TreasuryRoom, TreasuryWalletBindingSnapshot } from "@/lib/types";
import { inspectWdkAlias, rotateTreasuryWalletWithSweep } from "@/lib/wdk";

type WalletAction = "rotate" | "rotate-sweep" | "rollback" | "set-index" | "set-index-sweep";

type Body = {
  roomId?: string;
  action?: WalletAction;
  targetAccountIndex?: number;
};

function hasActiveRequests(room: TreasuryRoom): boolean {
  return room.requests.some((entry) => entry.status === "pending-approvals" || entry.status === "approved");
}

function buildHistoryEntry(room: TreasuryRoom): TreasuryWalletBindingSnapshot {
  return {
    walletAddress: room.walletAddress,
    wdkKeyAlias: room.wdkKeyAlias,
    wdkAccountIndex: room.wdkAccountIndex,
    balance: room.balance,
    gasReserve: room.gasReserve,
    recordedAt: new Date().toISOString(),
  };
}

function appendNote(notes: string, line: string): string {
  return `${notes}\n${line}`.trim();
}

function requireUpdatedRoom(room: TreasuryRoom | null): TreasuryRoom {
  if (!room) {
    throw new Error("wallet_action_room_update_failed");
  }
  return room;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Body;
  if (!body.roomId?.trim()) {
    return NextResponse.json({ ok: false, error: "roomId is required" }, { status: 400 });
  }
  if (!body.action) {
    return NextResponse.json({ ok: false, error: "action is required" }, { status: 400 });
  }

  const store = await loadTreasuryStore();
  const room = store.rooms.find((entry) => entry.id === body.roomId?.trim());
  if (!room) {
    return NextResponse.json({ ok: false, error: "room not found" }, { status: 404 });
  }

  if (hasActiveRequests(room)) {
    return NextResponse.json(
      { ok: false, error: "Wallet actions are blocked while spend requests are still pending or approved." },
      { status: 400 },
    );
  }

  try {
    if (body.action === "rollback") {
      const previousBinding = room.walletHistory[room.walletHistory.length - 1];
      if (!previousBinding) {
        return NextResponse.json({ ok: false, error: "No previous wallet binding is stored for rollback." }, { status: 400 });
      }

      const updatedRoom = requireUpdatedRoom(await updateTreasuryRoomControl({
        roomId: room.id,
        walletAddress: previousBinding.walletAddress,
        balance: previousBinding.balance,
        gasReserve: previousBinding.gasReserve,
        wdkKeyAlias: previousBinding.wdkKeyAlias,
        wdkAccountIndex: previousBinding.wdkAccountIndex,
        walletHistory: room.walletHistory.slice(0, -1),
        notes: appendNote(room.notes, "Rolled back wallet from the dashboard."),
      }));

      return NextResponse.json({
        ok: true,
        room: updatedRoom,
        action: {
          kind: body.action,
          summary: `Restored ${previousBinding.wdkKeyAlias} #${previousBinding.wdkAccountIndex}.`,
        },
      });
    }

    const historyEntry = buildHistoryEntry(room);

    if (body.action === "rotate" || body.action === "rotate-sweep") {
      const nextAccountIndex = await suggestNextTreasuryWdkAccountIndex(room.wdkKeyAlias, room.id);

      if (body.action === "rotate-sweep") {
        const sweep = await rotateTreasuryWalletWithSweep({
          room,
          nextAccountIndex,
        });
        const updatedRoom = requireUpdatedRoom(await updateTreasuryRoomControl({
          roomId: room.id,
          walletAddress: sweep.toWalletAddress,
          balance: sweep.toBalance,
          gasReserve: sweep.toGasReserve,
          wdkAccountIndex: nextAccountIndex,
          walletHistory: [...room.walletHistory, historyEntry],
          notes: appendNote(room.notes, "Rotated wallet with sweep from the dashboard."),
        }));

        return NextResponse.json({
          ok: true,
          room: updatedRoom,
          action: {
            kind: body.action,
            summary: `Rotated to ${room.wdkKeyAlias} #${nextAccountIndex}.`,
            sweep,
          },
        });
      }

      const nextSnapshot = await inspectWdkAlias(room.wdkKeyAlias, nextAccountIndex);
      const updatedRoom = requireUpdatedRoom(await updateTreasuryRoomControl({
        roomId: room.id,
        walletAddress: nextSnapshot.walletAddress,
        balance: nextSnapshot.balance || "0.00",
        gasReserve: nextSnapshot.gasReserve,
        wdkAccountIndex: nextAccountIndex,
        walletHistory: [...room.walletHistory, historyEntry],
        notes: appendNote(room.notes, "Rotated wallet from the dashboard."),
      }));

      return NextResponse.json({
        ok: true,
        room: updatedRoom,
        action: {
          kind: body.action,
          summary: `Rotated to ${room.wdkKeyAlias} #${nextAccountIndex}.`,
        },
      });
    }

    if (!Number.isFinite(body.targetAccountIndex) || Number(body.targetAccountIndex) < 0) {
      return NextResponse.json({ ok: false, error: "targetAccountIndex must be zero or greater." }, { status: 400 });
    }

    const targetAccountIndex = Math.floor(Number(body.targetAccountIndex));
    const targetSnapshot = await inspectWdkAlias(room.wdkKeyAlias, targetAccountIndex);
    const walletMatchesTarget = room.walletAddress.trim().toLowerCase() === targetSnapshot.walletAddress.trim().toLowerCase();

    if (targetAccountIndex === room.wdkAccountIndex && walletMatchesTarget) {
      return NextResponse.json(
        { ok: false, error: `This treasury is already bound to ${room.wdkKeyAlias} #${room.wdkAccountIndex}.` },
        { status: 400 },
      );
    }

    if (body.action === "set-index-sweep") {
      const sweep = await rotateTreasuryWalletWithSweep({
        room,
        nextAccountIndex: targetAccountIndex,
      });
      const updatedRoom = requireUpdatedRoom(await updateTreasuryRoomControl({
        roomId: room.id,
        walletAddress: sweep.toWalletAddress,
        balance: sweep.toBalance,
        gasReserve: sweep.toGasReserve,
        wdkAccountIndex: targetAccountIndex,
        walletHistory: [...room.walletHistory, historyEntry],
        notes: appendNote(room.notes, `Rebound wallet index to #${targetAccountIndex} with sweep from the dashboard.`),
      }));

      return NextResponse.json({
        ok: true,
        room: updatedRoom,
        action: {
          kind: body.action,
          summary: `Rebound to ${room.wdkKeyAlias} #${targetAccountIndex}.`,
          sweep,
        },
      });
    }

    const updatedRoom = requireUpdatedRoom(await updateTreasuryRoomControl({
      roomId: room.id,
      walletAddress: targetSnapshot.walletAddress,
      balance: targetSnapshot.balance || "0.00",
      gasReserve: targetSnapshot.gasReserve,
      wdkAccountIndex: targetAccountIndex,
      walletHistory: [...room.walletHistory, historyEntry],
      notes: appendNote(
        room.notes,
        `${targetAccountIndex === room.wdkAccountIndex ? "Refreshed" : "Rebound"} wallet index to #${targetAccountIndex} from the dashboard.`,
      ),
    }));

    return NextResponse.json({
      ok: true,
      room: updatedRoom,
      action: {
        kind: body.action,
        summary: `Rebound to ${room.wdkKeyAlias} #${targetAccountIndex}.`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "wallet_action_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
