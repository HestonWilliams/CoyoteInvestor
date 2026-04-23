import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { ChevronLeft } from "lucide-react";
import { Card, CardBody } from "../components/ui/Card";
import { Badge, statusTone } from "../components/ui/Badge";
import { api } from "../lib/api";
import { fmtCurrency, fmtDate, fmtPercent, cn } from "../lib/utils";

interface DealDetail {
  deal: {
    id: string;
    name: string;
    assetClass: string;
    status: string;
    address: string | null;
    totalEquity: string | null;
    equityRaised: string;
    acquisitionPrice: string | null;
    currentValue: string | null;
    loanBalance: string | null;
    loanRate: string | null;
    loanMaturity: string | null;
    acquisitionDate: string | null;
    projectedExitDate: string | null;
    notes: string | null;
  };
  positions: Array<{
    position: {
      id: string;
      committedAmount: string;
      fundedAmount: string;
      ownershipPct: string | null;
      shareClass: string;
      status: string;
    };
    investorFullName: string | null;
    investorEntityName: string | null;
  }>;
  waterfall: {
    prefReturnPct: string;
    lpSplitPct: string;
    gpSplitPct: string;
    catchup: boolean;
    catchupPct: string | null;
    notes: string | null;
  } | null;
  distributions: Array<{
    id: string;
    distributionDate: string;
    type: string;
    totalAmount: string;
    status: string;
  }>;
  capitalCalls: Array<{
    id: string;
    callDate: string;
    dueDate: string | null;
    totalCalled: string;
    totalReceived: string;
    status: string;
  }>;
  documents: Array<{ id: string; name: string; type: string; uploadedAt: string }>;
  tasks: Array<{ id: string; title: string; status: string; priority: string; dueDate: string | null }>;
  communications: Array<{
    id: string;
    occurredAt: string;
    channel: string;
    direction: string | null;
    subject: string | null;
    loggedBy: string;
  }>;
}

const TABS = [
  "overview",
  "investors",
  "waterfall",
  "distributions",
  "capital_calls",
  "documents",
  "tasks",
  "notes",
] as const;

type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  investors: "Investors",
  waterfall: "Waterfall",
  distributions: "Distributions",
  capital_calls: "Capital Calls",
  documents: "Documents",
  tasks: "Tasks",
  notes: "Notes / Activity",
};

export default function DealDetailPage() {
  const [, params] = useRoute("/deals/:id");
  const id = params?.id;
  const [tab, setTab] = useState<Tab>("overview");

  const { data, isLoading, error } = useQuery({
    queryKey: ["deals", id],
    queryFn: () => api<DealDetail>(`/api/deals/${id}`),
    enabled: !!id,
  });

  if (isLoading) return <div className="text-sm text-coyote-500">Loading…</div>;
  if (error) return <div className="text-sm text-red-700">{(error as Error).message}</div>;
  if (!data) return <div>Not found</div>;

  const { deal, waterfall } = data;
  const ltv =
    deal.currentValue && Number(deal.currentValue) > 0
      ? `${((Number(deal.loanBalance ?? 0) / Number(deal.currentValue)) * 100).toFixed(1)}%`
      : "—";

  return (
    <div>
      <Link
        href="/deals"
        className="mb-4 inline-flex items-center gap-1 text-sm text-coyote-600 hover:underline"
      >
        <ChevronLeft className="h-4 w-4" /> Back to deals
      </Link>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-coyote-900">{deal.name}</h1>
            <Badge tone={statusTone(deal.status)}>{deal.status}</Badge>
          </div>
          <p className="mt-1 text-sm text-coyote-500">
            {deal.address ?? "—"} · {deal.assetClass.replace("_", " ")}
          </p>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-1 border-b border-coyote-200">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "relative px-4 py-2.5 text-sm font-medium transition-colors",
              tab === t
                ? "text-coyote-900"
                : "text-coyote-500 hover:text-coyote-800"
            )}
          >
            {TAB_LABELS[t]}
            {tab === t && (
              <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-coyote-700" />
            )}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardBody>
              <div className="mb-3 text-xs uppercase tracking-wide text-coyote-500">
                Investment
              </div>
              <dl className="space-y-2 text-sm">
                <Row label="Acquisition Price" value={fmtCurrency(deal.acquisitionPrice)} />
                <Row label="Current Value" value={fmtCurrency(deal.currentValue)} />
                <Row label="Total Equity Target" value={fmtCurrency(deal.totalEquity)} />
                <Row label="Equity Raised" value={fmtCurrency(deal.equityRaised)} />
                <Row label="Acquired" value={fmtDate(deal.acquisitionDate)} />
                <Row label="Projected Exit" value={fmtDate(deal.projectedExitDate)} />
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <div className="mb-3 text-xs uppercase tracking-wide text-coyote-500">
                Financing
              </div>
              <dl className="space-y-2 text-sm">
                <Row label="Loan Balance" value={fmtCurrency(deal.loanBalance)} />
                <Row label="Rate" value={fmtPercent(deal.loanRate)} />
                <Row label="Maturity" value={fmtDate(deal.loanMaturity)} />
                <Row label="LTV" value={ltv} />
              </dl>
            </CardBody>
          </Card>
          {deal.notes && (
            <Card className="md:col-span-2">
              <CardBody>
                <div className="mb-2 text-xs uppercase tracking-wide text-coyote-500">
                  Notes
                </div>
                <p className="whitespace-pre-wrap text-sm text-coyote-800">{deal.notes}</p>
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {tab === "investors" && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-coyote-200 bg-coyote-50 text-left text-xs uppercase tracking-wide text-coyote-600">
                  <th className="px-5 py-3">Investor</th>
                  <th className="px-5 py-3">Entity</th>
                  <th className="px-5 py-3">Class</th>
                  <th className="px-5 py-3 text-right">Committed</th>
                  <th className="px-5 py-3 text-right">Funded</th>
                  <th className="px-5 py-3 text-right">Ownership</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.positions.map((row) => (
                  <tr key={row.position.id} className="border-b border-coyote-100">
                    <td className="px-5 py-3">{row.investorFullName ?? "—"}</td>
                    <td className="px-5 py-3 text-coyote-600">
                      {row.investorEntityName ?? "—"}
                    </td>
                    <td className="px-5 py-3 text-coyote-600">{row.position.shareClass}</td>
                    <td className="px-5 py-3 text-right">
                      {fmtCurrency(row.position.committedAmount)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {fmtCurrency(row.position.fundedAmount)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {fmtPercent(row.position.ownershipPct, 4)}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={statusTone(row.position.status)}>
                        {row.position.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {data.positions.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-coyote-500">
                      No positions for this deal yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "waterfall" && (
        <Card>
          <CardBody>
            {waterfall ? (
              <dl className="space-y-2 text-sm">
                <Row label="Pref Return" value={fmtPercent(waterfall.prefReturnPct)} />
                <Row label="LP Split (above pref)" value={fmtPercent(waterfall.lpSplitPct)} />
                <Row label="GP Split (above pref)" value={fmtPercent(waterfall.gpSplitPct)} />
                <Row label="Catchup" value={waterfall.catchup ? "Yes" : "No"} />
                {waterfall.catchup && (
                  <Row label="Catchup %" value={fmtPercent(waterfall.catchupPct)} />
                )}
              </dl>
            ) : (
              <p className="text-sm text-coyote-500">
                No waterfall configured. Distribution wizard (Phase 2) will set this.
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {tab === "distributions" && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-coyote-200 bg-coyote-50 text-left text-xs uppercase tracking-wide text-coyote-600">
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3 text-right">Total</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.distributions.map((d) => (
                  <tr key={d.id} className="border-b border-coyote-100">
                    <td className="px-5 py-3">{fmtDate(d.distributionDate)}</td>
                    <td className="px-5 py-3">{d.type}</td>
                    <td className="px-5 py-3 text-right">{fmtCurrency(d.totalAmount)}</td>
                    <td className="px-5 py-3">
                      <Badge tone={statusTone(d.status)}>{d.status}</Badge>
                    </td>
                  </tr>
                ))}
                {data.distributions.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-10 text-center text-coyote-500">
                      No distributions yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "capital_calls" && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-coyote-200 bg-coyote-50 text-left text-xs uppercase tracking-wide text-coyote-600">
                  <th className="px-5 py-3">Called</th>
                  <th className="px-5 py-3">Due</th>
                  <th className="px-5 py-3 text-right">Total</th>
                  <th className="px-5 py-3 text-right">Received</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.capitalCalls.map((c) => (
                  <tr key={c.id} className="border-b border-coyote-100">
                    <td className="px-5 py-3">{fmtDate(c.callDate)}</td>
                    <td className="px-5 py-3">{fmtDate(c.dueDate)}</td>
                    <td className="px-5 py-3 text-right">{fmtCurrency(c.totalCalled)}</td>
                    <td className="px-5 py-3 text-right">{fmtCurrency(c.totalReceived)}</td>
                    <td className="px-5 py-3">
                      <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                    </td>
                  </tr>
                ))}
                {data.capitalCalls.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-coyote-500">
                      No capital calls yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "documents" && (
        <Card>
          <CardBody>
            {data.documents.length === 0 ? (
              <p className="text-sm text-coyote-500">No documents yet. Phase 3 wires upload.</p>
            ) : (
              <ul className="text-sm">
                {data.documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between py-2">
                    <span>
                      <span className="font-medium">{d.name}</span>{" "}
                      <span className="text-coyote-500">({d.type})</span>
                    </span>
                    <span className="text-coyote-500">{fmtDate(d.uploadedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {tab === "tasks" && (
        <Card>
          <CardBody>
            {data.tasks.length === 0 ? (
              <p className="text-sm text-coyote-500">No tasks linked to this deal.</p>
            ) : (
              <ul className="divide-y divide-coyote-100 text-sm">
                {data.tasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between py-2">
                    <span>
                      <Badge tone={statusTone(t.status)} className="mr-2">
                        {t.status}
                      </Badge>
                      {t.title}
                    </span>
                    <span className="text-coyote-500">{fmtDate(t.dueDate)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {tab === "notes" && (
        <Card>
          <CardBody>
            {data.communications.length === 0 ? (
              <p className="text-sm text-coyote-500">
                No activity logged yet. Gmail sync + BCC ingest populate this.
              </p>
            ) : (
              <ol className="relative border-l border-coyote-200 pl-5">
                {data.communications.map((c) => (
                  <li key={c.id} className="mb-4">
                    <div className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-coyote-400" />
                    <div className="text-xs text-coyote-500">
                      {fmtDate(c.occurredAt)} · {c.channel}
                      {c.direction ? ` · ${c.direction}` : ""}
                      {c.loggedBy ? ` · ${c.loggedBy}` : ""}
                    </div>
                    <div className="text-sm text-coyote-900">{c.subject ?? "(no subject)"}</div>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-coyote-500">{label}</dt>
      <dd className="font-medium text-coyote-900">{value}</dd>
    </div>
  );
}
