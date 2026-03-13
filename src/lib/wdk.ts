import { createHash } from "node:crypto";
import type { TreasuryRoom, TreasurySpendRequest, TreasuryWdkRuntime } from "@/lib/types";

type WdkErc4337Binding = {
  bundlerUrl: string;
  paymasterUrl?: string;
  sponsorshipPolicyId?: string;
  safeVersion?: string;
  safeModulesVersion?: string;
  entryPointAddress?: string;
  safe4337ModuleAddress?: string;
  safeModulesSetupAddress?: string;
  safeWebAuthnSharedSignerAddress?: string;
};

type WdkWalletBinding = {
  seedPhrase: string;
  provider: string;
  accountIndex?: number;
  transferMaxFeeWei?: string;
  assetAddress?: string;
  assetDecimals?: number;
  explorerBaseUrl?: string;
  erc4337?: WdkErc4337Binding;
};

type ExecuteWithWdkInput = {
  room: TreasuryRoom;
  request: TreasurySpendRequest;
  operatorKey: string;
};

type RotateWithSweepInput = {
  room: TreasuryRoom;
  nextAccountIndex: number;
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

type RotateWithSweepResult = {
  txHash: string | null;
  explorerUrl: string | null;
  feeWei: string | null;
  quoteFeeWei: string | null;
  gasSweepTxHash: string | null;
  gasSweepExplorerUrl: string | null;
  gasSweepFeeWei: string | null;
  fromWalletAddress: string;
  toWalletAddress: string;
  toBalance: string;
  fromGasReserve: string;
  toGasReserve: string;
  sweptAmount: string;
  gasSweptAmount: string;
};

type WdkAliasSnapshot = {
  walletAddress: string;
  assetAddress: string | null;
  balance: string | null;
  gasReserve: string;
};

type WdkRoomSnapshot = {
  walletAddress: string;
  assetAddress: string;
  balance: string;
  gasReserve: string;
};

const DEFAULT_ASSET_DECIMALS = 6;
const DEFAULT_NATIVE_DECIMALS = 18;
const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
];
const SMART_ACCOUNT_RECEIPT_ATTEMPTS = 12;
const SMART_ACCOUNT_RECEIPT_DELAY_MS = 1000;

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
      erc4337:
        binding.erc4337 && typeof binding.erc4337 === "object" && "bundlerUrl" in binding.erc4337 && typeof binding.erc4337.bundlerUrl === "string"
          ? {
            bundlerUrl: binding.erc4337.bundlerUrl.trim(),
            paymasterUrl:
              typeof binding.erc4337.paymasterUrl === "string" && binding.erc4337.paymasterUrl.trim()
                ? binding.erc4337.paymasterUrl.trim()
                : undefined,
            sponsorshipPolicyId:
              typeof binding.erc4337.sponsorshipPolicyId === "string" && binding.erc4337.sponsorshipPolicyId.trim()
                ? binding.erc4337.sponsorshipPolicyId.trim()
                : undefined,
            safeVersion:
              typeof binding.erc4337.safeVersion === "string" && binding.erc4337.safeVersion.trim()
                ? binding.erc4337.safeVersion.trim()
                : undefined,
            safeModulesVersion:
              typeof binding.erc4337.safeModulesVersion === "string" && binding.erc4337.safeModulesVersion.trim()
                ? binding.erc4337.safeModulesVersion.trim()
                : undefined,
            entryPointAddress:
              typeof binding.erc4337.entryPointAddress === "string" && binding.erc4337.entryPointAddress.trim()
                ? binding.erc4337.entryPointAddress.trim()
                : undefined,
            safe4337ModuleAddress:
              typeof binding.erc4337.safe4337ModuleAddress === "string" && binding.erc4337.safe4337ModuleAddress.trim()
                ? binding.erc4337.safe4337ModuleAddress.trim()
                : undefined,
            safeModulesSetupAddress:
              typeof binding.erc4337.safeModulesSetupAddress === "string" && binding.erc4337.safeModulesSetupAddress.trim()
                ? binding.erc4337.safeModulesSetupAddress.trim()
                : undefined,
            safeWebAuthnSharedSignerAddress:
              typeof binding.erc4337.safeWebAuthnSharedSignerAddress === "string" && binding.erc4337.safeWebAuthnSharedSignerAddress.trim()
                ? binding.erc4337.safeWebAuthnSharedSignerAddress.trim()
                : undefined,
          }
          : undefined,
    };
  }

  return next;
}

function getBinding(alias: string): WdkWalletBinding | null {
  return parseBindings()[alias] ?? null;
}

function hasSmartAccountBinding(binding: WdkWalletBinding): boolean {
  return Boolean(binding.erc4337?.bundlerUrl?.trim());
}

function resolveAccountIndex(room: Pick<TreasuryRoom, "wdkAccountIndex"> | null, binding: WdkWalletBinding, accountIndexOverride?: number): number {
  if (Number.isFinite(accountIndexOverride)) {
    return Math.max(0, Math.floor(Number(accountIndexOverride)));
  }

  if (room && Number.isFinite(room.wdkAccountIndex)) {
    return Math.max(0, Math.floor(Number(room.wdkAccountIndex)));
  }

  return binding.accountIndex ?? 0;
}

export function getConfiguredTreasuryOperatorKey(): string | null {
  return process.env.CLAW_TREASURY_OPERATOR_KEY?.trim() || null;
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadEthers() {
  return import("ethers");
}

function resolveSmartSalt(alias: string, accountIndex: number): string {
  return `0x${createHash("sha256").update(`${alias}:${accountIndex}`).digest("hex")}`;
}

async function deriveWdkOwner(binding: WdkWalletBinding, accountIndex: number): Promise<{
  address: string;
  privateKey: string;
  derivationPath: string;
}> {
  const { HDNodeWallet } = await loadEthers();
  const derivationPath = `m/44'/60'/0'/0/${accountIndex}`;
  const owner = HDNodeWallet.fromPhrase(binding.seedPhrase, undefined, derivationPath);
  return {
    address: owner.address,
    privateKey: owner.privateKey,
    derivationPath,
  };
}

async function buildSmartAccountContext(
  alias: string,
  binding: WdkWalletBinding,
  accountIndex: number,
): Promise<{
  safeAddress: string;
  chainId: bigint;
  ownerAddress: string;
  ownerPrivateKey: string;
  paymasterSponsored: boolean;
}> {
  if (!binding.erc4337?.bundlerUrl?.trim()) {
    throw new Error("wdk_erc4337_not_configured");
  }

  const [{ Safe4337Pack }, { JsonRpcProvider }] = await Promise.all([
    import("@tetherto/wdk-safe-relay-kit"),
    loadEthers(),
  ]);
  const owner = await deriveWdkOwner(binding, accountIndex);
  const provider = new JsonRpcProvider(binding.provider);
  const network = await provider.getNetwork();
  const chainId = BigInt(network.chainId);
  const safeAddress = Safe4337Pack.predictSafeAddress({
    threshold: 1,
    owners: [owner.address],
    saltNonce: resolveSmartSalt(alias, accountIndex),
    chainId,
    safeVersion: binding.erc4337.safeVersion,
    safeModulesVersion: binding.erc4337.safeModulesVersion,
    paymasterOptions: binding.erc4337.paymasterUrl
      ? {
        paymasterUrl: binding.erc4337.paymasterUrl,
        isSponsored: true,
        sponsorshipPolicyId: binding.erc4337.sponsorshipPolicyId,
      }
      : undefined,
  });

  return {
    safeAddress,
    chainId,
    ownerAddress: owner.address,
    ownerPrivateKey: owner.privateKey,
    paymasterSponsored: Boolean(binding.erc4337.paymasterUrl),
  };
}

async function getSmartAccountBalances(input: {
  walletAddress: string;
  provider: string;
  assetAddress: string;
  assetDecimals: number;
}): Promise<{ balance: string; gasReserve: string }> {
  const { Contract, JsonRpcProvider } = await loadEthers();
  const provider = new JsonRpcProvider(input.provider);
  const tokenContract = new Contract(input.assetAddress, ERC20_ABI, provider);
  const [tokenBalance, nativeBalance] = await Promise.all([
    tokenContract.balanceOf(input.walletAddress) as Promise<bigint>,
    provider.getBalance(input.walletAddress),
  ]);

  return {
    balance: formatUnits(tokenBalance, input.assetDecimals, input.assetDecimals),
    gasReserve: formatUnits(nativeBalance, DEFAULT_NATIVE_DECIMALS, 6),
  };
}

async function executeSmartAccountTransfer(input: {
  alias: string;
  binding: WdkWalletBinding;
  room: TreasuryRoom;
  request: TreasurySpendRequest;
  assetAddress: string;
  assetDecimals: number;
  amount: bigint;
  explorerBaseUrl: string;
}): Promise<ExecuteWithWdkResult> {
  if (!input.binding.erc4337?.bundlerUrl?.trim()) {
    throw new Error("wdk_erc4337_not_configured");
  }

  const [{ Interface }, { Safe4337Pack }] = await Promise.all([
    loadEthers(),
    import("@tetherto/wdk-safe-relay-kit"),
  ]);

  const smartAccount = await buildSmartAccountContext(input.alias, input.binding, resolveAccountIndex(input.room, input.binding));
  if (!isRuntimePlaceholder(input.room.walletAddress) && input.room.walletAddress.toLowerCase() !== smartAccount.safeAddress.toLowerCase()) {
    throw new Error("wdk_wallet_address_mismatch");
  }

  const balances = await getSmartAccountBalances({
    walletAddress: smartAccount.safeAddress,
    provider: input.binding.provider,
    assetAddress: input.assetAddress,
    assetDecimals: input.assetDecimals,
  });
  if (toBaseUnits(balances.balance, input.assetDecimals) < input.amount) {
    throw new Error(
      `WDK smart account ${smartAccount.safeAddress} has ${balances.balance} ${input.room.assetSymbol} on ${input.room.network}. Fund the treasury Safe before retrying execution.`,
    );
  }
  if (!smartAccount.paymasterSponsored) {
    throw new Error("wdk_erc4337_paymaster_missing");
  }

  const safePack = await Safe4337Pack.init({
    provider: input.binding.provider,
    signer: smartAccount.ownerPrivateKey,
    bundlerUrl: input.binding.erc4337.bundlerUrl,
    safeModulesVersion: input.binding.erc4337.safeModulesVersion,
    customContracts: {
      entryPointAddress: input.binding.erc4337.entryPointAddress,
      safe4337ModuleAddress: input.binding.erc4337.safe4337ModuleAddress,
      safeModulesSetupAddress: input.binding.erc4337.safeModulesSetupAddress,
      safeWebAuthnSharedSignerAddress: input.binding.erc4337.safeWebAuthnSharedSignerAddress,
    },
    paymasterOptions: {
      paymasterUrl: input.binding.erc4337.paymasterUrl ?? "",
      isSponsored: true,
      sponsorshipPolicyId: input.binding.erc4337.sponsorshipPolicyId,
    },
    options: {
      owners: [smartAccount.ownerAddress],
      threshold: 1,
      safeVersion: input.binding.erc4337.safeVersion as never,
      saltNonce: resolveSmartSalt(input.alias, resolveAccountIndex(input.room, input.binding)),
    },
  });

  const erc20Interface = new Interface(ERC20_ABI);
  const safeOperation = await safePack.createTransaction({
    transactions: [
      {
        to: input.assetAddress,
        value: "0",
        data: erc20Interface.encodeFunctionData("transfer", [input.request.recipient, input.amount]),
      },
    ],
    options: {
      isSponsored: true,
      sponsorshipPolicyId: input.binding.erc4337.sponsorshipPolicyId,
    },
  });
  const signedOperation = await safePack.signSafeOperation(safeOperation);
  const userOperation = signedOperation.getUserOperation();
  const estimatedFee = (
    (BigInt(userOperation.callGasLimit) + BigInt(userOperation.verificationGasLimit) + BigInt(userOperation.preVerificationGas)) *
    BigInt(userOperation.maxFeePerGas)
  ).toString();
  const userOpHash = await safePack.executeTransaction({ executable: signedOperation });

  let receipt: {
    transactionHash: string;
    actualGasCost: string;
  } | null = null;
  for (let attempt = 0; attempt < SMART_ACCOUNT_RECEIPT_ATTEMPTS; attempt += 1) {
    const current = await safePack.getUserOperationReceipt(userOpHash);
    if (current?.receipt?.transactionHash) {
      receipt = {
        transactionHash: current.receipt.transactionHash,
        actualGasCost: current.actualGasCost,
      };
      break;
    }
    await delay(SMART_ACCOUNT_RECEIPT_DELAY_MS);
  }

  if (!receipt?.transactionHash) {
    throw new Error(`wdk_erc4337_user_operation_pending:${userOpHash}`);
  }

  const nextBalances = await getSmartAccountBalances({
    walletAddress: smartAccount.safeAddress,
    provider: input.binding.provider,
    assetAddress: input.assetAddress,
    assetDecimals: input.assetDecimals,
  });

  return {
    txHash: receipt.transactionHash,
    explorerUrl: input.explorerBaseUrl ? `${input.explorerBaseUrl}${receipt.transactionHash}` : receipt.transactionHash,
    feeWei: receipt.actualGasCost,
    quoteFeeWei: estimatedFee,
    walletAddress: smartAccount.safeAddress,
    balance: nextBalances.balance,
    gasReserve: nextBalances.gasReserve,
  };
}

export function loadTreasuryWdkRuntime(): TreasuryWdkRuntime {
  return {
    operatorKeyConfigured: Boolean(getConfiguredTreasuryOperatorKey()),
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

export async function inspectWdkAlias(alias: string, accountIndexOverride?: number): Promise<WdkAliasSnapshot> {
  const binding = getBinding(alias);
  if (!binding) {
    throw new Error("wdk_wallet_binding_missing");
  }

  const accountIndex = resolveAccountIndex(null, binding, accountIndexOverride);
  if (hasSmartAccountBinding(binding)) {
    const smartAccount = await buildSmartAccountContext(alias, binding, accountIndex);
    const balances = binding.assetAddress?.trim()
      ? await getSmartAccountBalances({
        walletAddress: smartAccount.safeAddress,
        provider: binding.provider,
        assetAddress: binding.assetAddress.trim(),
        assetDecimals: binding.assetDecimals ?? DEFAULT_ASSET_DECIMALS,
      })
      : { balance: null, gasReserve: "0" };

    return {
      walletAddress: smartAccount.safeAddress,
      assetAddress: binding.assetAddress?.trim() || null,
      balance: balances.balance,
      gasReserve: balances.gasReserve,
    };
  }

  const { default: WalletManagerEvm } = await import("@tetherto/wdk-wallet-evm");
  const wallet = new WalletManagerEvm(binding.seedPhrase, {
    provider: binding.provider,
    transferMaxFee: binding.transferMaxFeeWei ? BigInt(binding.transferMaxFeeWei) : undefined,
  });
  const account = await wallet.getAccount(accountIndex);

  try {
    const walletAddress = await account.getAddress();
    const [balance, gasReserve] = await Promise.all([
      binding.assetAddress?.trim()
        ? account.getTokenBalance(binding.assetAddress.trim()).then((value) => formatUnits(value, binding.assetDecimals ?? DEFAULT_ASSET_DECIMALS, binding.assetDecimals ?? DEFAULT_ASSET_DECIMALS))
        : Promise.resolve<string | null>(null),
      account.getBalance().then((value) => formatUnits(value, DEFAULT_NATIVE_DECIMALS, 6)),
    ]);

    return {
      walletAddress,
      assetAddress: binding.assetAddress?.trim() || null,
      balance,
      gasReserve,
    };
  } finally {
    account.dispose();
    wallet.dispose();
  }
}

export async function inspectTreasuryRoomWithWdk(room: TreasuryRoom): Promise<WdkRoomSnapshot> {
  const binding = getBinding(room.wdkKeyAlias);
  if (!binding) {
    throw new Error("wdk_wallet_binding_missing");
  }

  if (hasSmartAccountBinding(binding)) {
    const accountIndex = resolveAccountIndex(room, binding);
    const smartAccount = await buildSmartAccountContext(room.wdkKeyAlias, binding, accountIndex);
    if (!isRuntimePlaceholder(room.walletAddress) && room.walletAddress.toLowerCase() !== smartAccount.safeAddress.toLowerCase()) {
      throw new Error("wdk_wallet_address_mismatch");
    }

    const assetAddress = getResolvedAssetAddress(room, binding);
    const assetDecimals = binding.assetDecimals ?? DEFAULT_ASSET_DECIMALS;
    const balances = await getSmartAccountBalances({
      walletAddress: smartAccount.safeAddress,
      provider: binding.provider,
      assetAddress,
      assetDecimals,
    });

    return {
      walletAddress: smartAccount.safeAddress,
      assetAddress,
      balance: balances.balance,
      gasReserve: balances.gasReserve,
    };
  }

  const { default: WalletManagerEvm } = await import("@tetherto/wdk-wallet-evm");
  const wallet = new WalletManagerEvm(binding.seedPhrase, {
    provider: binding.provider,
    transferMaxFee: binding.transferMaxFeeWei ? BigInt(binding.transferMaxFeeWei) : undefined,
  });
  const account = await wallet.getAccount(resolveAccountIndex(room, binding));

  try {
    const walletAddress = await account.getAddress();
    if (!isRuntimePlaceholder(room.walletAddress) && room.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new Error("wdk_wallet_address_mismatch");
    }

    const assetAddress = getResolvedAssetAddress(room, binding);
    const assetDecimals = binding.assetDecimals ?? DEFAULT_ASSET_DECIMALS;
    const [balance, gasReserve] = await Promise.all([
      account.getTokenBalance(assetAddress).then((value) => formatUnits(value, assetDecimals, assetDecimals)),
      account.getBalance().then((value) => formatUnits(value, DEFAULT_NATIVE_DECIMALS, 6)),
    ]);

    return {
      walletAddress,
      assetAddress,
      balance,
      gasReserve,
    };
  } finally {
    account.dispose();
    wallet.dispose();
  }
}

export async function executeTreasuryRequestWithWdk(input: ExecuteWithWdkInput): Promise<ExecuteWithWdkResult> {
  const configuredOperatorKey = getConfiguredTreasuryOperatorKey();
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

  if (hasSmartAccountBinding(binding)) {
    const assetAddress = getResolvedAssetAddress(input.room, binding);
    const assetDecimals = binding.assetDecimals ?? DEFAULT_ASSET_DECIMALS;
    return executeSmartAccountTransfer({
      alias: input.room.wdkKeyAlias,
      binding,
      room: input.room,
      request: input.request,
      assetAddress,
      assetDecimals,
      amount: toBaseUnits(input.request.amount, assetDecimals),
      explorerBaseUrl: normalizeExplorerBaseUrl(input.room, binding),
    });
  }

  const { default: WalletManagerEvm } = await import("@tetherto/wdk-wallet-evm");
  const wallet = new WalletManagerEvm(binding.seedPhrase, {
    provider: binding.provider,
    transferMaxFee: binding.transferMaxFeeWei ? BigInt(binding.transferMaxFeeWei) : undefined,
  });

  const account = await wallet.getAccount(resolveAccountIndex(input.room, binding));
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

export async function rotateTreasuryWalletWithSweep(input: RotateWithSweepInput): Promise<RotateWithSweepResult> {
  const binding = getBinding(input.room.wdkKeyAlias);
  if (!binding) {
    throw new Error("wdk_wallet_binding_missing");
  }

  if (hasSmartAccountBinding(binding)) {
    throw new Error("wdk_smart_account_sweep_not_supported");
  }

  if (input.room.agentMode !== "execute-after-quorum") {
    throw new Error("wdk_rotation_sweep_not_enabled_for_room");
  }

  const { default: WalletManagerEvm } = await import("@tetherto/wdk-wallet-evm");
  const wallet = new WalletManagerEvm(binding.seedPhrase, {
    provider: binding.provider,
    transferMaxFee: binding.transferMaxFeeWei ? BigInt(binding.transferMaxFeeWei) : undefined,
  });

  const currentAccount = await wallet.getAccount(resolveAccountIndex(input.room, binding));
  const nextAccount = await wallet.getAccount(resolveAccountIndex(null, binding, input.nextAccountIndex));

  try {
    const assetAddress = getResolvedAssetAddress(input.room, binding);
    const assetDecimals = binding.assetDecimals ?? DEFAULT_ASSET_DECIMALS;
    const explorerBaseUrl = normalizeExplorerBaseUrl(input.room, binding);

    const [fromWalletAddress, toWalletAddress, currentTokenBalance] = await Promise.all([
      currentAccount.getAddress(),
      nextAccount.getAddress(),
      currentAccount.getTokenBalance(assetAddress),
    ]);

    if (fromWalletAddress.toLowerCase() === toWalletAddress.toLowerCase()) {
      throw new Error("wdk_wallet_rotation_target_matches_current");
    }

    let transferHash: string | null = null;
    let transferExplorerUrl: string | null = null;
    let transferFeeWei: string | null = null;
    let transferQuoteFeeWei: string | null = null;
    let sweptAmount = "0.00";
    let gasSweepTxHash: string | null = null;
    let gasSweepExplorerUrl: string | null = null;
    let gasSweepFeeWei: string | null = null;
    let gasSweptAmount = "0";

    if (currentTokenBalance > BigInt(0)) {
      const quote = await currentAccount.quoteTransfer({
        token: assetAddress,
        recipient: toWalletAddress,
        amount: currentTokenBalance,
      });
      const currentNativeBalance = await currentAccount.getBalance();

      if (currentNativeBalance < quote.fee) {
        throw new Error(
          `WDK wallet ${fromWalletAddress} has ${formatUnits(currentNativeBalance, DEFAULT_NATIVE_DECIMALS, 6)} native gas on ${input.room.network}, but the estimated fee to sweep into the rotated wallet is ${formatUnits(quote.fee, DEFAULT_NATIVE_DECIMALS, 6)}. Fund the current wallet with native gas before retrying rotation with sweep.`,
        );
      }

      const result = await currentAccount.transfer({
        token: assetAddress,
        recipient: toWalletAddress,
        amount: currentTokenBalance,
      });

      transferHash = result.hash;
      transferExplorerUrl = explorerBaseUrl ? `${explorerBaseUrl}${result.hash}` : result.hash;
      transferFeeWei = result.fee.toString();
      transferQuoteFeeWei = quote.fee.toString();
      sweptAmount = formatUnits(currentTokenBalance, assetDecimals, assetDecimals);
    }

    const remainingNativeBalance = await currentAccount.getBalance();
    if (remainingNativeBalance > BigInt(0)) {
      try {
        const baseQuote = await currentAccount.quoteSendTransaction({
          to: toWalletAddress,
          value: BigInt(0),
        });
        const reserveFloor = baseQuote.fee * BigInt(2);
        const sweepableNative = remainingNativeBalance - reserveFloor;

        if (sweepableNative > BigInt(0)) {
          const nativeResult = await currentAccount.sendTransaction({
            to: toWalletAddress,
            value: sweepableNative,
          });
          gasSweepTxHash = nativeResult.hash;
          gasSweepExplorerUrl = explorerBaseUrl ? `${explorerBaseUrl}${nativeResult.hash}` : nativeResult.hash;
          gasSweepFeeWei = nativeResult.fee.toString();
          gasSweptAmount = formatUnits(sweepableNative, DEFAULT_NATIVE_DECIMALS, 6);
        }
      } catch {
        // Leave residual native gas in place if the chain quote drifts or the transfer cannot be submitted safely.
      }
    }

    const [toBalance, fromGasReserve, toGasReserve] = await Promise.all([
      nextAccount.getTokenBalance(assetAddress),
      currentAccount.getBalance(),
      nextAccount.getBalance(),
    ]);

    return {
      txHash: transferHash,
      explorerUrl: transferExplorerUrl,
      feeWei: transferFeeWei,
      quoteFeeWei: transferQuoteFeeWei,
      gasSweepTxHash,
      gasSweepExplorerUrl,
      gasSweepFeeWei,
      fromWalletAddress,
      toWalletAddress,
      toBalance: formatUnits(toBalance, assetDecimals, assetDecimals),
      fromGasReserve: formatUnits(fromGasReserve, DEFAULT_NATIVE_DECIMALS, 6),
      toGasReserve: formatUnits(toGasReserve, DEFAULT_NATIVE_DECIMALS, 6),
      sweptAmount,
      gasSweptAmount,
    };
  } finally {
    currentAccount.dispose();
    nextAccount.dispose();
    wallet.dispose();
  }
}
