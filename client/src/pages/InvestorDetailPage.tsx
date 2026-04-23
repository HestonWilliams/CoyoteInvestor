import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { ChevronLeft } from "lucide-react";
import { Card, CardBody } from "../components/ui/Card";
import { Badge, statusTone } from "../components/ui/Badge";
import { api } from "../lib/api";
import { fmtCurrency, fmtDate, fmtPercent } from "../lib/utils";

interface InvestorDetail {
  investor: {
    id: string;
    fullName: string;
    email: string;
    phone: string | null;
    entityName: string | null;
    entityType: string | null;
    address: string | null;
    ssnEinLast4: string | null;
    accredited: boolean;
    accreditedVerifiedAt: string | null;
    notes: string | null;
    tags: string[];
    portalEnabled: boolean;
    importedFrom: string | null;
    createdAt: string;
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
    dealName: string | null;
    dealStatus: string | null;
  }>;
  communications: Array<{
    id: string;
    occurredAt: string;
    channel: string;
    direction: string | null;
    subject: string | null;
    loggedBy: string;
  }>;
}

export default function InvestorDetailPage() {
  const [, params] = useRoute("/investors/:id");
  const id = params?.id;

  const { data, isLoading, error } = useQuery({
    queryKey: ["investors", id],
    queryFn: () => api<InvestorDetail>(`/api/investors/${id}`),
    enabled: !!id,
  });

  if (isLoading) return <div className="text-sm text-coyote-500">Loading…</div>;
  if (error) return <div className="text-sm text-red-700">{(error as Error).message}</div>;
  if (!data) return <div>Not found</div>;

  const { investor, positions, communications } = data;

  const totalCommitted = positions.reduce(
    (acc, p) => acc + Number(p.position.committedAmount || 0),
    0
  );
  const totalFunded = positions.reduce(
    (acc, p) => acc + Number(p.position.fundedAmount || 0),
    0
  );

  return (
    <div>
      <Link
        href="/investors"
        className="mb-4 inline-flex items-center gap-1 text-sm text-coyote-600 hover:underline"
      >
        <ChevronLeft className="h-4 w-4" /> Back to investors
      </Link>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-coyote-900">{investor.fullName}</h1>
        <p className="text-sm text-coyote-500">
          {investor.email}
          {investor.phone ? ` · ${investor.phone}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge tone={investor.accredited ? "green" : "neutral"}>
            {investor.accredited ? "Accredited" : "Not accredited"}
          </Badge>
          {investor.entityName && (
            <Badge tone="blue">
              {investor.entityName} {investor.entityType ? `(${investor.entityType})` : ""}
            </Badge>
          )}
          {investor.portalEnabled && <Badge tone="green">Portal enabled</Badge>}
          {investor.importedFrom && (
            <Badge tone="neutral">Imported: {investor.importedFrom}</Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardBody>
            <div className="mb-3 text-xs uppercase tracking-wide text-coyote-500">Overview</div>
            <dl className="space-y-2 text-sm">
              <Row label="Total Committed" value={fmtCurrency(totalCommitted)} />
              <Row label="Total Funded" value={fmtCurrency(totalFunded)} />
              <Row label="Position Count" value={String(positions.length)} />
              <Row
                label="Accreditation Verified"
                value={fmtDate(investor.accreditedVerifiedAt)}
              />
              <Row label="Added" value={fmtDate(investor.createdAt)} />
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <div className="mb-3 text-xs uppercase tracking-wide text-coyote-500">Contact</div>
            <dl className="space-y-2 text-sm">
              <Row label="Email" value={investor.email} />
              <Row label="Phone" value={investor.phone ?? "—"} />
              <Row label="Address" value={investor.address ?? "—"} />
              <Row
                label="SSN/EIN (last 4)"
                value={investor.ssnEinLast4 ? `•••• ${investor.ssnEinLast4}` : "—"}
              />
            </dl>
          </CardBody>
        </Card>
        {investor.notes && (
          <Card className="md:col-span-2">
            <CardBody>
              <div className="mb-2 text-xs uppercase tracking-wide text-coyote-500">Notes</div>
              <p className="whitespace-pre-wrap text-sm text-coyote-800">{investor.notes}</p>
            </CardBody>
          </Card>
        )}
        <Card className="md:col-span-2">
          <div className="border-b border-coyote-200 px-5 py-3 text-xs uppercase tracking-wide text-coyote-500">
            Positions
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-coyote-50 text-left text-xs uppercase tracking-wide text-coyote-600">
                  <th className="px-5 py-3">Deal</th>
                  <th className="px-5 py-3">Class</th>
                  <th className="px-5 py-3 text-right">Committed</th>
                  <th className="px-5 py-3 text-right">Funded</th>
                  <th className="px-5 py-3 text-right">Ownership</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.position.id} className="border-b border-coyote-100">
                    <td className="px-5 py-3">{p.dealName ?? "—"}</td>
                    <td className="px-5 py-3">{p.position.shareClass}</td>
                    <td className="px-5 py-3 text-right">
                      {fmtCurrency(p.position.committedAmount)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {fmtCurrency(p.position.fundedAmount)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {fmtPercent(p.position.ownershipPct, 4)}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={statusTone(p.position.status)}>{p.position.status}</Badge>
                    </td>
                  </tr>
                ))}
                {positions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-coyote-500">
                      No positions yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
        <Card className="md:col-span-2">
          <div className="border-b border-coyote-200 px-5 py-3 text-xs uppercase tracking-wide text-coyote-500">
            Communications
          </div>
          <CardBody>
            {communications.length === 0 ? (
              <p className="text-sm text-coyote-500">
                Nothing logged yet. Gmail sync + BCC ingest populate this.
              </p>
            ) : (
              <ol className="relative border-l border-coyote-200 pl-5">
                {communications.map((c) => (
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
      </div>
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
