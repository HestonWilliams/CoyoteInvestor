import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Plus, FileUp } from "lucide-react";
import { Card, CardBody } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input, Label } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { api } from "../lib/api";
import { fmtDate } from "../lib/utils";

interface Investor {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  entityName: string | null;
  entityType: string | null;
  accredited: boolean;
  tags: string[];
  createdAt: string;
}

export default function InvestorsPage() {
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);

  const { data: investors, isLoading } = useQuery({
    queryKey: ["investors", search],
    queryFn: () => api<Investor[]>(`/api/investors${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-coyote-900">Investors</h1>
          <p className="text-sm text-coyote-500">LP and prospect CRM</p>
        </div>
        <div className="flex gap-2">
          <Link href="/investors/import">
            <Button variant="secondary">
              <FileUp className="h-4 w-4" /> Import CSV
            </Button>
          </Link>
          <Button onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" /> New Investor
          </Button>
        </div>
      </div>

      <div className="mb-4 max-w-md">
        <Input
          placeholder="Search name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {showNew && <NewInvestorForm onClose={() => setShowNew(false)} />}

      {isLoading ? (
        <div className="text-sm text-coyote-500">Loading…</div>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-coyote-200 bg-coyote-50 text-left text-xs uppercase tracking-wide text-coyote-600">
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Email</th>
                  <th className="px-5 py-3">Entity</th>
                  <th className="px-5 py-3">Accredited</th>
                  <th className="px-5 py-3">Tags</th>
                  <th className="px-5 py-3">Added</th>
                </tr>
              </thead>
              <tbody>
                {(investors ?? []).map((i) => (
                  <tr key={i.id} className="border-b border-coyote-100 hover:bg-coyote-50/50">
                    <td className="px-5 py-3">
                      <Link
                        href={`/investors/${i.id}`}
                        className="font-medium text-coyote-800 hover:underline"
                      >
                        {i.fullName}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-coyote-700">{i.email}</td>
                    <td className="px-5 py-3 text-coyote-700">
                      {i.entityName ?? "—"}
                      {i.entityType && (
                        <span className="ml-1 text-xs text-coyote-500">({i.entityType})</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={i.accredited ? "green" : "neutral"}>
                        {i.accredited ? "Yes" : "No"}
                      </Badge>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1">
                        {i.tags.map((t) => (
                          <Badge key={t} tone="blue">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-coyote-600">{fmtDate(i.createdAt)}</td>
                  </tr>
                ))}
                {(investors ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-coyote-500">
                      No investors yet.
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

function NewInvestorForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [entityName, setEntityName] = useState("");
  const [entityType, setEntityType] = useState("individual");
  const [accredited, setAccredited] = useState(false);

  const m = useMutation({
    mutationFn: () =>
      api<Investor>("/api/investors", {
        method: "POST",
        body: {
          fullName,
          email,
          phone: phone || null,
          entityName: entityName || null,
          entityType,
          accredited,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["investors"] });
      onClose();
    },
  });

  return (
    <Card className="mb-6">
      <CardBody>
        <h2 className="mb-4 text-lg font-semibold">New Investor</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="i-name">Full Name</Label>
            <Input
              id="i-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="i-email">Email</Label>
            <Input
              id="i-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="i-phone">Phone</Label>
            <Input id="i-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="i-entity">Entity Name</Label>
            <Input
              id="i-entity"
              value={entityName}
              onChange={(e) => setEntityName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="i-etype">Entity Type</Label>
            <select
              id="i-etype"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="w-full rounded-md border border-coyote-300 bg-white px-3 py-2 text-sm"
            >
              <option value="individual">Individual</option>
              <option value="llc">LLC</option>
              <option value="trust">Trust</option>
              <option value="ira">IRA</option>
            </select>
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input
              id="i-acc"
              type="checkbox"
              checked={accredited}
              onChange={(e) => setAccredited(e.target.checked)}
            />
            <Label htmlFor="i-acc">Accredited investor</Label>
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
          <Button
            onClick={() => m.mutate()}
            disabled={!fullName || !email || m.isPending}
          >
            {m.isPending ? "Saving…" : "Create"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
