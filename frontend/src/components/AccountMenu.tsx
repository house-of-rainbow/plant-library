import { useState, useRef, useEffect } from "react";
import { useMsal } from "@azure/msal-react";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "react-router-dom";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Enterprise-style signed-in account chip with a sign-out menu.
 * Only mounted when auth is enabled (rendered under MsalProvider).
 */
export default function AccountMenu() {
  const { instance, accounts } = useMsal();
  const account = instance.getActiveAccount() ?? accounts[0];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (!account) return null;

  const displayName = account.name || account.username || "Account";
  const email = account.username || "";
  const initials = initialsOf(displayName);

  const signOut = () => {
    void instance.logoutRedirect({ account });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 pl-1 pr-3 py-1 transition-colors"
        title={email}
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-canopy-500 text-canopy-950 text-xs font-bold">
          {initials}
        </span>
        <span className="hidden sm:block max-w-[10rem] truncate text-sm text-white/80">
          {displayName}
        </span>
        <span className="text-white/40 text-xs">▾</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-64 glass p-3 z-40"
          >
            <div className="flex items-center gap-3 px-2 py-2">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-canopy-500 text-canopy-950 text-sm font-bold">
                {initials}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{displayName}</div>
                <div className="truncate text-xs text-white/50">{email}</div>
              </div>
            </div>
            <div className="my-2 h-px bg-white/10" />
            <Link
              to="/tokens"
              onClick={() => setOpen(false)}
              className="block w-full text-left rounded-xl px-3 py-2 text-sm text-white/80 hover:bg-white/10 transition-colors"
            >
              Key Personal Access Tokens
            </Link>
            <button
              onClick={signOut}
              className="w-full text-left rounded-xl px-3 py-2 text-sm text-white/80 hover:bg-white/10 transition-colors"
            >
              ↪ Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
