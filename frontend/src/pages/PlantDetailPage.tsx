import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { instancesApi } from "../api";
import PlantDetail from "../components/PlantDetail";
import InstanceEditModal from "../components/InstanceEditModal";

export default function PlantDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  const { data: plant, isLoading } = useQuery({
    queryKey: ["instance", id],
    queryFn: () => instancesApi.get(id),
    enabled: !!id,
  });

  const remove = useMutation({
    mutationFn: () => instancesApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instances"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      navigate("/plants");
    },
  });

  if (isLoading) return <p className="text-white/40">Loading…</p>;
  if (!plant) return <p className="text-white/40">Plant not found.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button className="btn-ghost text-sm py-1.5" onClick={() => navigate(-1)}>
          ← Back
        </button>
        <div className="flex items-center gap-2">
          <button className="btn-primary text-sm py-1.5" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button
            className="btn-ghost text-sm py-1.5 text-red-300"
            onClick={() => {
              if (confirm("Delete this plant?")) remove.mutate();
            }}
          >
            Delete
          </button>
        </div>
      </div>
      <PlantDetail plant={plant} />
      <InstanceEditModal plant={plant} open={editing} onClose={() => setEditing(false)} />
    </div>
  );
}
