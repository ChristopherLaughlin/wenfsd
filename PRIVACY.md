# wenFSD — Privacy Policy

_Last updated: 2026-06-21. This is a plain-language policy for an independent project, not legal advice. Have a lawyer review it before a public launch in your jurisdiction (e.g. GDPR, CCPA, Australian Privacy Act)._

## What we collect

**If you only use the dashboard (no account link):** nothing leaves your browser. Your vehicles, update history, and settings are stored in your browser's `localStorage` on your device. We don't transmit them. Use **"Clear all my data from this device"** to erase them.

**If you connect your Tesla account (optional):** with your explicit OAuth consent we store, server-side:
- a Tesla identifier (`sub`) and email from your verified id_token,
- **encrypted** OAuth tokens (AES-256-GCM at rest) used only to read your vehicle's software version,
- your VIN(s) and decoded model/year/hardware/market,
- a history of observed software versions and timestamps for your car(s).

We request **read-only** scope (`vehicle_device_data`). We never send commands to your car. Our poller checks your car's reported software version on a schedule and **skips cars that are asleep** so it never wakes your vehicle.

## How we use it

- To predict when your car will receive its next update (the core feature).
- **Only if you explicitly opt in** (`opted_in`, default **off**): your version timestamps contribute, in aggregate, to fleet rollout statistics. You can opt out at any time.

We do not sell your data. We do not share individual vehicle data with third parties.

## Third-party data

wenFSD aggregates publicly reported fleet-firmware figures from third-party trackers (Teslascope, TeslaFi, Tessie, Tesla Updates, FleetCtrl) where permitted by their terms. We don't share your data with them.

## Your rights

- **Access / export:** request a copy of your stored data.
- **Deletion:** remove a vehicle (`DELETE /api/me/vehicle/:vin`) or your whole account and tokens (`DELETE /api/me`), or use "Clear all my data" for browser-local data.
- **Withdraw consent:** disconnect your Tesla account or toggle off contribution at any time.

## Security

OAuth tokens are encrypted at rest; transport is HTTPS; the database connection uses TLS. No system is perfectly secure — see [TERMS.md](TERMS.md).

## Contact

chrislaughlin@gmail.com
