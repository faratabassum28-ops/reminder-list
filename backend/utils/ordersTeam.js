import User from "../models/User.js";
import orders from "../orders/index.js";

// Order Analytics keeps a mirror of the people who may use it (so every action and assignment can name a person).
// The Users page is the only place they are managed; whenever accounts change we bring the mirror in line.
// Calls arriving close together (editing several users) are merged into one.
let timer = null;
let running = false;
let again = false;

export function syncOrdersTeam({ delayMs = 800 } = {}) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (running) { again = true; return; }
    running = true;
    try {
      const users = await User.find().select("-passwordHash").lean();
      const r = await orders.syncTeam(users);
      if (r.upserted || r.switchedOff) console.log(`[orders] team synced (${r.upserted} on, ${r.switchedOff} switched off)`);
    } catch (e) {
      console.warn("[orders] team sync failed:", e.message);
    } finally {
      running = false;
      if (again) { again = false; syncOrdersTeam({ delayMs: 300 }); }
    }
  }, delayMs);
  timer.unref?.();
}
