"use client";

import { useState } from "react";
import { AnalysisResult } from "@/lib/types";

export default function Home() {
  const [teamId, setTeamId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault();
    if (!teamId.trim()) return;

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: teamId.trim() }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-950 via-slate-900 to-emerald-950">
      {/* Header */}
      <header className="border-b border-white/10 bg-black/20 backdrop-blur-sm">
        <div className="mx-auto max-w-5xl px-4 py-4 flex items-center gap-3">
          <div className="text-2xl">&#9917;</div>
          <div>
            <h1 className="text-xl font-bold text-white">FPL Recommender</h1>
            <p className="text-sm text-slate-400">
              AI-powered transfer suggestions
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        {/* Search */}
        <div className="rounded-2xl bg-white/5 border border-white/10 p-6 backdrop-blur-sm">
          <h2 className="text-lg font-semibold text-white mb-2">
            Analyze Your Team
          </h2>
          <p className="text-sm text-slate-400 mb-4">
            Enter your FPL team ID to get personalized transfer recommendations.
            Find it in the URL when you view your team on the FPL website.
          </p>
          <form onSubmit={handleAnalyze} className="flex gap-3">
            <input
              type="text"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              placeholder="e.g. 1234567"
              className="flex-1 rounded-xl bg-white/10 border border-white/20 px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
            <button
              type="submit"
              disabled={loading || !teamId.trim()}
              className="rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-white transition-all hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg
                    className="animate-spin h-5 w-5"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Analyzing...
                </span>
              ) : (
                "Analyze"
              )}
            </button>
          </form>
        </div>

        {/* Error */}
        {error && (
          <div className="mt-6 rounded-2xl bg-red-500/10 border border-red-500/30 p-4 text-red-300">
            {error}
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="mt-8 space-y-6">
            {/* Team Overview */}
            <div className="rounded-2xl bg-white/5 border border-white/10 p-6 backdrop-blur-sm">
              <h2 className="text-lg font-semibold text-white mb-4">
                Team Overview
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat label="Team" value={result.teamInfo.name} />
                <Stat label="Manager" value={result.teamInfo.managerName} />
                <Stat
                  label="Overall Rank"
                  value={result.teamInfo.overallRank.toLocaleString()}
                />
                <Stat
                  label="Bank"
                  value={`£${result.teamInfo.bank.toFixed(1)}m`}
                />
              </div>
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat
                  label="Total Points"
                  value={result.teamInfo.overallPoints.toString()}
                />
                <Stat
                  label="Team Value"
                  value={`£${result.teamInfo.teamValue.toFixed(1)}m`}
                />
                <Stat
                  label="Gameweek"
                  value={`GW${result.currentGameweek}`}
                />
              </div>
            </div>

            {/* Weaknesses */}
            {result.weaknesses.length > 0 && (
              <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-6">
                <h2 className="text-lg font-semibold text-amber-300 mb-3">
                  Team Weaknesses
                </h2>
                <ul className="space-y-2">
                  {result.weaknesses.map((w, i) => (
                    <li key={i} className="flex items-start gap-2 text-amber-200">
                      <span className="mt-0.5 text-amber-500">&#9888;</span>
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Current Squad */}
            <div className="rounded-2xl bg-white/5 border border-white/10 p-6 backdrop-blur-sm">
              <h2 className="text-lg font-semibold text-white mb-4">
                Current Squad
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-400 border-b border-white/10">
                      <th className="text-left py-2 pr-4">Player</th>
                      <th className="text-left py-2 pr-4">Pos</th>
                      <th className="text-left py-2 pr-4">Team</th>
                      <th className="text-right py-2 pr-4">Form</th>
                      <th className="text-right py-2 pr-4">Price</th>
                      <th className="text-left py-2 pr-4">Fixtures</th>
                      <th className="text-right py-2">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.squad.map((p) => (
                      <tr
                        key={p.player.id}
                        className={`border-b border-white/5 ${
                          p.weaknesses.length > 0
                            ? "text-red-300"
                            : "text-slate-200"
                        }`}
                      >
                        <td className="py-2 pr-4 font-medium">
                          {p.player.web_name}
                          {p.player.status !== "a" && (
                            <span className="ml-1 text-xs text-red-400">
                              [{p.player.status.toUpperCase()}]
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          <span
                            className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${positionColor(p.position)}`}
                          >
                            {p.position}
                          </span>
                        </td>
                        <td className="py-2 pr-4">{p.teamName}</td>
                        <td className="py-2 pr-4 text-right">
                          {parseFloat(p.player.form).toFixed(1)}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          £{(p.player.now_cost / 10).toFixed(1)}m
                        </td>
                        <td className="py-2 pr-4">
                          <div className="flex gap-1">
                            {p.upcomingFixtures.slice(0, 5).map((f, i) => (
                              <span
                                key={i}
                                className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${difficultyColor(f.difficulty)}`}
                                title={`GW${f.gameweek}: ${f.isHome ? "H" : "A"} vs ${f.opponent}`}
                              >
                                {f.opponent}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2 text-right font-mono">
                          {p.score.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Transfer Recommendations */}
            <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-6">
              <h2 className="text-lg font-semibold text-emerald-300 mb-4">
                Recommended Transfers
              </h2>
              {result.recommendations.length === 0 ? (
                <p className="text-slate-400">
                  Your team looks solid! No urgent transfers needed.
                </p>
              ) : (
                <div className="space-y-4">
                  {result.recommendations.map((rec, i) => (
                    <div
                      key={i}
                      className="rounded-xl bg-white/5 border border-white/10 p-4"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-bold text-emerald-400 bg-emerald-500/20 rounded-full px-3 py-1">
                          Transfer {i + 1}
                          {rec.expertBacked && " - Expert Backed"}
                        </span>
                        <span
                          className={`text-sm font-medium ${rec.netCost > 0 ? "text-red-400" : "text-emerald-400"}`}
                        >
                          {rec.netCost > 0
                            ? `+£${rec.netCost.toFixed(1)}m`
                            : rec.netCost < 0
                              ? `-£${Math.abs(rec.netCost).toFixed(1)}m`
                              : "Free"}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 mb-3">
                        <div className="flex-1 text-center">
                          <div className="text-red-400 text-xs mb-1">OUT</div>
                          <div className="text-white font-semibold">
                            {rec.playerOut.player.web_name}
                          </div>
                          <div className="text-slate-400 text-xs">
                            {rec.playerOut.teamName} &middot; £
                            {(rec.playerOut.player.now_cost / 10).toFixed(1)}m
                            &middot; Form{" "}
                            {parseFloat(rec.playerOut.player.form).toFixed(1)}
                          </div>
                        </div>
                        <div className="text-2xl text-slate-500">&#8594;</div>
                        <div className="flex-1 text-center">
                          <div className="text-emerald-400 text-xs mb-1">
                            IN
                          </div>
                          <div className="text-white font-semibold">
                            {rec.playerIn.player.web_name}
                          </div>
                          <div className="text-slate-400 text-xs">
                            {rec.playerIn.teamName} &middot; £
                            {(rec.playerIn.player.now_cost / 10).toFixed(1)}m
                            &middot; Form{" "}
                            {parseFloat(rec.playerIn.player.form).toFixed(1)}
                          </div>
                        </div>
                      </div>
                      <div className="space-y-1">
                        {rec.reasoning.map((r, j) => (
                          <div
                            key={j}
                            className="text-xs text-slate-400 flex items-start gap-1.5"
                          >
                            <span className="text-emerald-500 mt-0.5">
                              &#10003;
                            </span>
                            {r}
                          </div>
                        ))}
                      </div>
                      {/* Upcoming fixtures comparison */}
                      <div className="mt-3 grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-xs text-slate-500 mb-1">
                            {rec.playerOut.player.web_name}&apos;s fixtures
                          </div>
                          <div className="flex gap-1">
                            {rec.playerOut.upcomingFixtures
                              .slice(0, 5)
                              .map((f, k) => (
                                <span
                                  key={k}
                                  className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${difficultyColor(f.difficulty)}`}
                                >
                                  {f.opponent}
                                </span>
                              ))}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500 mb-1">
                            {rec.playerIn.player.web_name}&apos;s fixtures
                          </div>
                          <div className="flex gap-1">
                            {rec.playerIn.upcomingFixtures
                              .slice(0, 5)
                              .map((f, k) => (
                                <span
                                  key={k}
                                  className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${difficultyColor(f.difficulty)}`}
                                >
                                  {f.opponent}
                                </span>
                              ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="mt-8 space-y-6">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-2xl bg-white/5 border border-white/10 p-6 animate-pulse"
              >
                <div className="h-4 bg-white/10 rounded w-1/3 mb-4"></div>
                <div className="space-y-3">
                  <div className="h-3 bg-white/10 rounded w-full"></div>
                  <div className="h-3 bg-white/10 rounded w-2/3"></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 mt-auto">
        <div className="mx-auto max-w-5xl px-4 py-4 text-center text-xs text-slate-500">
          Data from the official Fantasy Premier League API. Not affiliated with
          the Premier League.
        </div>
      </footer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-white font-semibold truncate">{value}</div>
    </div>
  );
}

function positionColor(pos: string): string {
  const colors: Record<string, string> = {
    GK: "bg-amber-500/20 text-amber-300",
    DEF: "bg-blue-500/20 text-blue-300",
    MID: "bg-emerald-500/20 text-emerald-300",
    FWD: "bg-red-500/20 text-red-300",
  };
  return colors[pos] || "bg-slate-500/20 text-slate-300";
}

function difficultyColor(difficulty: number): string {
  if (difficulty <= 2) return "bg-emerald-500/30 text-emerald-300";
  if (difficulty === 3) return "bg-slate-500/30 text-slate-300";
  if (difficulty === 4) return "bg-amber-500/30 text-amber-300";
  return "bg-red-500/30 text-red-300";
}
