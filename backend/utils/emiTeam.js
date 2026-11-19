import User from "../models/User.js";
import emi from "../emi/index.js";

// EMI Manager keeps a mirror of the people who may use it (so every payment, call and edit can name a person).
// The Users page is the only place they are managed; whenever accounts change we bring the mirror in line.
// Calls arriving close together (editing several users) are merged into one.
let timer = null;
let running = false;
let again = false;

export function syncEmiTeam({ delayMs = 800 } = {}) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (running) { again = true; return; }
    running = true;
    try {
      const users = await User.find().select("-passwordHash").lean();
      const r = await emi.syncTeam(users);
      if (r.upserted || r.switchedOff) console.log(`[emi] team synced (${r.upserted} on, ${r.switchedOff} switched off)`);
    } catch (e) {
      console.warn("[emi] team sync failed:", e.message);
    } finally {
      running = false;
      if (again) { again = false; syncEmiTeam({ delayMs: 300 }); }
    }
  }, delayMs);
  timer.unref?.();
}
