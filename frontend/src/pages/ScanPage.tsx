import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { scanApi } from "../api";
import PlantDetail from "../components/PlantDetail";

export default function ScanPage() {
  const { plantId = "" } = useParams();

  const { data: plant, isLoading, isError } = useQuery({
    queryKey: ["scan", plantId],
    queryFn: () => scanApi.resolve(plantId),
    enabled: !!plantId,
    retry: false,
  });

  return (
    <div className="min-h-screen px-4 py-6 max-w-2xl mx-auto">
      <Link to="/ops" className="inline-flex items-center gap-2 text-white/60 mb-4">
        ← Operations
      </Link>

      {isLoading && (
        <div className="glass p-10 text-center">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
            className="text-4xl inline-block"
          >
            🌀
          </motion.div>
          <p className="mt-3 text-white/50">Reading label…</p>
        </div>
      )}

      {isError && (
        <div className="glass p-10 text-center">
          <div className="text-5xl mb-3">🔍</div>
          <p className="text-lg font-medium">No plant matches this label.</p>
          <code className="text-xs text-white/40">{plantId}</code>
        </div>
      )}

      {plant && <PlantDetail plant={plant} compact />}
    </div>
  );
}
