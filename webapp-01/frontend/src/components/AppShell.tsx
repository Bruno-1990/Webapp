import { Suspense } from "react";
import { Link, Outlet } from "react-router-dom";

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
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-brand-mid/20 bg-white shadow-[0_1px_0_0_rgb(68_127_152/0.08)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link
            to="/"
            className="font-display text-lg font-bold tracking-tight text-[#183844] sm:text-xl"
          >
            Central de conversões
          </Link>
          <nav className="flex items-center gap-3 text-sm font-medium">
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
