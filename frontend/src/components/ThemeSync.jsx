import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { api } from "../api.js";
import SchoolBrand from "./SchoolLogo.jsx";
import "./themeSync.css";

// Keeps each person's light/dark choice on their ACCOUNT (so it follows them to every phone and computer) and asks the question
// exactly once: the first time someone signs in without a saved choice, a full-screen "Light or dark?" card appears.
//   user.theme === null       -> never asked: show the card
//   user.theme === undefined  -> an old cached profile that has not refreshed yet: wait, don't nag
//   "light" | "dark"          -> apply it on sign-in, and save every later switch made with any Light/Dark button in any app.
export default function ThemeSync() {
  const { user, updateProfile } = useAuth();
  const { theme, setTheme } = useTheme();
  const saved = useRef(null); // what the server last confirmed for this account
  const [pick, setPick] = useState("dark");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const userId = user?.id;
  const userTheme = user?.theme;

  // New sign-in (or the profile refreshed): the account's choice wins over whatever this browser had.
  useEffect(() => {
    saved.current = userTheme === "light" || userTheme === "dark" ? userTheme : null;
    if (saved.current) setTheme(saved.current);
  }, [userId, userTheme]); // eslint-disable-line react-hooks/exhaustive-deps

  // A switch made after that (any app's Light/Dark button) is saved to the account.
  useEffect(() => {
    if (!userId || !saved.current || theme === saved.current) return;
    const next = theme;
    saved.current = next;
    api.setMyTheme(next).then(() => updateProfile({ theme: next })).catch(() => {});
  }, [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user || userTheme !== null) return null;

  // Preview live: choosing a card re-themes the whole app behind the dialog straight away.
  const choose = (t) => { setPick(t); setTheme(t); };
  const confirm = async () => {
    setSaving(true); setError("");
    try {
      await api.setMyTheme(pick);
      saved.current = pick;
      updateProfile({ theme: pick });
    } catch (e) {
      setError(e.message || "Couldn't save that. Please try again.");
      setSaving(false);
    }
  };
  const first = (user.name || "").split(" ")[0];

  return (
    <div className="ts-scrim" role="dialog" aria-modal="true" aria-labelledby="ts-title">
      <div className="ts-card">
        <SchoolBrand size={34} tone={pick === "dark" ? "dark" : "light"} />
        <h2 id="ts-title">{first ? `${first}, how` : "How"} do you like to see things?</h2>
        <p className="ts-sub">Pick the look you prefer. We'll remember it on every device you sign in from. You can change it any time with the Light / Dark button.</p>
        <div className="ts-options">
          {[["dark", "Dark mode", "Easy on the eyes, great in the evening"], ["light", "Light mode", "Bright and crisp, great in daylight"]].map(([id, title, hint]) => (
            <button key={id} type="button" className={"ts-opt" + (pick === id ? " ts-opt-on" : "")} aria-pressed={pick === id} onClick={() => choose(id)}>
              <span className={"ts-preview ts-preview-" + id} aria-hidden="true">
                <i /><i /><i />
              </span>
              <span className="ts-opt-title">{id === "dark" ? "☾" : "☀"} {title}</span>
              <span className="ts-opt-hint">{hint}</span>
            </button>
          ))}
        </div>
        {error && <p className="ts-error">{error}</p>}
        <button type="button" className="ts-go" disabled={saving} onClick={confirm}>{saving ? "Saving…" : `Continue in ${pick} mode`}</button>
      </div>
    </div>
  );
}
