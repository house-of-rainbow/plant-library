import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { patsApi, type PersonalAccessTokenCreated } from "../api";

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  throw new Error("Clipboard API unavailable");
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

export default function AccessTokensPage() {
  const qc = useQueryClient();
  const [latest, setLatest] = useState<PersonalAccessTokenCreated | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "done" | "error">("idle");

  const { data: tokenIds = [], isLoading } = useQuery({
    queryKey: ["personal-access-tokens"],
    queryFn: patsApi.list,
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["personal-access-tokens"] });

  const create = useMutation({
    mutationFn: patsApi.create,
    onSuccess: (created) => {
      setLatest(created);
      setCopyState("idle");
      invalidate();
    },
  });

  const revoke = useMutation({
    mutationFn: (tokenId: string) => patsApi.remove(tokenId),
    onSuccess: () => {
      invalidate();
      setLatest((current) =>
        current && !tokenIds.includes(current.id) ? current : current
      );
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold">Personal Access Tokens</h1>
          <p className="max-w-2xl text-white/55">
            Tokens are long-lived bearer credentials for API and MCP access. The
            plaintext token is shown only once when it is created; the server stores
            only a hash and later listings return identifiers only.
          </p>
        </div>
        <button className="btn-primary" onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Create token"}
        </button>
      </div>

      {latest && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass border border-canopy-400/30 p-5"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2 min-w-0">
              <div className="pill bg-canopy-500/20 text-canopy-200">Shown once</div>
              <h2 className="font-display text-xl font-semibold">New token ready</h2>
              <p className="text-sm text-white/60">
                Copy this now. After you leave this state, only the identifier will be
                available from the API.
              </p>
              <div className="rounded-2xl bg-black/40 border border-white/10 p-4 overflow-x-auto">
                <code className="text-sm text-canopy-100 break-all">{latest.token}</code>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-white/50">
                <span className="pill bg-white/5">ID {latest.id}</span>
                <span className="pill bg-white/5">Expires {formatDate(latest.expires_at)}</span>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                className="btn-primary"
                onClick={async () => {
                  try {
                    await copyText(latest.token);
                    setCopyState("done");
                  } catch {
                    setCopyState("error");
                  }
                }}
              >
                {copyState === "done" ? "Copied" : "Copy token"}
              </button>
              <button className="btn-ghost" onClick={() => setLatest(null)}>
                Dismiss
              </button>
            </div>
          </div>
          {copyState === "error" && (
            <p className="mt-3 text-sm text-amber-300">
              Clipboard access failed. Copy the token manually before dismissing.
            </p>
          )}
        </motion.section>
      )}

      <section className="glass p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold">Issued token identifiers</h2>
            <p className="text-sm text-white/50">
              This list is identifier-only by design. The token value cannot be recovered.
            </p>
          </div>
          <div className="pill bg-white/5 text-white/60">{tokenIds.length} active</div>
        </div>

        {isLoading && <p className="text-white/40">Loading token identifiers…</p>}

        {!isLoading && tokenIds.length === 0 && (
          <div className="glass-soft p-6 text-center text-white/55">
            No personal access tokens have been created yet.
          </div>
        )}

        <div className="space-y-2">
          {tokenIds.map((tokenId) => (
            <motion.div
              key={tokenId}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-soft p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="label mb-2">Identifier</div>
                <code className="text-sm text-white/85 break-all">{tokenId}</code>
              </div>
              <button
                className="btn-ghost text-red-300"
                disabled={revoke.isPending}
                onClick={() => {
                  if (confirm(`Revoke token ${tokenId}?`)) revoke.mutate(tokenId);
                }}
              >
                Revoke
              </button>
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  );
}