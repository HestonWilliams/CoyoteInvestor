import { useState } from "react";
import { Link } from "wouter";
import { ChevronLeft } from "lucide-react";
import { Card, CardBody } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Textarea } from "../components/ui/Input";
import { api } from "../lib/api";

interface PreviewResponse {
  preview: true;
  summary: { total: number; toCreate: number; toSkip: number; errors: number };
  plan: Array<
    | { row: number; status: "create"; input: { fullName: string; email: string } }
    | { row: number; status: "skip-duplicate"; email: string }
    | { row: number; status: "error"; message: string }
  >;
}

interface CommitResponse {
  committed: true;
  createdCount: number;
  skippedCount: number;
  errorCount: number;
  errors: Array<{ row: number; message: string }>;
}

export default function InvestorImportPage() {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [result, setResult] = useState<CommitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const runPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<PreviewResponse>("/api/investors/import", {
        method: "POST",
        body: { csv, commit: false },
      });
      setPreview(r);
      setResult(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<CommitResponse>("/api/investors/import", {
        method: "POST",
        body: { csv, commit: true },
      });
      setResult(r);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Link
        href="/investors"
        className="mb-4 inline-flex items-center gap-1 text-sm text-coyote-600 hover:underline"
      >
        <ChevronLeft className="h-4 w-4" /> Back to investors
      </Link>
      <h1 className="mb-1 text-2xl font-semibold text-coyote-900">Import from CSV</h1>
      <p className="mb-6 text-sm text-coyote-500">
        Paste a CSV export from Appfolio Investment Manager. Expected headers:{" "}
        <code className="rounded bg-coyote-100 px-1">Contact Name</code>,{" "}
        <code className="rounded bg-coyote-100 px-1">Email</code>,{" "}
        <code className="rounded bg-coyote-100 px-1">Phone</code>,{" "}
        <code className="rounded bg-coyote-100 px-1">Entity Name</code>,{" "}
        <code className="rounded bg-coyote-100 px-1">Address</code>. Duplicate emails are skipped.
      </p>

      <Card>
        <CardBody>
          <Textarea
            rows={10}
            placeholder="Paste CSV content here…"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
          />
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" onClick={runPreview} disabled={!csv || busy}>
              Preview
            </Button>
            <Button onClick={runImport} disabled={!preview || busy}>
              {busy ? "Working…" : "Commit Import"}
            </Button>
          </div>
          {error && (
            <div className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}
        </CardBody>
      </Card>

      {preview && !result && (
        <Card className="mt-6">
          <CardBody>
            <h3 className="mb-2 font-semibold">Preview</h3>
            <div className="mb-4 grid grid-cols-4 gap-4 text-sm">
              <Stat label="Rows" value={preview.summary.total} />
              <Stat label="Create" value={preview.summary.toCreate} tone="green" />
              <Stat label="Skip (dup)" value={preview.summary.toSkip} tone="amber" />
              <Stat label="Errors" value={preview.summary.errors} tone="red" />
            </div>
            <ul className="max-h-64 overflow-auto text-sm">
              {preview.plan.slice(0, 50).map((p, i) => (
                <li key={i} className="border-b border-coyote-100 py-1.5">
                  <span className="mr-2 text-xs text-coyote-500">row {p.row}:</span>
                  {p.status === "create" && (
                    <span className="text-green-700">
                      create {p.input.fullName} &lt;{p.input.email}&gt;
                    </span>
                  )}
                  {p.status === "skip-duplicate" && (
                    <span className="text-amber-700">skip duplicate {p.email}</span>
                  )}
                  {p.status === "error" && (
                    <span className="text-red-700">{p.message}</span>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {result && (
        <Card className="mt-6">
          <CardBody>
            <h3 className="mb-2 font-semibold">Import complete</h3>
            <p className="text-sm">
              Created {result.createdCount} · Skipped {result.skippedCount} · Errors{" "}
              {result.errorCount}
            </p>
            {result.errors.length > 0 && (
              <ul className="mt-3 text-sm text-red-700">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "green" | "amber" | "red";
}) {
  const tones = {
    neutral: "text-coyote-900",
    green: "text-green-700",
    amber: "text-amber-700",
    red: "text-red-700",
  };
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-coyote-500">{label}</div>
      <div className={`text-2xl font-semibold ${tones[tone]}`}>{value}</div>
    </div>
  );
}
