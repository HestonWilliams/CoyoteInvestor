import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Plus } from "lucide-react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge, statusTone } from "../components/ui/Badge";
import { api } from "../lib/api";
import { fmtCurrency, fmtDate } from "../lib/utils";

interface Row {
  call: {
    id: string;
    callDate: string;
    dueDate: string | null;
    totalCalled: string;
    totalReceived: string;
    status: string;
  };
  dealName: string | null;
}

export default function CapitalCallsListPage() {
  const [, navigate] = useLocation();
  const { data: rows, isLoading } = useQuery({
    queryKey: ["capital-calls"],
    queryFn: () => api<Row[]>("/api/capital-calls"),
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-coyote-900">Capital Calls</h1>
          <p className="text-sm text-coyote-500">Pro-rata LP funding notices</p>
        </div>
        <Button onClick={() => navigate("/capital-calls/new")}>
          <Plus className="h-4 w-4" /> New Capital Call
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
                  <th className="px-5 py-3">Call Date</th>
                  <th className="px-5 py-3">Deal</th>
                  <th className="px-5 py-3">Due</th>
                  <th className="px-5 py-3 text-right">Called</th>
                  <th className="px-5 py-3 text-right">Received</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((r) => (
                  <tr key={r.call.id} className="border-b border-coyote-100 hover:bg-coyote-50/50">
                    <td className="px-5 py-3">{fmtDate(r.call.callDate)}</td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/capital-calls/${r.call.id}`}
                        className="font-medium text-coyote-800 hover:underline"
                      >
                        {r.dealName ?? "—"}
                      </Link>
                    </td>
                    <td className="px-5 py-3">{fmtDate(r.call.dueDate)}</td>
                    <td className="px-5 py-3 text-right">{fmtCurrency(r.call.totalCalled)}</td>
                    <td className="px-5 py-3 text-right">{fmtCurrency(r.call.totalReceived)}</td>
                    <td className="px-5 py-3">
                      <Badge tone={statusTone(r.call.status)}>{r.call.status}</Badge>
                    </td>
                  </tr>
                ))}
                {(rows ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-coyote-500">
                      No capital calls yet.
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
