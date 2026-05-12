import { Suspense } from "react";
import { Link, Outlet, useLocation, useSearchParams } from "react-router-dom";

const CATEGORY_TABS = [
  { id: "fiscal", label: "Fiscal" },
  { id: "contabil", label: "Contábil" },
] as const;

type TabId = (typeof CATEGORY_TABS)[number]["id"];

function HubCategoryTabs() {
  const [params, setParams] = useSearchParams();
  const active = (params.get("cat") as TabId) ?? "fiscal";

  const select = (id: TabId) => {
    const next = new URLSearchParams(params);
    if (id === "fiscal") next.delete("cat");
    else next.set("cat", id);
    setParams(next, { replace: true });
  };

  return (
    <div
      role="tablist"
      aria-label="Categoria de ferramentas"
      className="flex items-center gap-2 text-[13px] font-medium tracking-tight sm:text-sm"
    >
      {CATEGORY_TABS.map((tab, idx) => {
        const isActive = active === tab.id;
        return (
          <span key={tab.id} className="flex items-center gap-2">
            {idx > 0 && (
              <span aria-hidden className="text-[#cfdde4]">
                |
              </span>
            )}
            <button
              role="tab"
              type="button"
              aria-selected={isActive}
              onClick={() => select(tab.id)}
              className={`relative px-0.5 py-1 transition-colors duration-200 focus-visible:outline-none ${
                isActive
                  ? "font-semibold text-[#347891]"
                  : "text-[#7a96a4] hover:text-[#347891]"
              }`}
            >
              {tab.label}
              <span
                aria-hidden
                className={`pointer-events-none absolute inset-x-0 -bottom-0.5 h-[2px] rounded-full bg-[#347891] transition-opacity duration-200 ${
                  isActive ? "opacity-100" : "opacity-0"
                }`}
              />
            </button>
          </span>
        );
      })}
    </div>
  );
}

function OutletFallback() {
  return (
    <div
      className="flex min-h-[45vh] items-center justify-center text-sm text-[#2a4f60]"
      aria-busy="true"
    >
      Carregando…
    </div>
  );
}

export default function AppShell() {
  const location = useLocation();
  const isHub = location.pathname === "/";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-brand-mid/20 bg-white shadow-[0_1px_0_0_rgb(68_127_152/0.08)]">
        <div className="mx-auto grid max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 py-3 sm:px-6">
          <Link
            to="/"
            className="justify-self-start font-display text-lg font-bold tracking-tight text-[#183844] sm:text-xl"
          >
            Central de conversões
          </Link>

          <div className="justify-self-center">
            {isHub && <HubCategoryTabs />}
          </div>

          <nav className="justify-self-end flex items-center gap-3 text-sm font-medium">
            <Link
              to="/"
              className="rounded-lg px-3 py-1.5 font-semibold text-[#183844] transition hover:bg-[#b9d8e1]/50 hover:text-[#447f98]"
            >
              Início
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6">
        <Suspense fallback={<OutletFallback />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
