import { useQuery } from "@tanstack/react-query";
import { Card, CardBody } from "../components/ui/Card";
import { api } from "../lib/api";
import { fmtCurrency } from "../lib/utils";

interface Summary {
  totalDeals: number;
  activeDeals: number;
  fundraisingDeals: number;
  exitedDeals: number;
  totalAssetValue: string;
  totalLoanBalance: string;
  totalEquityRaised: string;
  totalInvestors: number;
  totalDistributionsYtd: string;
}

function KpiCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardBody>
        <div className="text-xs uppercase tracking-wide text-coyote-500">{label}</div>
        <div className="mt-1 text-2xl font-semibold text-coyote-900">{value}</div>
        {sub && <div className="mt-1 text-xs text-coyote-500">{sub}</div>}
      </CardBody>
    </Card>
  );
}

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: () => api<Summary>("/api/dashboard/summary"),
  });

  const ltv =
    data && Number(data.totalAssetValue) > 0
      ? `${((Number(data.totalLoanBalance) / Number(data.totalAssetValue)) * 100).toFixed(1)}%`
      : "—";

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-coyote-900">Portfolio Dashboard</h1>
        <p className="text-sm text-coyote-500">GP view — Coyote Equity LLC</p>
      </div>

      {isLoading || !data ? (
        <div className="text-sm text-coyote-500">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Total AUM" value={fmtCurrency(data.totalAssetValue)} />
            <KpiCard label="Equity Deployed" value={fmtCurrency(data.totalEquityRaised)} />
            <KpiCard
              label="Active Deals"
              value={String(data.activeDeals)}
              sub={`${data.fundraisingDeals} fundraising · ${data.exitedDeals} exited`}
            />
            <KpiCard label="Total Investors" value={String(data.totalInvestors)} />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard label="Total Asset Value" value={fmtCurrency(data.totalAssetValue)} />
            <KpiCard label="Total Loan Balance" value={fmtCurrency(data.totalLoanBalance)} />
            <KpiCard label="Blended LTV" value={ltv} />
          </div>
          <div className="mt-4">
            <KpiCard
              label="Distributions Paid YTD"
              value={fmtCurrency(data.totalDistributionsYtd)}
            />
          </div>
        </>
      )}
    </div>
  );
}
