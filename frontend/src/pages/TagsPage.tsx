import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { instancesApi, tagsApi } from "../api";
import type { EventType, PlantInstance, Tag, TagScope } from "../types";
import { useTenant } from "../tenant/TenantContext";

const TAG_COLORS = ["#45bd7b", "#7dd8a3", "#fbbf24", "#f87171", "#ec4899", "#60a5fa", "#a78bfa"];

const SCOPE_META: Record<string, { label: string; badge: string }> = {
  independent: { label: "Independent", badge: "bg-white/10 text-white/60" },
  garden: { label: "Garden", badge: "bg-canopy-500/20 text-canopy-200" },
  property: { label: "Property", badge: "bg-bloom-500/20 text-bloom-300" },
};

const BULK_ACTIONS: { type: EventType; label: string }[] = [
  { type: "watered", label: "💧 Water all" },
  { type: "fertilized", label: "🧪 Fertilize all" },
  { type: "pruned", label: "✂️ Prune all" },
];

function scopeKey(scope?: TagScope): keyof typeof SCOPE_META {
  return scope === "garden" ? "garden" : scope === "property" ? "property" : "independent";
}

function TagCard({
  tag,
  plants,
}: {
  tag: Tag;
  plants: PlantInstance[];
}) {
  const qc = useQueryClient();
  const { propertyId } = useTenant();
  const [managing, setManaging] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const tagged = useMemo(
    () => plants.filter((p) => p.tag_ids.includes(tag.id)),
    [plants, tag.id]
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["instances"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["tags"] });
  };

  const action = useMutation({
    mutationFn: (type: EventType) => tagsApi.runAction(propertyId!, tag.id, { type }),
    onSuccess: (r) => {
      setFlash(`Applied to ${r.affected} plant${r.affected === 1 ? "" : "s"}`);
      setTimeout(() => setFlash(null), 2500);
      invalidate();
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) =>
      on
        ? tagsApi.apply(propertyId!, tag.id, [id])
        : tagsApi.removeFromPlants(propertyId!, tag.id, [id]),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: () => tagsApi.remove(propertyId!, tag.id),
    onSuccess: invalidate,
  });

  const meta = SCOPE_META[scopeKey(tag.scope)];

  return (
    <motion.div layout initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="glass p-5 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span
            className="h-4 w-4 rounded-full"
            style={{ backgroundColor: tag.color || "#45bd7b" }}
          />
          <div>
            <h3 className="font-display text-lg font-semibold leading-tight">{tag.name}</h3>
            <span className="text-xs text-white/50">{tagged.length} plants</span>
          </div>
        </div>
        <span className={`pill text-[11px] ${meta.badge}`}>{meta.label}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {BULK_ACTIONS.map((a) => (
          <button
            key={a.type}
            className="btn-ghost text-sm py-1.5"
            disabled={tagged.length === 0 || action.isPending}
            onClick={() => action.mutate(a.type)}
          >
            {a.label}
          </button>
        ))}
      </div>

      <AnimatePresence>
        {flash && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-xs text-canopy-300"
          >
            ✓ {flash}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="flex gap-2 pt-1">
        <button className="btn-ghost text-sm py-1.5" onClick={() => setManaging((v) => !v)}>
          {managing ? "Done" : "Manage plants"}
        </button>
        <button
          className="btn-ghost text-sm py-1.5 text-red-300"
          onClick={() => {
            if (confirm(`Delete group "${tag.name}"?`)) remove.mutate();
          }}
        >
          Delete
        </button>
      </div>

      <AnimatePresence>
        {managing && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2 max-h-56 overflow-y-auto no-scrollbar space-y-1">
              {plants.length === 0 && (
                <p className="text-xs text-white/40">No plants yet.</p>
              )}
              {plants.map((p) => {
                const on = p.tag_ids.includes(tag.id);
                return (
                  <label
                    key={p.id}
                    className="flex items-center gap-2 text-sm rounded-lg px-2 py-1.5 hover:bg-white/5 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => toggle.mutate({ id: p.id, on: e.target.checked })}
                    />
                    <span className="truncate">
                      {p.nickname || p.plant_class?.common_name || "Unnamed"}
                    </span>
                    {p.location && (
                      <span className="ml-auto text-xs text-white/40">{p.location}</span>
                    )}
                  </label>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function TagsPage() {
  const qc = useQueryClient();
  const { propertyId, gardens } = useTenant();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"independent" | "garden" | "property">("independent");
  const [gardenId, setGardenId] = useState("");
  const [color, setColor] = useState(TAG_COLORS[0]);

  const { data: tags = [], isLoading } = useQuery({
    queryKey: ["tags", propertyId],
    queryFn: () => tagsApi.list(propertyId!),
    enabled: !!propertyId,
  });
  const { data: plants = [] } = useQuery({
    queryKey: ["instances", propertyId, null],
    queryFn: () => instancesApi.list(propertyId!),
    enabled: !!propertyId,
  });

  const create = useMutation({
    mutationFn: () =>
      tagsApi.create(propertyId!, {
        name: name.trim(),
        color,
        scope: scope === "independent" ? null : scope,
        garden_id: scope === "garden" ? gardenId : null,
      }),
    onSuccess: () => {
      setName("");
      setScope("independent");
      setGardenId("");
      qc.invalidateQueries({ queryKey: ["tags", propertyId] });
    },
  });

  const canCreate =
    name.trim().length > 0 && (scope !== "garden" || gardenId.length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Groups</h1>
        <p className="text-white/50">
          Tag plants into groups, then water or fertilize the whole group at once.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canCreate) create.mutate();
        }}
        className="glass p-5 space-y-3"
      >
        <h2 className="font-display text-lg font-semibold">New group</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Name *</label>
            <input
              className="input"
              placeholder="Thirsty tropicals"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Scope</label>
            <select
              className="input"
              value={scope}
              onChange={(e) => setScope(e.target.value as typeof scope)}
            >
              <option value="independent">Independent (any plants)</option>
              <option value="property">Whole property</option>
              <option value="garden">A single garden</option>
            </select>
          </div>
        </div>
        {scope === "garden" && (
          <div>
            <label className="label">Garden *</label>
            <select
              className="input"
              value={gardenId}
              onChange={(e) => setGardenId(e.target.value)}
            >
              <option value="">Select a garden…</option>
              {gardens.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label">Color</label>
          <div className="flex gap-2">
            {TAG_COLORS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setColor(c)}
                className={`h-7 w-7 rounded-full border-2 ${
                  color === c ? "border-white" : "border-transparent"
                }`}
                style={{ backgroundColor: c }}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
        </div>
        <div className="flex justify-end">
          <button className="btn-primary" disabled={!canCreate || create.isPending}>
            {create.isPending ? "Creating…" : "Create group"}
          </button>
        </div>
      </form>

      {isLoading && <p className="text-white/40">Loading…</p>}

      {tags.length === 0 && !isLoading ? (
        <div className="glass p-10 text-center text-white/60">
          <div className="text-5xl mb-3">🏷️</div>
          No groups yet. Create one above to batch-care your plants.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tags.map((t) => (
            <TagCard key={t.id} tag={t} plants={plants} />
          ))}
        </div>
      )}
    </div>
  );
}
