import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import SpeciesPage from "./pages/SpeciesPage";
import PlantsPage from "./pages/PlantsPage";
import PlantDetailPage from "./pages/PlantDetailPage";
import OperationsPage from "./pages/OperationsPage";
import ScanPage from "./pages/ScanPage";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/species" element={<SpeciesPage />} />
        <Route path="/plants" element={<PlantsPage />} />
        <Route path="/plants/:id" element={<PlantDetailPage />} />
        <Route path="/ops" element={<OperationsPage />} />
        <Route path="/scan/:plantId" element={<ScanPage />} />
        <Route path="*" element={<Dashboard />} />
      </Routes>
    </Layout>
  );
}
