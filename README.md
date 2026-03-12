# ClawTreasury

Standalone ClawTreasury app for the Tether WDK hackathon.

## What It Is
- Chat-native treasury rooms for autonomous treasury operations
- Plasma-first treasury flow for Tether WDK
- Each room is bound to a real route context:
  - channel label
  - route command
  - session key
- Operators can:
  - create treasury rooms
  - request USDT payouts
  - record quorum approvals or rejections
  - execute approved payouts through WDK on Plasma
  - attach manual receipts only as a fallback
  - export a room audit trail as JSON, CSV, or a markdown operator brief
  - rotate, roll back, or rebind treasury wallets directly from the dashboard
  - inspect approval velocity, execution lag, fee totals, and approver participation in the dashboard
- Telegram topics can now act as the primary treasury surface through the webhook bridge at `/api/telegram/webhook`
- New Telegram treasury rooms provision a unique derived WDK account index under the configured Plasma signer instead of reusing one shared account

## Stack
- Next.js (App Router) + TypeScript
- File-based data under `./data`
- No external database in MVP

## Local Run
1. `npm run dev`
2. Open `http://localhost:3000`

## Checks
- `npm run lint`
- `npm run build`

## Data
- Local development starts empty with `./data/treasury.json`
- Override local file storage with `CLAW_TREASURY_DATA_DIR`
- On Vercel, if `BLOB_READ_WRITE_TOKEN` is set, treasury state is stored in Vercel Blob at `stores/treasury.json`

## WDK Execution
To enable real Plasma execution, set these server env vars:

- `CLAW_TREASURY_OPERATOR_KEY`
  - shared operator secret required by the dashboard before Claw can execute
- `CLAW_TREASURY_WDK_WALLETS_JSON`
  - JSON object keyed by `wdkKeyAlias`
  - each alias requires:
    - `seedPhrase`
    - `provider`
  - optional fields:
    - `accountIndex`
    - `transferMaxFeeWei`
    - `assetAddress`
    - `assetDecimals`
    - `explorerBaseUrl`

Example:

```json
{
  "wdk-plasma-main": {
    "seedPhrase": "word word word word word word word word word word word word",
    "provider": "https://your-plasma-rpc.example",
    "accountIndex": 0,
    "assetAddress": "0xYourPlasmaUsdtContract",
    "assetDecimals": 6,
    "transferMaxFeeWei": "500000000000000",
    "explorerBaseUrl": "https://plasmascan.to/tx/"
  }
}
```

See [.env.example](./.env.example) for the exact env variable names.

## Telegram Bridge
ClawTreasury now supports a Telegram-first treasury flow:

- `create treasury`
- `show treasury`
- `balance`
- `history`
- `allowlist`
- `rotate wallet`
- `rotate wallet sweep`
- `rollback wallet`
- `set wallet index 0`
- `set wallet index 0 sweep`
- `set approvers @alice @bob`
- `set quorum 2`
- `set daily limit 250`
- `allow 0x... for payroll`
- `remove recipient 0x...`
- `pay 20 USDT to 0x... for design review`
- `approve <ref>` or reply `approve` to the request message
- `reject <ref>` or reply `reject reason` to the request message
- request messages also expose inline `Approve` and `Reject` buttons in Telegram

### Required Telegram env
- `CLAW_TREASURY_TELEGRAM_BOT_TOKEN`
- `CLAW_TREASURY_TELEGRAM_WEBHOOK_SECRET`
- `CLAW_TREASURY_TELEGRAM_DEFAULT_APPROVERS`
- `CLAW_TREASURY_TELEGRAM_DEFAULT_WDK_ALIAS`

Optional defaults:
- `CLAW_TREASURY_TELEGRAM_DEFAULT_DAILY_LIMIT`
- `CLAW_TREASURY_TELEGRAM_DEFAULT_ROUTE_COMMAND`
- `CLAW_TREASURY_TELEGRAM_DEFAULT_NETWORK`
- `CLAW_TREASURY_TELEGRAM_DEFAULT_ASSET_SYMBOL`
- `CLAW_TREASURY_TELEGRAM_DEFAULT_ASSET_ADDRESS`

### Webhook setup
After deploying, register Telegram against the live route:

```bash
curl -X POST "https://api.telegram.org/bot$CLAW_TREASURY_TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "content-type: application/json" \
  -d '{
    "url": "https://claw-treasury.vercel.app/api/telegram/webhook",
    "secret_token": "'"$CLAW_TREASURY_TELEGRAM_WEBHOOK_SECRET"'",
    "allowed_updates": ["message", "callback_query"]
  }'
```

Health / command discovery:

```bash
curl https://claw-treasury.vercel.app/api/telegram/webhook
```

### Current scope
- Telegram topic or DM can create or use a treasury room bound to its chat context
- Each newly created Telegram treasury room binds to its own derived WDK account index under the configured default alias
- Spend requests are created in chat and echoed back with a short ref
- Spend requests in Telegram now render inline `Approve` and `Reject` buttons in addition to text commands
- Approvers are matched from Telegram usernames against configured approver handles
- Treasury policy can now be updated in chat with `set approvers`, `set quorum`, `set daily limit`, and recipient allowlist commands
- Recipient allowlists are enforced on both Telegram-created requests and dashboard-created requests
- Existing Telegram treasury rooms can rotate to a fresh derived WDK account index with `rotate wallet`
- `rotate wallet sweep` moves the current treasury token balance into the new derived wallet before rebinding the room, then best-effort carries forward leftover native gas
- Telegram treasury rooms can revert the last wallet rotation with `rollback wallet`
- `set wallet index <n>` explicitly rebinds a treasury room to a chosen derived WDK account, including the original `#0` wallet
- `set wallet index <n> sweep` can rebind and sweep in the same step
- The dashboard now exposes the same rotate, rollback, and rebind flows through the Wallet Management drawer
- When quorum is met, Claw executes through WDK and posts the tx hash back into the same thread
- WhatsApp is still modeled in the data layer but not yet wired as a live transport

## Vercel
- Recommended live setup:
  - create a Blob store
  - set `BLOB_READ_WRITE_TOKEN`
  - deploy with the Vercel CLI or import the repo in the Vercel dashboard
- Without `BLOB_READ_WRITE_TOKEN`, the app falls back to local file storage, which is not suitable for Vercel runtime persistence

## Render
- `render.yaml` is included as an alternative deployment path with persistent disk storage

## API
- `GET/POST /api/telegram/webhook`
- `POST /api/treasury/rooms`
- `POST /api/treasury/requests`
- `POST /api/treasury/approvals`
- `POST /api/treasury/execution`
- `GET /api/treasury/export?roomId=<id>&format=json|csv`
- `GET /api/treasury/export?roomId=<id>&format=md`
- `POST /api/treasury/wallet-actions`
- `POST /api/treasury/execution/wdk`
