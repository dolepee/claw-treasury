type Props = {
  children: React.ReactNode;
};

const navItems = [
  { href: "#command-center", label: "Command Center" },
  { href: "#agent-feed", label: "Agent Feed" },
  { href: "#reserves", label: "Proof of Reserve" },
  { href: "#rooms", label: "Rooms" },
];

export function AppShell({ children }: Props) {
  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-emerald-300 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-black"
      >
        Skip to content
      </a>

      <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col px-4 pb-12 pt-5 sm:px-6 lg:px-8">
        <header className="ct-panel sticky top-4 z-40 mb-6 px-5 py-4 sm:px-6">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(57,231,197,0.18),transparent_34%),radial-gradient(circle_at_84%_18%,rgba(24,197,173,0.24),transparent_26%)]" />

          <div className="relative flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid h-12 w-12 place-items-center rounded-2xl border border-emerald-300/25 bg-emerald-300/10 font-mono text-sm font-semibold tracking-[0.38em] text-emerald-200 shadow-[0_0_35px_rgba(57,231,197,0.2)]">
                CT
              </div>
              <div className="space-y-1">
                <div className="ct-label text-[0.68rem]">Tether WDK Hackathon Build</div>
                <h1 className="text-xl font-semibold text-white sm:text-2xl">ClawTreasury</h1>
                <p className="max-w-2xl text-sm text-zinc-400">
                  Mission-control treasury cockpit where Claw manages non-custodial USDT operations through modular Tether WDK wallets.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 xl:items-end">
              <div className="flex flex-wrap gap-2">
                <span className="ct-chip">
                  <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(57,231,197,0.95)]" />
                  Agent online
                </span>
                <span className="ct-chip">WDK non-custodial</span>
                <span className="ct-chip">USD₮ on Plasma</span>
              </div>

              <nav className="flex flex-wrap gap-2 text-sm text-zinc-400">
                {navItems.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className="rounded-full border border-transparent px-3 py-2 transition hover:border-white/10 hover:bg-white/[0.05] hover:text-white"
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            </div>
          </div>
        </header>

        <main id="main-content" className="flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
