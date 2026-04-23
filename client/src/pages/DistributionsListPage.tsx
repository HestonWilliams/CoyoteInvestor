import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Plus } from "lucide-react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge, statusTone } from "../components/ui/Badge";
import { api } from "../lib/api";
import { fmtCurrency, fmtDate } from "../lib/utils";

interface Row {
  distribution: {
    id: string;
    dealId: string;
    distributionDate: string;
    type: string;
    totalAmount: string;
    status: string;
    createdAt: string;
  };
  dealName: string | null;
}

export default function DistributionsListPage() {
  const [, navigate] = useLocation();
  const { data: rows, isLoading } = useQuery({
    queryKey: ["distributions"],
    queryFn: () => api<Row[]>("/api/distributions"),
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-coyote-900">Distributions</h1>
          <p className="text-sm text-coyote-500">Waterfall-driven LP disbursements</p>
        </div>
        <Button onClick={() => navigate("/distributions/new")}>
          <Plus className="h-4 w-4" /> New Distribution
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-coyote-500">Loading…</div>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-coyote-200 bg-coyote-50 text-left text-xs uppercase tracking-wide text-coyote-600">
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Deal</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3 text-right">Total</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((r) => (
                  <tr key={r.distribution.id} className="border-b border-coyote-100 hover:bg-coyote-50/50">
                    <td className="px-5 py-3">{fmtDate(r.distribution.distributionDate)}</td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/distributions/${r.distribution.id}`}
                        className="font-medium text-coyote-800 hover:underline"
                      >
                        {r.dealName ?? "—"}
                      </Link>
                    </td>
                    <td className="px-5 py-3">{r.distribution.type}</td>
                    <td className="px-5 py-3 text-right">{fmtCurrency(r.distribution.totalAmount)}</td>
                    <td className="px-5 py-3">
                      <Badge tone={statusTone(r.distribution.status)}>
                        {r.distribution.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {(rows ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-coyote-500">
                      No distributions yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
