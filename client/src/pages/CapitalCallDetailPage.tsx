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
  call: {
    id: string;
    dealId: string;
    callDate: string;
    dueDate: string | null;
    totalCalled: string;
    totalReceived: string;
    status: "open" | "closed";
    notes: string | null;
  };
  responses: Array<{
    response: {
      id: string;
      investorId: string;
      amountCalled: string;
      amountReceived: string;
      receivedAt: string | null;
      paymentMethod: string | null;
    };
    investorFullName: string | null;
    investorEmail: string | null;
  }>;
}

type Method = "check" | "ach" | "wire";

export default function CapitalCallDetailPage() {
  const [, params] = useRoute("/capital-calls/:id");
  const id = params?.id;
  const qc = useQueryClient();
  const [receiptFor, setReceiptFor] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["capital-call", id],
    queryFn: () => api<Detail>(`/api/capital-calls/${id}`),
    enabled: !!id,
  });

  const closeM = useMutation({
    mutationFn: () => api(`/api/capital-calls/${id}/close`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["capital-calls"] });
      refetch();
    },
  });

  if (isLoading) return <div className="text-sm text-coyote-500">Loading…</div>;
  if (!data) return <div>Not found</div>;

  const { call, responses } = data;

  return (
    <div>
      <Link
        href="/capital-calls"
        className="mb-4 inline-flex items-center gap-1 text-sm text-coyote-600 hover:underline"
      >
        <ChevronLeft className="h-4 w-4" /> Back
      </Link>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-coyote-900">
            Capital Call · {fmtDate(call.callDate)}
          </h1>
          <p className="text-sm text-coyote-500">
            Called {fmtCurrency(call.totalCalled)} · Received {fmtCurrency(call.totalReceived)} ·{" "}
            <Badge tone={statusTone(call.status)}>{call.status}</Badge>
          </p>
        </div>
        {call.status === "open" && (
          <Button variant="secondary" onClick={() => closeM.mutate()} disabled={closeM.isPending}>
            {closeM.isPending ? "Closing…" : "Close Call"}
          </Button>
        )}
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-coyote-200 bg-coyote-50 text-left text-xs uppercase tracking-wide text-coyote-600">
                <th className="px-4 py-3">Investor</th>
                <th className="px-4 py-3 text-right">Called</th>
                <th className="px-4 py-3 text-right">Received</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Received At</th>
                <th className="px-4 py-3 w-32"></th>
              </tr>
            </thead>
            <tbody>
              {responses.map(({ response, investorFullName }) => {
                const outstanding =
                  Number(response.amountCalled) - Number(response.amountReceived);
                return (
                  <tr key={response.id} className="border-b border-coyote-100">
                    <td className="px-4 py-3">{investorFullName ?? "—"}</td>
                    <td className="px-4 py-3 text-right">{fmtCurrency(response.amountCalled)}</td>
                    <td className="px-4 py-3 text-right">{fmtCurrency(response.amountReceived)}</td>
                    <td className="px-4 py-3">{response.paymentMethod ?? "—"}</td>
                    <td className="px-4 py-3 text-coyote-600">{fmtDate(response.receivedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {call.status === "open" && outstanding > 0 && (
                        <button
                          className="text-xs text-coyote-700 hover:underline"
                          onClick={() => setReceiptFor(response.id)}
                        >
                          Mark received
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {receiptFor && (
        <ReceiptModal
          callId={call.id}
          responseId={receiptFor}
          defaultAmount={
            responses.find((r) => r.response.id === receiptFor)!.response.amountCalled
          }
          onClose={() => setReceiptFor(null)}
          onDone={() => {
            setReceiptFor(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}

function ReceiptModal({
  callId,
  responseId,
  defaultAmount,
  onClose,
  onDone,
}: {
  callId: string;
  responseId: string;
  defaultAmount: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(defaultAmount);
  const [method, setMethod] = useState<Method>("ach");
  const [ref, setRef] = useState("");
  const [receivedAt, setReceivedAt] = useState(() => new Date().toISOString());
  const [error, setError] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: () =>
      api(`/api/capital-calls/${callId}/receipts`, {
        method: "POST",
        body: {
          responseId,
          amountReceived: amount,
          receivedAt,
          paymentMethod: method,
          paymentRef: ref || null,
        },
      }),
    onSuccess: onDone,
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-lg border border-coyote-200 bg-white shadow-lg">
        <div className="border-b border-coyote-200 px-5 py-4">
          <h2 className="text-lg font-semibold">Record Receipt</h2>
          <p className="mt-1 text-xs text-coyote-500">
            Posts a <code>capital_funded</code> event to the immutable ledger and bumps the
            position's funded_amount — all in one transaction.
          </p>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-coyote-700">Amount</label>
            <Input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-coyote-700">Method</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as Method)}
                className="w-full rounded-md border border-coyote-300 bg-white px-3 py-2 text-sm"
              >
                <option value="ach">ACH</option>
                <option value="wire">Wire</option>
                <option value="check">Check</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-coyote-700">Reference #</label>
              <Input value={ref} onChange={(e) => setRef(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-coyote-700">Received at</label>
            <Input
              type="datetime-local"
              value={receivedAt.slice(0, 16)}
              onChange={(e) => setReceivedAt(new Date(e.target.value).toISOString())}
            />
          </div>
          {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-coyote-200 px-5 py-4">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending}>
            {m.isPending ? "Posting…" : "Record"}
          </Button>
        </div>
      </div>
    </div>
  );
}
