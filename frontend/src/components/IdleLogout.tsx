import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "./Toast";

const IDLE_LIMIT_MS = 20 * 60 * 1000;
const ACTIVITY_EVENTS = ["mousedown", "mousemove", "keydown", "wheel", "touchstart", "scroll"] as const;

/** Signs the user out after 20 minutes with no mouse/keyboard/touch/scroll activity. */
export function IdleLogout() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user) return;

    function handleIdle() {
      logout();
      toast("Signed out after 20 minutes of inactivity.");
      navigate("/login", { replace: true });
    }

    function resetTimer() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(handleIdle, IDLE_LIMIT_MS);
    }

    resetTimer();
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, resetTimer, { passive: true }));

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, resetTimer));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.userId]);

  return null;
}
