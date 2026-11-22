// Session hygiene shared by server.js (and unit-tested on its own, since server.js listens on import).
import { config } from "./config.js";

// Mock/sample mode and real mode use DIFFERENT cookie names, so a session issued while the server
// is serving sample data is never even read once it is running against real accounts.
export function sessionCookieName(mockMode = config.mockMode) { return mockMode ? "wenfsd_mock" : "wenfsd"; }

// Real mode only accepts sessions established by the Tesla OAuth callback. Anything flagged `mock`,
// or carrying a userId that isn't a positive integer (mock sessions use the string "mock"), is
// dropped before any route sees it. Mode is read per request so a degraded boot is covered too.
export function rejectMockSession(req, res, next) {
  const s = req.session;
  if (!config.mockMode && s && (s.mock || (s.userId != null && !(Number.isInteger(s.userId) && s.userId > 0)))) {
    req.session = null;   // clears the cookie; the request continues as signed-out
  }
  next();
}
