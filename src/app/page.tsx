import { TreasuryDashboard } from "@/components/treasury-dashboard";
import { loadTreasuryDashboard } from "@/lib/treasury";
import { loadTreasuryWdkRuntime } from "@/lib/wdk";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { rooms } = await loadTreasuryDashboard();
  const wdk = loadTreasuryWdkRuntime();

  return <TreasuryDashboard rooms={rooms} wdk={wdk} />;
}
