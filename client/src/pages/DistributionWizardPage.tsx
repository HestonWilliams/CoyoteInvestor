import { useEffect, useMemo, useState } from "react";
import { useLocation, Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { Card, CardBody } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input, Label, Textarea } from "../components/ui/Input";
import { api } from "../lib/api";
import { fmtCurrency } from "../lib/utils";

/**
 * 4-step distribution wizard (PRD §5.9 + Phase 2 checklist):
 *   1. Select Deal
 *   2. Enter amount + type + date + notes
 *   3. Review waterfall preview; GP can override individual line items
 *      (override REQUIRES a reason string, enforced by the PATCH route)
 *   4. Confirm + approve; GP is then sent to the Mark-Paid modal route
 *
 * Backing API:
 *   POST /api/distributions            → draft
 *   GET  /api/distributions/:id/preview
 *   PATCH /api/distributions/:id/line-items/:liId
 *   POST /api/distributions/:id/approve
 */

interface Deal {
  id: string;
  name: string;
  status: string;
}

interface Preview {
  distribution: {
    id: string;
    dealId: string;
    distributionDate: string;
    type: string;
    totalAmount: string;
    status: string;
    notes: string | null;
  };
  lineItems: Array<{
    item: {
      id: string;
      investorId: string;
      positionId: string;
      grossAmount: string;
      prefComponent: string;
      returnOfCapital: string;
      profitSplit: string;
      netAmount: string;
      paymentStatus: string;
    };
    investorFullName: string | null;
    investorEmail: string | null;
  }>;
}

type Step = 1 | 2 | 3 | 4;

export default function DistributionWizardPage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const { data: deals } = useQuery({
    queryKey: ["deals"],
    queryFn: () => api<Deal[]>("/api/deals"),
  });

  const [step, setStep] = useState<Step>(1);
  const [dealId, setDealId] = useState<string>("");
  const [type, setType] = useState<"operating" | "return_of_capital" | "refinance" | "sale">(
    "operating"
  );
  const [totalAmount, setTotalAmount] = useState("");
  const [distributionDate, setDistributionDate] = useState(
    () => new Date().toISOString().slice(0, 10)
  );
  const [notes, setNotes] = useState("");
  const [distributionId, setDistributionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createDraftM = useMutation({
    mutationFn: () =>
      api<{ distribution: { id: string } }>("/api/distributions", {
        method: "POST",
        body: {
          dealId,
          type,
          totalAmount,
          distributionDate,
          notes: notes || null,
        },
      }),
    onSuccess: (r) => {
      setDistributionId(r.distribution.id);
      setStep(3);
    },
    onError: (e: Error) => setError(e.message),
  });

  const approveM = useMutation({
    mutationFn: () =>
      api(`/api/distributions/${distributionId}/approve`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deals", dealId] });
      qc.invalidateQueries({ queryKey: ["distributions"] });
      setStep(4);
    },
  });

  const { data: preview, refetch } = useQuery({
    queryKey: ["distribution-preview", distributionId],
    queryFn: () =>
      api<Preview>(`/api/distributions/${distributionId}/preview`),
    enabled: !!distributionId && step >= 3,
  });

  const selectedDeal = useMemo(
    () => deals?.find((d) => d.id === dealId),
    [deals, dealId]
  );

  return (
    <div>
      <Link
        href="/distributions"
        className="mb-4 inline-flex items-center gap-1 text-sm text-coyote-600 hover:underline"
      >
        <ChevronLeft className="h-4 w-4" /> Back to distributions
      </Link>
      <h1 className="mb-1 text-2xl font-semibold text-coyote-900">New Distribution</h1>
      <p className="mb-6 text-sm text-coyote-500">
        Step {step} of 4 · {["Select Deal", "Details", "Review Waterfall", "Confirm"][step - 1]}
      </p>

      <StepIndicator step={step} />

      {error && (
        <div className="my-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {step === 1 && (
        <Card>
          <CardBody>
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
                  {d.name} ({d.status})
                </option>
              ))}
            </select>
            <div className="mt-4 flex justify-end">
              <Button onClick={() => setStep(2)} disabled={!dealId}>
                Next
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardBody>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="type">Distribution Type</Label>
                <select
                  id="type"
                  value={type}
                  onChange={(e) => setType(e.target.value as typeof type)}
                  className="w-full rounded-md border border-coyote-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="operating">Operating</option>
                  <option value="return_of_capital">Return of Capital</option>
                  <option value="refinance">Refinance</option>
                  <option value="sale">Sale</option>
                </select>
              </div>
              <div>
                <Label htmlFor="date">Effective Date</Label>
                <Input
                  id="date"
                  type="date"
                  value={distributionDate}
                  onChange={(e) => setDistributionDate(e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="amount">Total Amount (USD)</Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                  placeholder="e.g. 100000.00"
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
            <div className="mt-5 flex justify-between">
              <Button variant="secondary" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button
                onClick={() => {
                  setError(null);
                  createDraftM.mutate();
                }}
                disabled={!totalAmount || !distributionDate || createDraftM.isPending}
              >
                {createDraftM.isPending ? "Computing waterfall…" : "Compute Waterfall"}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {step === 3 && preview && (
        <ReviewStep
          preview={preview}
          dealName={selectedDeal?.name ?? ""}
          onOverrideSaved={() => refetch()}
          onBack={() => setStep(2)}
          onApprove={() => approveM.mutate()}
          approving={approveM.isPending}
        />
      )}

      {step === 4 && distributionId && (
        <Card>
          <CardBody>
            <h3 className="text-base font-semibold text-green-800">Distribution Approved</h3>
            <p className="mt-2 text-sm text-coyote-700">
              Status is now <strong>approved</strong>. No ledger activity yet — that happens when
              you mark it paid per investor. The payment step writes financial_events atomically
              and emails each LP a distribution notice.
            </p>
            <div className="mt-4 flex gap-2">
              <Button onClick={() => navigate(`/distributions/${distributionId}`)}>
                Mark as Paid
              </Button>
              <Button variant="secondary" onClick={() => navigate("/distributions")}>
                Back to list
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const labels = ["Deal", "Details", "Review", "Confirm"];
  return (
    <div className="mb-5 flex gap-1">
      {labels.map((l, i) => {
        const n = (i + 1) as Step;
        const active = n === step;
        const done = n < step;
        return (
          <div
            key={l}
            className={`flex-1 rounded px-3 py-2 text-xs uppercase tracking-wide ${
              active
                ? "bg-coyote-800 text-white"
                : done
                ? "bg-coyote-300 text-coyote-900"
                : "bg-coyote-100 text-coyote-500"
            }`}
          >
            {n}. {l}
          </div>
        );
      })}
    </div>
  );
}

function ReviewStep({
  preview,
  dealName,
  onOverrideSaved,
  onBack,
  onApprove,
  approving,
}: {
  preview: Preview;
  dealName: string;
  onOverrideSaved: () => void;
  onBack: () => void;
  onApprove: () => void;
  approving: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{
    grossAmount: string;
    prefComponent: string;
    returnOfCapital: string;
    profitSplit: string;
    netAmount: string;
    reason: string;
  }>({
    grossAmount: "",
    prefComponent: "",
    returnOfCapital: "",
    profitSplit: "",
    netAmount: "",
    reason: "",
  });
  const [editError, setEditError] = useState<string | null>(null);

  const saveM = useMutation({
    mutationFn: (liId: string) =>
      api(`/api/distributions/${preview.distribution.id}/line-items/${liId}`, {
        method: "PATCH",
        body: editValues,
      }),
    onSuccess: () => {
      setEditing(null);
      onOverrideSaved();
    },
    onError: (e: Error) => setEditError(e.message),
  });

  const lineItemSum = preview.lineItems.reduce(
    (acc, li) => acc + Number(li.item.netAmount),
    0
  );

  return (
    <>
      <Card className="mb-4">
        <CardBody>
          <div className="mb-3 text-xs uppercase tracking-wide text-coyote-500">
            Waterfall Preview — {dealName}
          </div>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <Stat label="Total Distribution" value={fmtCurrency(preview.distribution.totalAmount)} />
            <Stat label="Line Item Sum (LP+GP positions)" value={fmtCurrency(lineItemSum)} />
            <Stat
              label="Implicit GP Promote"
              value={fmtCurrency(
                Number(preview.distribution.totalAmount) - lineItemSum
              )}
            />
          </div>
        </CardBody>
      </Card>

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
                <th className="px-4 py-3 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {preview.lineItems.map(({ item, investorFullName }) => {
                const isEditing = editing === item.id;
                return (
                  <tr key={item.id} className="border-b border-coyote-100">
                    <td className="px-4 py-3">{investorFullName ?? "—"}</td>
                    <td className="px-4 py-3 text-right">{fmtCurrency(item.grossAmount)}</td>
                    <td className="px-4 py-3 text-right">{fmtCurrency(item.prefComponent)}</td>
                    <td className="px-4 py-3 text-right">{fmtCurrency(item.returnOfCapital)}</td>
                    <td className="px-4 py-3 text-right">{fmtCurrency(item.profitSplit)}</td>
                    <td className="px-4 py-3 text-right font-medium">
                      {fmtCurrency(item.netAmount)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => {
                          setEditing(item.id);
                          setEditError(null);
                          setEditValues({
                            grossAmount: item.grossAmount,
                            prefComponent: item.prefComponent,
                            returnOfCapital: item.returnOfCapital,
                            profitSplit: item.profitSplit,
                            netAmount: item.netAmount,
                            reason: "",
                          });
                        }}
                        className="text-xs text-coyote-600 hover:underline"
                      >
                        {isEditing ? "Editing…" : "Override"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (
        <Card className="mt-4 border-amber-300 bg-amber-50">
          <CardBody>
            <h4 className="mb-3 text-sm font-semibold">Override Line Item</h4>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {(
                ["grossAmount", "prefComponent", "returnOfCapital", "profitSplit", "netAmount"] as const
              ).map((k) => (
                <div key={k}>
                  <Label htmlFor={`ov-${k}`}>{k}</Label>
                  <Input
                    id={`ov-${k}`}
                    type="number"
                    step="0.01"
                    value={editValues[k]}
                    onChange={(e) => setEditValues({ ...editValues, [k]: e.target.value })}
                  />
                </div>
              ))}
            </div>
            <div className="mt-3">
              <Label htmlFor="ov-reason">Override Reason (required)</Label>
              <Input
                id="ov-reason"
                value={editValues.reason}
                onChange={(e) => setEditValues({ ...editValues, reason: e.target.value })}
                placeholder="e.g. manual correction for tax withholding"
              />
            </div>
            {editError && (
              <div className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{editError}</div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (editValues.reason.trim().length < 3) {
                    setEditError("Reason must be at least 3 characters.");
                    return;
                  }
                  saveM.mutate(editing);
                }}
                disabled={saveM.isPending}
              >
                {saveM.isPending ? "Saving…" : "Save Override"}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="mt-5 flex justify-between">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onApprove} disabled={approving}>
          {approving ? "Approving…" : "Approve Distribution"}
        </Button>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-coyote-500">{label}</div>
      <div className="text-lg font-semibold text-coyote-900">{value}</div>
    </div>
  );
}
