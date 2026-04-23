import { Card, CardBody } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { useSearch } from "wouter";

export default function SettingsPage() {
  const search = useSearch();
  const justConnected = new URLSearchParams(search).get("gmail") === "connected";

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-coyote-900">Settings</h1>

      <Card>
        <CardBody>
          <h3 className="text-base font-semibold text-coyote-900">Gmail Sync</h3>
          <p className="mt-1 text-sm text-coyote-500">
            Connect a Google account so inbound/outbound emails with known investors are
            auto-logged every 15 minutes. Scope is <code>gmail.readonly</code>; the app never
            sends from Gmail (Resend handles outbound).
          </p>
          {justConnected && (
            <div className="mt-3 rounded bg-green-50 px-3 py-2 text-sm text-green-800">
              Gmail connected. First sync runs on the next 15-min tick.
            </div>
          )}
          <div className="mt-4">
            {/* We navigate the whole window — the Google consent page is a full redirect, not an XHR. */}
            <a href="/api/auth/gmail">
              <Button>Connect Gmail</Button>
            </a>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
