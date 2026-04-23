import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Plus } from "lucide-react";
import { Card, CardBody } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input, Label, Textarea } from "../components/ui/Input";
import { Badge, statusTone } from "../components/ui/Badge";
import { api } from "../lib/api";
import { fmtCurrency, fmtDate } from "../lib/utils";

interface Deal {
  id: string;
  name: string;
  assetClass: string;
  status: string;
  address: string | null;
  totalEquity: string | null;
  equityRaised: string;
  currentValue: string | null;
  acquisitionDate: string | null;
}

export default function DealsPage() {
  const [showNew, setShowNew] = useState(false);
  const { data: deals, isLoading } = useQuery({
    queryKey: ["deals"],
    queryFn: () => api<Deal[]>("/api/deals"),
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-coyote-900">Deals</h1>
          <p className="text-sm text-coyote-500">Portfolio of syndicated investments</p>
        </div>
        <Button onClick={() => setShowNew(true)}>
          <Plus className="h-4 w-4" /> New Deal
        </Button>
      </div>

      {showNew && <NewDealForm onClose={() => setShowNew(false)} />}

      {isLoading ? (
        <div className="text-sm text-coyote-500">Loading…</div>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-coyote-200 bg-coyote-50 text-left text-xs uppercase tracking-wide text-coyote-600">
                  <th className="px-5 py-3">Deal</th>
                  <th className="px-5 py-3">Asset Class</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Target</th>
                  <th className="px-5 py-3 text-right">Raised</th>
                  <th className="px-5 py-3 text-right">% Funded</th>
                  <th className="px-5 py-3">Acquired</th>
                  <th className="px-5 py-3 text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {(deals ?? []).map((d) => {
                  const total = Number(d.totalEquity ?? 0);
                  const raised = Number(d.equityRaised ?? 0);
                  const pct = total > 0 ? ((raised / total) * 100).toFixed(0) + "%" : "—";
                  return (
                    <tr
                      key={d.id}
                      className="border-b border-coyote-100 hover:bg-coyote-50/50"
                    >
                      <td className="px-5 py-3">
                        <Link
                          href={`/deals/${d.id}`}
                          className="font-medium text-coyote-800 hover:underline"
                        >
                          {d.name}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-coyote-700">{d.assetClass}</td>
                      <td className="px-5 py-3">
                        <Badge tone={statusTone(d.status)}>{d.status}</Badge>
                      </td>
                      <td className="px-5 py-3 text-right">{fmtCurrency(d.totalEquity)}</td>
                      <td className="px-5 py-3 text-right">{fmtCurrency(d.equityRaised)}</td>
                      <td className="px-5 py-3 text-right">{pct}</td>
                      <td className="px-5 py-3">{fmtDate(d.acquisitionDate)}</td>
                      <td className="px-5 py-3 text-right">{fmtCurrency(d.currentValue)}</td>
                    </tr>
                  );
                })}
                {(deals ?? []).length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-5 py-10 text-center text-coyote-500">
                      No deals yet. Click <em>New Deal</em> to create one.
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

function NewDealForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [assetClass, setAssetClass] = useState("self_storage");
  const [status, setStatus] = useState("prospecting");
  const [address, setAddress] = useState("");
  const [totalEquity, setTotalEquity] = useState("");
  const [notes, setNotes] = useState("");

  const m = useMutation({
    mutationFn: () =>
      api<Deal>("/api/deals", {
        method: "POST",
        body: {
          name,
          assetClass,
          status,
          address: address || null,
          totalEquity: totalEquity || null,
          notes: notes || null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deals"] });
      onClose();
    },
  });

  return (
    <Card className="mb-6">
      <CardBody>
        <h2 className="mb-4 text-lg font-semibold">Create Deal</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="d-name">Deal Name</Label>
            <Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="d-class">Asset Class</Label>
            <select
              id="d-class"
              value={assetClass}
              onChange={(e) => setAssetClass(e.target.value)}
              className="w-full rounded-md border border-coyote-300 bg-white px-3 py-2 text-sm"
            >
              <option value="self_storage">Self Storage</option>
              <option value="multifamily">Multifamily</option>
              <option value="land">Land</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <Label htmlFor="d-status">Status</Label>
            <select
              id="d-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-md border border-coyote-300 bg-white px-3 py-2 text-sm"
            >
              <option value="prospecting">Prospecting</option>
              <option value="fundraising">Fundraising</option>
              <option value="active">Active</option>
              <option value="exited">Exited</option>
            </select>
          </div>
          <div>
            <Label htmlFor="d-eq">Total Equity Target</Label>
            <Input
              id="d-eq"
              type="number"
              step="0.01"
              value={totalEquity}
              onChange={(e) => setTotalEquity(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="d-addr">Address</Label>
            <Input
              id="d-addr"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="d-notes">Notes</Label>
            <Textarea
              id="d-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        {m.error && (
          <div className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
            {(m.error as Error).message}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => m.mutate()} disabled={!name || m.isPending}>
            {m.isPending ? "Saving…" : "Create Deal"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
