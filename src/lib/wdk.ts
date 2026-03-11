import type { TreasuryRoom, TreasurySpendRequest, TreasuryWdkRuntime } from "@/lib/types";

type WdkWalletBinding = {
  seedPhrase: string;
  provider: string;
  accountIndex?: number;
  transferMaxFeeWei?: string;
  assetAddress?: string;
  assetDecimals?: number;
  explorerBaseUrl?: string;
};

type ExecuteWithWdkInput = {
  room: TreasuryRoom;
  request: TreasurySpendRequest;
  operatorKey: string;
};

type ExecuteWithWdkResult = {
  txHash: string;
  explorerUrl: string;
  feeWei: string;
  quoteFeeWei: string;
  walletAddress: string;
  balance: string;
  gasReserve: string;
};

const DEFAULT_ASSET_DECIMALS = 6;
const DEFAULT_NATIVE_DECIMALS = 18;

function parseBindings(): Record<string, WdkWalletBinding> {
  const raw = process.env.CLAW_TREASURY_WDK_WALLETS_JSON?.trim();
  if (!raw) {
    return {};
  }

  let parsed: Record<string, WdkWalletBinding>;
  try {
    parsed = JSON.parse(raw) as Record<string, WdkWalletBinding>;
  } catch {
    return {};
  }
  const next: Record<string, WdkWalletBinding> = {};

  for (const [alias, binding] of Object.entries(parsed)) {
    if (!alias.trim()) {
      continue;
    }
    if (!binding?.seedPhrase?.trim() || !binding.provider?.trim()) {
      continue;
    }

    next[alias.trim()] = {
      seedPhrase: binding.seedPhrase.trim(),
      provider: binding.provider.trim(),
      accountIndex: Number.isFinite(binding.accountIndex) ? Number(binding.accountIndex) : 0,
      transferMaxFeeWei: binding.transferMaxFeeWei?.trim() || undefined,
      assetAddress: binding.assetAddress?.trim() || undefined,
      assetDecimals: Number.isFinite(binding.assetDecimals) ? Number(binding.assetDecimals) : undefined,
      explorerBaseUrl: binding.explorerBaseUrl?.trim() || undefined,
    };
  }

  return next;
}

function getBinding(alias: string): WdkWalletBinding | null {
  return parseBindings()[alias] ?? null;
}

function normalizeExplorerBaseUrl(room: TreasuryRoom, binding: WdkWalletBinding): string {
  const configured = binding.explorerBaseUrl?.trim();
  if (configured) {
    return configured.endsWith("/") ? configured : `${configured}/`;
  }

  if (room.network.trim().toLowerCase() === "plasma") {
    return "https://plasmascan.to/tx/";
  }

  return "";
}

function isRuntimePlaceholder(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return !normalized || normalized === "runtime-configured" || normalized === "pending-wallet";
}

function toBaseUnits(amount: string, decimals: number): bigint {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("invalid_amount_format");
  }

  const [whole, fraction = ""] = trimmed.split(".");
  const paddedFraction = `${fraction}${"0".repeat(decimals)}`.slice(0, decimals);
  const base = BigInt(10) ** BigInt(decimals);
  return BigInt(whole) * base + BigInt(paddedFraction || "0");
}

function formatUnits(value: bigint, decimals: number, maxFractionDigits = decimals): string {
  const base = BigInt(10) ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  if (decimals === 0 || fraction === BigInt(0)) {
    return whole.toString();
  }

  const padded = fraction.toString().padStart(decimals, "0");
  const trimmed = padded.slice(0, maxFractionDigits).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

function getResolvedAssetAddress(room: TreasuryRoom, binding: WdkWalletBinding): string {
  if (!isRuntimePlaceholder(room.assetAddress)) {
    return room.assetAddress.trim();
  }
  if (binding.assetAddress?.trim()) {
    return binding.assetAddress.trim();
  }
  throw new Error("wdk_asset_address_missing");
}

export function loadTreasuryWdkRuntime(): TreasuryWdkRuntime {
  return {
    operatorKeyConfigured: Boolean(process.env.CLAW_TREASURY_OPERATOR_KEY?.trim()),
    configuredAliases: Object.keys(parseBindings()),
  };
}

export function isRoomWdkExecutable(room: TreasuryRoom, runtime: TreasuryWdkRuntime): boolean {
  return (
    runtime.operatorKeyConfigured &&
    runtime.configuredAliases.includes(room.wdkKeyAlias) &&
    room.agentMode === "execute-after-quorum"
  );
}

export async function executeTreasuryRequestWithWdk(input: ExecuteWithWdkInput): Promise<ExecuteWithWdkResult> {
  const configuredOperatorKey = process.env.CLAW_TREASURY_OPERATOR_KEY?.trim();
  if (!configuredOperatorKey) {
    throw new Error("wdk_operator_key_missing");
  }
  if (input.operatorKey.trim() !== configuredOperatorKey) {
    throw new Error("wdk_operator_key_invalid");
  }
  if (input.room.agentMode !== "execute-after-quorum") {
    throw new Error("wdk_execution_not_enabled_for_room");
  }
  if (input.request.status !== "approved") {
    throw new Error("request_not_ready_for_wdk_execution");
  }

  const binding = getBinding(input.room.wdkKeyAlias);
  if (!binding) {
    throw new Error("wdk_wallet_binding_missing");
  }

  const { default: WalletManagerEvm } = await import("@tetherto/wdk-wallet-evm");
  const wallet = new WalletManagerEvm(binding.seedPhrase, {
    provider: binding.provider,
    transferMaxFee: binding.transferMaxFeeWei ? BigInt(binding.transferMaxFeeWei) : undefined,
  });

  const account = await wallet.getAccount(binding.accountIndex ?? 0);
  try {
    const walletAddress = await account.getAddress();
    if (!isRuntimePlaceholder(input.room.walletAddress) && input.room.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new Error("wdk_wallet_address_mismatch");
    }

    const assetAddress = getResolvedAssetAddress(input.room, binding);
    const assetDecimals = binding.assetDecimals ?? DEFAULT_ASSET_DECIMALS;
    const amount = toBaseUnits(input.request.amount, assetDecimals);
    const explorerBaseUrl = normalizeExplorerBaseUrl(input.room, binding);
    const currentTokenBalance = await account.getTokenBalance(assetAddress);

    if (currentTokenBalance < amount) {
      throw new Error(
        `WDK wallet ${walletAddress} has ${formatUnits(currentTokenBalance, assetDecimals, assetDecimals)} ${input.room.assetSymbol} on ${input.room.network}. Fund the wallet with at least ${input.request.amount} ${input.room.assetSymbol} before retrying execution.`,
      );
    }

    const quote = await account.quoteTransfer({
      token: assetAddress,
      recipient: input.request.recipient,
      amount,
    });
    const currentNativeBalance = await account.getBalance();

    if (currentNativeBalance < quote.fee) {
      throw new Error(
        `WDK wallet ${walletAddress} has ${formatUnits(currentNativeBalance, DEFAULT_NATIVE_DECIMALS, 6)} native gas on ${input.room.network}, but the estimated fee is ${formatUnits(quote.fee, DEFAULT_NATIVE_DECIMALS, 6)}. Fund the wallet with native gas before retrying execution.`,
      );
    }

    const result = await account.transfer({
      token: assetAddress,
      recipient: input.request.recipient,
      amount,
    });

    const [tokenBalance, nativeBalance] = await Promise.all([
      account.getTokenBalance(assetAddress),
      account.getBalance(),
    ]);

    return {
      txHash: result.hash,
      explorerUrl: explorerBaseUrl ? `${explorerBaseUrl}${result.hash}` : result.hash,
      feeWei: result.fee.toString(),
      quoteFeeWei: quote.fee.toString(),
      walletAddress,
      balance: formatUnits(tokenBalance, assetDecimals, assetDecimals),
      gasReserve: formatUnits(nativeBalance, DEFAULT_NATIVE_DECIMALS, 6),
    };
  } finally {
    account.dispose();
    wallet.dispose();
  }
}
