// One-time: register your domain with Tesla so it trusts your app.
//   npm run register-domain            (uses PUBLIC_BASE_URL's host)
//   npm run register-domain wenfsd.info
// Requires real-mode env (TESLA_CLIENT_ID/SECRET) and your public key reachable at
// https://<domain>/.well-known/appspecific/com.tesla.3p.public-key.pem
import { registerPartnerDomain } from "./tesla.js";
import { config } from "./config.js";

const domain = process.argv[2] || new URL(config.publicBaseUrl).host;
registerPartnerDomain(domain)
  .then((r) => { console.log(`✓ registered ${domain} with Tesla:`, JSON.stringify(r)); process.exit(0); })
  .catch((e) => { console.error(`✗ failed to register ${domain}:`, e.message); process.exit(1); });
