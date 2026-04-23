import { Route, Switch, Redirect } from "wouter";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import DealsPage from "./pages/DealsPage";
import DealDetailPage from "./pages/DealDetailPage";
import InvestorsPage from "./pages/InvestorsPage";
import InvestorDetailPage from "./pages/InvestorDetailPage";
import InvestorImportPage from "./pages/InvestorImportPage";
import SettingsPage from "./pages/SettingsPage";
import DistributionsListPage from "./pages/DistributionsListPage";
import DistributionWizardPage from "./pages/DistributionWizardPage";
import DistributionDetailPage from "./pages/DistributionDetailPage";
import CapitalCallsListPage from "./pages/CapitalCallsListPage";
import CapitalCallWizardPage from "./pages/CapitalCallWizardPage";
import CapitalCallDetailPage from "./pages/CapitalCallDetailPage";
import LedgerPage from "./pages/LedgerPage";
import AppShell from "./components/layout/AppShell";

function AuthedRoutes() {
  return (
    <AppShell>
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/deals" component={DealsPage} />
        <Route path="/deals/:id" component={DealDetailPage} />
        <Route path="/investors" component={InvestorsPage} />
        <Route path="/investors/import" component={InvestorImportPage} />
        <Route path="/investors/:id" component={InvestorDetailPage} />
        <Route path="/distributions" component={DistributionsListPage} />
        <Route path="/distributions/new" component={DistributionWizardPage} />
        <Route path="/distributions/:id" component={DistributionDetailPage} />
        <Route path="/capital-calls" component={CapitalCallsListPage} />
        <Route path="/capital-calls/new" component={CapitalCallWizardPage} />
        <Route path="/capital-calls/:id" component={CapitalCallDetailPage} />
        <Route path="/admin/ledger" component={LedgerPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route>
          <Redirect to="/" />
        </Route>
      </Switch>
    </AppShell>
  );
}

function Gate() {
  const { loading, user } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-coyote-700">
        Loading…
      </div>
    );
  }
  if (!user) return <LoginPage />;
  if (user.role !== "gp") {
    // Phase 4 will handle the LP portal; for Phase 1, only GP is wired up.
    return (
      <div className="flex h-screen items-center justify-center text-coyote-700">
        LP portal not yet available.
      </div>
    );
  }
  return <AuthedRoutes />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
