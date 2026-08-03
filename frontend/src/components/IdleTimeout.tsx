import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";

/**
 * Signs a user out after a period of inactivity.
 *
 * The session token itself lasts 8 hours regardless of what the user is doing,
 * so a laptop left open at a client site or a coffee shop kept full access to
 * every client's records, SSNs and bank details for the rest of the working
 * day. Tying the session to actual use is the control an insurer or a client's
 * security questionnaire will ask about, and it costs the user nothing when
 * they are actually working.
 *
 * A warning is shown before the sign-out rather than dropping them silently
 * mid-sentence — losing unsaved work would train people to resent the control
 * and look for ways around it.
 */
const IDLE_MINUTES = 30;
const WARNING_SECONDS = 120;

/**
 * Deliberately NOT mousemove: it fires continuously and would keep a session
 * alive from a cat on the keyboard or a jittery trackpad. These are all
 * deliberate acts.
 */
const ACTIVITY_EVENTS = ["mousedown", "keydown", "scroll", "touchstart", "wheel"] as const;

export function IdleTimeout() {
  const { user, logout } = useAuth();
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const idleTimer = useRef<number | null>(null);
  const countdownTimer = useRef<number | null>(null);
  /**
   * Mirrors `secondsLeft` for the activity listener to read.
   *
   * The listener is registered once and must not be re-registered when the
   * warning appears — an earlier version put `secondsLeft === null` in the
   * effect's dependencies, so showing the warning re-ran the effect, which
   * called resetIdle() and cancelled the warning in the same tick. It never
   * appeared at all. A ref keeps the listener stable while still letting it see
   * the current state.
   */
  const warningActive = useRef(false);
  const idleDeadline = useRef(0);

  const clearTimers = useCallback(() => {
    if (idleTimer.current) window.clearInterval(idleTimer.current);
    if (countdownTimer.current) window.clearInterval(countdownTimer.current);
    idleTimer.current = null;
    countdownTimer.current = null;
  }, []);

  /**
   * Counts down against an absolute deadline rather than by decrementing a
   * number each tick.
   *
   * Browsers throttle timers in hidden or backgrounded tabs — often to once a
   * minute — so a tick-counting countdown stretches a 2-minute warning into
   * many minutes on exactly the unattended laptop this is meant to protect.
   * Reading the clock means a throttled tab simply notices it is already past
   * the deadline and signs out immediately, and the visible countdown stays
   * truthful whenever the tab is awake.
   */
  const beginCountdown = useCallback(() => {
    warningActive.current = true;
    const deadline = Date.now() + WARNING_SECONDS * 1000;
    setSecondsLeft(WARNING_SECONDS);
    countdownTimer.current = window.setInterval(() => {
      const remaining = Math.ceil((deadline - Date.now()) / 1000);
      if (remaining <= 0) {
        clearTimers();
        warningActive.current = false;
        setSecondsLeft(null);
        logout();
        return;
      }
      setSecondsLeft(remaining);
    }, 250);
  }, [clearTimers, logout]);

  const resetIdle = useCallback(() => {
    clearTimers();
    warningActive.current = false;
    setSecondsLeft(null);
    idleDeadline.current = Date.now() + IDLE_MINUTES * 60 * 1000;
    // Polled against the clock rather than a single long setTimeout, so a tab
    // that was asleep past the deadline is caught on its very next tick.
    idleTimer.current = window.setInterval(() => {
      if (!warningActive.current && Date.now() >= idleDeadline.current) {
        window.clearInterval(idleTimer.current!);
        idleTimer.current = null;
        beginCountdown();
      }
    }, 1000);
  }, [beginCountdown, clearTimers]);

  useEffect(() => {
    if (!user) {
      clearTimers();
      setSecondsLeft(null);
      return;
    }

    resetIdle();

    // Once the warning is up, ordinary activity must NOT dismiss it — otherwise
    // a stray scroll from a passer-by would silently extend the session, which
    // is exactly the situation this guards against. Only the explicit button does.
    function onActivity() {
      if (!warningActive.current) resetIdle();
    }

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, onActivity, { passive: true });
    }
    return () => {
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, onActivity);
      clearTimers();
    };
  }, [user, resetIdle, clearTimers]);

  if (!user || secondsLeft === null) return null;

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;

  return (
    <div className="modal-overlay">
      <div className="modal-panel" role="alertdialog" aria-modal="true" aria-labelledby="idle-title" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="idle-title">Still there?</h2>
        </div>
        <p className="muted" style={{ padding: "8px 0" }}>
          You have been inactive for {IDLE_MINUTES} minutes. For the security of client records, you will be signed
          out in{" "}
          <strong style={{ color: "var(--ink)" }}>
            {mins}:{String(secs).padStart(2, "0")}
          </strong>
          .
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-primary" onClick={resetIdle} autoFocus>
            Stay signed in
          </button>
          <button type="button" className="btn" onClick={() => { clearTimers(); logout(); }}>
            Sign out now
          </button>
        </div>
      </div>
    </div>
  );
}
