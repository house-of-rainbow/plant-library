import { NavLink, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import AmbientScene from "../three/AmbientScene";
import AccountMenu from "./AccountMenu";
import TenantSwitcher from "./TenantSwitcher";
import { appConfig } from "../config";
import { useTenant } from "../tenant/TenantContext";

const BASE_NAV = [
  { to: "/", label: "Dashboard", icon: "◎", end: true },
  { to: "/species", label: "Species", icon: "❦" },
  { to: "/plants", label: "Plants", icon: "🌿" },
  { to: "/groups", label: "Groups", icon: "🏷️" },
  { to: "/ops", label: "Operations", icon: "📱" },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const isScan = location.pathname.startsWith("/scan");
  const { isOwner } = useTenant();

  const NAV = isOwner
    ? [...BASE_NAV, { to: "/members", label: "Members", icon: "👥" }]
    : BASE_NAV;

  return (
    <div className="min-h-full">
      <AmbientScene />

      {!isScan && (
        <header className="sticky top-0 z-30 px-4 sm:px-8 py-4">
          <div className="glass mx-auto max-w-7xl px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-2xl hidden sm:block">🪴</span>
              <TenantSwitcher />
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <nav className="hidden sm:flex items-center gap-1">
                {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `relative px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                      isActive ? "text-canopy-950" : "text-white/70 hover:text-white"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <motion.span
                          layoutId="nav-pill"
                          className="absolute inset-0 rounded-full bg-canopy-400 shadow-glow"
                          transition={{ type: "spring", stiffness: 400, damping: 32 }}
                        />
                      )}
                      <span className="relative z-10">{item.label}</span>
                    </>
                  )}
                </NavLink>
              ))}
              </nav>
              {!appConfig.authDisabled && <AccountMenu />}
            </div>
          </div>
        </header>
      )}

      <main className={isScan ? "" : "px-4 sm:px-8 pb-28 sm:pb-12 pt-4"}>
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>

      {/* Mobile bottom nav */}
      {!isScan && (
        <nav className="sm:hidden fixed bottom-0 inset-x-0 z-30 px-4 pb-4">
          <div className="glass flex items-center justify-around py-2">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-2xl text-[11px] ${
                    isActive ? "text-canopy-300" : "text-white/60"
                  }`
                }
              >
                <span className="text-lg">{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
