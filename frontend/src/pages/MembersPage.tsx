import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { membersApi } from "../api";
import type { MemberRole } from "../types";
import { useTenant } from "../tenant/TenantContext";

const ROLE_LABEL: Record<MemberRole, string> = {
  owner: "Owner",
  member: "Member",
};

export default function MembersPage() {
  const qc = useQueryClient();
  const { property, propertyId, isOwner } = useTenant();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("member");
  const [error, setError] = useState<string | null>(null);

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["members", propertyId],
    queryFn: () => membersApi.list(propertyId!),
    enabled: !!propertyId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["members", propertyId] });

  const add = useMutation({
    mutationFn: () => membersApi.add(propertyId!, { email: email.trim(), role }),
    onSuccess: () => {
      setEmail("");
      setRole("member");
      setError(null);
      invalidate();
    },
    onError: (e: unknown) => {
      const detail =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Could not add that person.";
      setError(detail);
    },
  });

  const updateRole = useMutation({
    mutationFn: ({ id, r }: { id: string; r: MemberRole }) =>
      membersApi.updateRole(propertyId!, id, r),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => membersApi.remove(propertyId!, id),
    onSuccess: invalidate,
  });

  if (!isOwner) {
    return (
      <div className="glass p-8 text-center text-white/60">
        Only the property owner can manage members.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Members</h1>
        <p className="text-white/50">
          People with access to <strong>{property?.name}</strong>. Owners manage plants and
          people; members manage plants only.
        </p>
      </div>

      {/* Invite by exact email */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) add.mutate();
        }}
        className="glass p-5 space-y-3"
      >
        <h2 className="font-display text-lg font-semibold">Add a member</h2>
        <p className="text-xs text-white/50">
          Enter the person's exact email address. For privacy, we don't search or suggest
          people — the invite is claimed when they sign in with that email.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="email"
            required
            className="input flex-1"
            placeholder="person@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select
            className="input sm:w-40"
            value={role}
            onChange={(e) => setRole(e.target.value as MemberRole)}
          >
            <option value="member">Member</option>
            <option value="owner">Owner</option>
          </select>
          <button className="btn-primary" disabled={add.isPending}>
            {add.isPending ? "Adding…" : "Add"}
          </button>
        </div>
        {error && <p className="text-sm text-red-300">{error}</p>}
      </form>

      {isLoading && <p className="text-white/40">Loading…</p>}

      <div className="space-y-2">
        {members.map((m) => {
          const isPropertyOwner = m.user_oid && m.user_oid === property?.owner_oid;
          return (
            <motion.div
              key={m.id}
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-soft p-4 flex items-center gap-3"
            >
              <span className="grid h-10 w-10 place-items-center rounded-full bg-canopy-500/20 text-canopy-200 text-sm font-bold shrink-0">
                {m.user_email.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold truncate">{m.user_email}</div>
                <div className="text-xs text-white/50">
                  {m.user_oid ? ROLE_LABEL[m.role] : "Invited · pending first sign-in"}
                  {isPropertyOwner ? " · property creator" : ""}
                </div>
              </div>
              {!isPropertyOwner && (
                <div className="flex items-center gap-2 shrink-0">
                  <select
                    className="input py-1.5 text-sm"
                    value={m.role}
                    onChange={(e) =>
                      updateRole.mutate({ id: m.id, r: e.target.value as MemberRole })
                    }
                  >
                    <option value="member">Member</option>
                    <option value="owner">Owner</option>
                  </select>
                  <button
                    className="btn-ghost text-sm py-1.5 text-red-300"
                    onClick={() => {
                      if (confirm(`Remove ${m.user_email}?`)) remove.mutate(m.id);
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
