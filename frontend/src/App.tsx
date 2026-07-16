import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import SpeciesPage from "./pages/SpeciesPage";
import PlantsPage from "./pages/PlantsPage";
import PlantDetailPage from "./pages/PlantDetailPage";
import OperationsPage from "./pages/OperationsPage";
import ScanPage from "./pages/ScanPage";
import MembersPage from "./pages/MembersPage";
import TagsPage from "./pages/TagsPage";
import PropertyWizard from "./components/wizard/PropertyWizard";
import { useTenant } from "./tenant/TenantContext";

function OnboardingGate() {
  const { setPropertyId, refresh } = useTenant();
  return (
    <PropertyWizard
      isFirst
      onCreated={async (property) => {
        await refresh();
        setPropertyId(property.id);
      }}
    />
  );
}

export default function App() {
  const { isLoading, hasProperties } = useTenant();

  if (isLoading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="glass px-6 py-4 text-white/60">Loading your gardens…</div>
      </div>
    );
  }

  // A user with no properties must create one before entering the app.
  if (!hasProperties) {
    return <OnboardingGate />;
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/species" element={<SpeciesPage />} />
        <Route path="/plants" element={<PlantsPage />} />
        <Route path="/plants/:id" element={<PlantDetailPage />} />
        <Route path="/groups" element={<TagsPage />} />
        <Route path="/members" element={<MembersPage />} />
        <Route path="/ops" element={<OperationsPage />} />
        <Route path="/scan/:plantId" element={<ScanPage />} />
        <Route path="*" element={<Dashboard />} />
      </Routes>
    </Layout>
  );
}
