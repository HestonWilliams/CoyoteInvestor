import { useMemo, useState } from "react";
import Decimal from "decimal.js";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { ChevronLeft } from "lucide-react";
import { Card, CardBody } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input, Label, Textarea } from "../components/ui/Input";
import { api } from "../lib/api";
import { fmtCurrency } from "../lib/utils";

/**
 * 2-step capital call wizard (PRD §5.3 + Phase 2 checklist):
 *   1. Deal + call details (date, due date, total, notes)
 *   2. Per-investor pro-rata preview (computed client-side from positions);
 *      Send → POST /api/capital-calls → backend recomputes server-side
 *      (source of truth) and sends Resend notices.
 */

interface Deal {
  id: string;
  name: string;
  status: string;
}

interface DealDetail {
  positions: Array<{
    position: {
      id: string;
      investorId: string;
      committedAmount: string;
      fundedAmount: string;
    };
    investorFullName: string | null;
    investorEntityName: string | null;
  }>;
}

type Step = 1 | 2;

export default function CapitalCallWizardPage() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState<Step>(1);
  const [dealId, setDealId] = useState("");
  const [callDate, setCallDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [amountTotal, setAmountTotal] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: deals } = useQuery({
    queryKey: ["deals"],
    queryFn: () => api<Deal[]>("/api/deals"),
  });
  const { data: detail } = useQuery({
    queryKey: ["deals", dealId],
    queryFn: () => api<DealDetail>(`/api/deals/${dealId}`),
    enabled: !!dealId && step >= 2,
  });

  const preview = useMemo(() => {
    if (!detail || !amountTotal) return [];
    const totalCommitted = detail.positions.reduce(
      (acc, r) => acc.plus(new Decimal(r.position.committedAmount ?? 0)),
      new Decimal(0)
    );
    if (totalCommitted.lte(0)) return [];
    const total = new Decimal(amountTotal);
    return detail.positions.map((r) => {
      const committed = new Decimal(r.position.committedAmount ?? 0);
      return {
        investorFullName: r.investorFullName,
        investorEntityName: r.investorEntityName,
        committed: committed.toFixed(2),
        prorataPct: committed.div(totalCommitted).mul(100).toFixed(2),
        amountDue: total
          .mul(committed)
          .div(totalCommitted)
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
          .toFixed(2),
      };
    });
  }, [detail, amountTotal]);

  const sendM = useMutation({
    mutationFn: () =>
      api<{ call: { id: string } }>("/api/capital-calls", {
        method: "POST",
        body: {
          dealId,
          callDate,
          dueDate: dueDate || null,
          amountTotal,
          notes: notes || null,
        },
      }),
    onSuccess: (r) => navigate(`/capital-calls/${r.call.id}`),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div>
      <Link
        href="/capital-calls"
        className="mb-4 inline-flex items-center gap-1 text-sm text-coyote-600 hover:underline"
      >
        <ChevronLeft className="h-4 w-4" /> Back
      </Link>
      <h1 className="mb-1 text-2xl font-semibold text-coyote-900">New Capital Call</h1>
      <p className="mb-5 text-sm text-coyote-500">
        Step {step} of 2 · {step === 1 ? "Details" : "Preview"}
      </p>

      {error && (
        <div className="my-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {step === 1 && (
        <Card>
          <CardBody>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="deal">Deal</Label>
                <select
                  id="deal"
                  value={dealId}
                  onChange={(e) => setDealId(e.target.value)}
                  className="w-full rounded-md border border-coyote-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select a deal…</option>
                  {(deals ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="callDate">Call Date</Label>
                <Input id="callDate" type="date" value={callDate} onChange={(e) => setCallDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="dueDate">Due Date (optional)</Label>
                <Input id="dueDate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="total">Total Capital Called</Label>
                <Input
                  id="total"
                  type="number"
                  step="0.01"
                  value={amountTotal}
                  onChange={(e) => setAmountTotal(e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="notes">Notes (included in LP email)</Label>
                <Textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <Button
                onClick={() => setStep(2)}
                disabled={!dealId || !callDate || !amountTotal}
              >
                Preview
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {step === 2 && (
        <>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-coyote-200 bg-coyote-50 text-left text-xs uppercase tracking-wide text-coyote-600">
                    <th className="px-4 py-3">Investor</th>
                    <th className="px-4 py-3">Entity</th>
                    <th className="px-4 py-3 text-right">Committed</th>
                    <th className="px-4 py-3 text-right">Pro-rata %</th>
                    <th className="px-4 py-3 text-right">Amount Due</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((p, i) => (
                    <tr key={i} className="border-b border-coyote-100">
                      <td className="px-4 py-3">{p.investorFullName ?? "—"}</td>
                      <td className="px-4 py-3 text-coyote-600">{p.investorEntityName ?? "—"}</td>
                      <td className="px-4 py-3 text-right">{fmtCurrency(p.committed)}</td>
                      <td className="px-4 py-3 text-right">{p.prorataPct}%</td>
                      <td className="px-4 py-3 text-right font-medium">{fmtCurrency(p.amountDue)}</td>
                    </tr>
                  ))}
                  {preview.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-coyote-500">
                        No positions on this deal.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="mt-5 flex justify-between">
            <Button variant="secondary" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button
              onClick={() => sendM.mutate()}
              disabled={preview.length === 0 || sendM.isPending}
            >
              {sendM.isPending ? "Sending…" : "Send Capital Call"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
