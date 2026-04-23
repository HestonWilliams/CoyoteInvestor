import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { ChevronLeft } from "lucide-react";
import { Card, CardBody } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Badge, statusTone } from "../components/ui/Badge";
import { api } from "../lib/api";
import { fmtCurrency, fmtDate } from "../lib/utils";

interface Detail {
  distribution: {
    id: string;
    dealId: string;
    distributionDate: string;
    type: string;
    totalAmount: string;
    status: "draft" | "approved" | "paid";
    notes: string | null;
  };
  lineItems: Array<{
    item: {
      id: string;
      investorId: string;
      grossAmount: string;
      prefComponent: string;
      returnOfCapital: string;
      profitSplit: string;
      netAmount: string;
      paymentStatus: string;
      paymentMethod: string | null;
      paymentRef: string | null;
    };
    investorFullName: string | null;
    investorEmail: string | null;
  }>;
}

type Method = "check" | "ach" | "wire";

export default function DistributionDetailPage() {
  const [, params] = useRoute("/distributions/:id");
  const id = params?.id;
  const qc = useQueryClient();
  const [payOpen, setPayOpen] = useState(false);
  const [voidReason, setVoidReason] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["distribution", id],
    queryFn: () => api<Detail>(`/api/distributions/${id}`),
    enabled: !!id,
  });

  const voidM = useMutation({
    mutationFn: (reason: string) =>
      api(`/api/distributions/${id}/void`, { method: "POST", body: { reason } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["distributions"] });
      window.history.back();
    },
  });

  if (isLoading) return <div className="text-sm text-coyote-500">Loading…</div>;
  if (error) return <div className="text-sm text-red-700">{(error as Error).message}</div>;
  if (!data) return <div>Not found</div>;

  const { distribution, lineItems } = data;
  const netSum = lineItems.reduce((acc, li) => acc + Number(li.item.netAmount), 0);

  return (
    <div>
      <Link
        href="/distributions"
        className="mb-4 inline-flex items-center gap-1 text-sm text-coyote-600 hover:underline"
      >
        <ChevronLeft className="h-4 w-4" /> Back
      </Link>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-coyote-900">
            Distribution · {fmtDate(distribution.distributionDate)}
          </h1>
          <p className="text-sm text-coyote-500">
            {distribution.type} · {fmtCurrency(distribution.totalAmount)} ·{" "}
            <Badge tone={statusTone(distribution.status)}>{distribution.status}</Badge>
          </p>
        </div>
        <div className="flex gap-2">
          {distribution.status === "approved" && (
            <Button onClick={() => setPayOpen(true)}>Mark as Paid</Button>
          )}
          {distribution.status !== "paid" && (
            <Button variant="danger" onClick={() => setVoidReason("")}>
              Void
            </Button>
          )}
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-coyote-200 bg-coyote-50 text-left text-xs uppercase tracking-wide text-coyote-600">
                <th className="px-4 py-3">Investor</th>
                <th className="px-4 py-3 text-right">Gross</th>
                <th className="px-4 py-3 text-right">Pref</th>
                <th className="px-4 py-3 text-right">ROC</th>
                <th className="px-4 py-3 text-right">Profit</th>
                <th className="px-4 py-3 text-right">Net</th>
                <th className="px-4 py-3">Payment</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map(({ item, investorFullName }) => (
                <tr key={item.id} className="border-b border-coyote-100">
                  <td className="px-4 py-3">{investorFullName ?? "—"}</td>
                  <td className="px-4 py-3 text-right">{fmtCurrency(item.grossAmount)}</td>
                  <td className="px-4 py-3 text-right">{fmtCurrency(item.prefComponent)}</td>
                  <td className="px-4 py-3 text-right">{fmtCurrency(item.returnOfCapital)}</td>
                  <td className="px-4 py-3 text-right">{fmtCurrency(item.profitSplit)}</td>
                  <td className="px-4 py-3 text-right font-medium">
                    {fmtCurrency(item.netAmount)}
                  </td>
                  <td className="px-4 py-3 text-xs text-coyote-600">
                    {item.paymentMethod ? (
                      <>
                        {item.paymentMethod}
                        {item.paymentRef ? ` · ${item.paymentRef}` : ""}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
              <tr className="bg-coyote-50 text-sm font-semibold">
                <td className="px-4 py-3">Line item total</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td className="px-4 py-3 text-right">{fmtCurrency(netSum)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {payOpen && (
        <MarkPaidModal
          distributionId={distribution.id}
          lineItems={lineItems.map((li) => ({
            id: li.item.id,
            label: `${li.investorFullName ?? "—"} · ${fmtCurrency(li.item.netAmount)}`,
          }))}
          onClose={() => setPayOpen(false)}
          onDone={() => {
            setPayOpen(false);
            refetch();
            qc.invalidateQueries({ queryKey: ["distributions"] });
          }}
        />
      )}

      {voidReason !== null && (
        <Card className="mt-4 border-red-300 bg-red-50">
          <CardBody>
            <h3 className="mb-2 text-sm font-semibold text-red-800">Void this distribution?</h3>
            <p className="mb-3 text-xs text-red-800">
              Allowed only on draft/approved. Once paid, a distribution cannot be voided — issue a
              compensating distribution instead.
            </p>
            <Input
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Reason for voiding (required, min 3 chars)"
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setVoidReason(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => voidM.mutate(voidReason)}
                disabled={(voidReason ?? "").trim().length < 3 || voidM.isPending}
              >
                {voidM.isPending ? "Voiding…" : "Void"}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function MarkPaidModal({
  distributionId,
  lineItems,
  onClose,
  onDone,
}: {
  distributionId: string;
  lineItems: Array<{ id: string; label: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [payments, setPayments] = useState<
    Record<string, { method: Method; ref: string }>
  >(() =>
    Object.fromEntries(lineItems.map((li) => [li.id, { method: "ach" as Method, ref: "" }]))
  );
  const [bulkMethod, setBulkMethod] = useState<Method>("ach");
  const [error, setError] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: () =>
      api(`/api/distributions/${distributionId}/mark-paid`, {
        method: "POST",
        body: {
          payments: lineItems.map((li) => ({
            lineItemId: li.id,
            paymentMethod: payments[li.id].method,
            paymentRef: payments[li.id].ref || null,
          })),
        },
      }),
    onSuccess: onDone,
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-lg border border-coyote-200 bg-white shadow-lg">
        <div className="border-b border-coyote-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-coyote-900">Mark Distribution Paid</h2>
          <p className="mt-1 text-xs text-coyote-500">
            Recording payment writes one immutable financial_events row per non-zero component
            (pref / profit / ROC) and sends each LP a distribution notice. All writes are in a
            single DB transaction.
          </p>
        </div>

        <div className="border-b border-coyote-100 px-5 py-3 flex items-center gap-3 text-sm">
          <span className="text-coyote-600">Bulk set method:</span>
          <select
            value={bulkMethod}
            onChange={(e) => setBulkMethod(e.target.value as Method)}
            className="rounded-md border border-coyote-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="ach">ACH</option>
            <option value="wire">Wire</option>
            <option value="check">Check</option>
          </select>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setPayments((prev) =>
                Object.fromEntries(
                  Object.entries(prev).map(([k, v]) => [k, { ...v, method: bulkMethod }])
                )
              )
            }
          >
            Apply to all
          </Button>
        </div>

        <div className="divide-y divide-coyote-100">
          {lineItems.map((li) => (
            <div key={li.id} className="grid grid-cols-1 gap-2 px-5 py-3 sm:grid-cols-12 sm:items-center">
              <div className="text-sm sm:col-span-5">{li.label}</div>
              <div className="sm:col-span-3">
                <select
                  value={payments[li.id].method}
                  onChange={(e) =>
                    setPayments({
                      ...payments,
                      [li.id]: { ...payments[li.id], method: e.target.value as Method },
                    })
                  }
                  className="w-full rounded-md border border-coyote-300 bg-white px-2 py-1.5 text-sm"
                >
                  <option value="ach">ACH</option>
                  <option value="wire">Wire</option>
                  <option value="check">Check</option>
                </select>
              </div>
              <div className="sm:col-span-4">
                <Input
                  placeholder="Reference #"
                  value={payments[li.id].ref}
                  onChange={(e) =>
                    setPayments({
                      ...payments,
                      [li.id]: { ...payments[li.id], ref: e.target.value },
                    })
                  }
                />
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div className="px-5 pt-3 text-sm text-red-700">{error}</div>
        )}

        <div className="flex justify-end gap-2 border-t border-coyote-200 px-5 py-4">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending}>
            {m.isPending ? "Posting…" : "Confirm Payments"}
          </Button>
        </div>
      </div>
    </div>
  );
}
