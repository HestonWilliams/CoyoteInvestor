import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardBody } from "../components/ui/Card";
import { Input, Label } from "../components/ui/Input";
import { api } from "../lib/api";
import { fmtCurrency, fmtDate } from "../lib/utils";

/**
 * Immutable financial-events ledger viewer (/admin/ledger).
 * Read-only by design. No UI affordance issues UPDATE or DELETE against
 * this table, mirroring the DB-level INSERT-only grant.
 */

interface EventType {
  id: string;
  eventType: string;
  amount: string;
  effectiveDate: string;
  referenceTable: string;
  referenceId: string;
  memo: string | null;
  createdAt: string;
  createdBy: string;
}

interface LedgerResponse {
  rows: Array<{
    event: EventType;
    dealName: string | null;
    investorName: string | null;
    investorEmail: string | null;
  }>;
  summary: { total: string; count: number };
}

const EVENT_TYPES = [
  "capital_funded",
  "distribution_paid",
  "pref_paid",
  "capital_returned",
  "profit_split",
] as const;

export default function LedgerPage() {
  const [eventType, setEventType] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  const qs = new URLSearchParams();
  if (eventType) qs.set("eventType", eventType);
  if (startDate) qs.set("startDate", startDate);
  if (endDate) qs.set("endDate", endDate);

  const { data, isLoading } = useQuery({
    queryKey: ["ledger", eventType, startDate, endDate],
    queryFn: () => api<LedgerResponse>(`/api/ledger?${qs.toString()}`),
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-coyote-900">Financial Events Ledger</h1>
        <p className="text-sm text-coyote-500">
          Immutable depot. Written by the service layer inside DB transactions; never updated or
          deleted.
        </p>
      </div>

      <Card className="mb-4">
        <CardBody>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <Label htmlFor="et">Event Type</Label>
              <select
                id="et"
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
                className="w-full rounded-md border border-coyote-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">All</option>
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="start">Start Date</Label>
              <Input
                id="start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="end">End Date</Label>
              <Input
                id="end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <div className="w-full rounded-md bg-coyote-50 px-3 py-2 text-sm">
                <div className="text-xs text-coyote-500">Filtered total</div>
                <div className="font-semibold text-coyote-900">
                  {data ? fmtCurrency(data.summary.total) : "—"}{" "}
                  <span className="text-xs font-normal text-coyote-500">
                    · {data?.summary.count ?? 0} rows
                  </span>
                </div>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {isLoading ? (
        <div className="text-sm text-coyote-500">Loading…</div>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-coyote-200 bg-coyote-50 text-left text-xs uppercase tracking-wide text-coyote-600">
                  <th className="px-4 py-3">Effective</th>
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">Deal</th>
                  <th className="px-4 py-3">Investor</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Memo</th>
                  <th className="px-4 py-3">Source</th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows ?? []).map(({ event, dealName, investorName }) => (
                  <tr key={event.id} className="border-b border-coyote-100">
                    <td className="px-4 py-3">{fmtDate(event.effectiveDate)}</td>
                    <td className="px-4 py-3">
                      <code className="rounded bg-coyote-100 px-1.5 py-0.5 text-xs">
                        {event.eventType}
                      </code>
                    </td>
                    <td className="px-4 py-3">{dealName ?? "—"}</td>
                    <td className="px-4 py-3">{investorName ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-variant-numeric tabular-nums">
                      {fmtCurrency(event.amount)}
                    </td>
                    <td className="px-4 py-3 text-xs text-coyote-600">{event.memo ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-coyote-500">
                      {event.referenceTable}:{event.referenceId.slice(0, 8)}…
                    </td>
                  </tr>
                ))}
                {(data?.rows ?? []).length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-coyote-500">
                      No ledger events match these filters.
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
