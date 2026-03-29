"use client";

import { useState, useEffect, useRef } from "react";
import { AnalysisResult, QuickTeamResult } from "@/lib/types";

interface RankHistoryEntry {
  event: number;
  overallRank: number;
  points: number;
  totalPoints: number;
  gwAverage: number;
}

type QuickDataWithHistory = QuickTeamResult & { rankHistory?: RankHistoryEntry[] };

interface OtherTarget {
  name: string;
  team: string;
  position: string;
  form: number;
  price: number;
  score: number;
  isScoutPick: boolean;
  fixtures: { opponent: string; difficulty: number; isHome: boolean }[];
}

type Phase = "idle" | "loading-quick" | "quick-ready" | "loading-full" | "done" | "error";

export default function Home() {
  const [teamId, setTeamId] = useState("4547539");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [quickData, setQuickData] = useState<QuickDataWithHistory | null>(null);
  const [fullData, setFullData] = useState<(AnalysisResult & { otherTargets?: OtherTarget[]; scoutGW?: number | null }) | null>(null);
  const recsRef = useRef<HTMLDivElement>(null);

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault();
    if (!teamId.trim()) return;

    setPhase("loading-quick");
    setError("");
    setQuickData(null);
    setFullData(null);

    try {
      // Phase 1: Quick team overview
      const quickRes = await fetch("/api/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: teamId.trim() }),
      });
      const quick = await quickRes.json();
      if (!quickRes.ok) throw new Error(quick.error || "Failed to load team");
      setQuickData(quick);
      setPhase("quick-ready");

      // Phase 2: Full analysis (starts immediately, renders when ready)
      setPhase("loading-full");
      const fullRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: teamId.trim() }),
      });
      const full = await fullRes.json();
      if (!fullRes.ok) throw new Error(full.error || "Analysis failed");
      setFullData(full);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setPhase("error");
    }
  }

  // Auto-load default team on mount
  useEffect(() => {
    if (teamId && phase === "idle") {
      handleAnalyze({ preventDefault: () => {} } as React.FormEvent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll to recommendations when they load
  useEffect(() => {
    if (phase === "done" && recsRef.current) {
      recsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [phase]);

  const showQuick = quickData && phase !== "idle" && phase !== "loading-quick";
  const showFull = fullData && phase === "done";
  const isAnalyzing = phase === "loading-full";

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
          <form onSubmit={handleAnalyze} className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              placeholder="e.g. 1234567"
              className="flex-1 rounded-xl bg-white/10 border border-white/20 px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
            <button
              type="submit"
              disabled={phase === "loading-quick" || phase === "loading-full" || !teamId.trim()}
              className="rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-white transition-all hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {phase === "loading-quick" ? (
                <SpinnerText text="Loading..." />
              ) : phase === "loading-full" ? (
                <SpinnerText text="Analyzing..." />
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

        {/* Loading skeleton for quick data */}
        {phase === "loading-quick" && <QuickSkeleton />}

        {/* Quick Data: Team Overview + Leagues */}
        {showQuick && quickData && (
          <div className="mt-8 space-y-6">
            {/* Team Overview */}
            <div className="rounded-2xl bg-white/5 border border-white/10 p-6 backdrop-blur-sm">
              <h2 className="text-lg font-semibold text-white mb-4">
                Team Overview
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat label="Team" value={quickData.teamInfo.name} />
                <Stat label="Manager" value={quickData.teamInfo.managerName} />
                <Stat
                  label="Overall Rank"
                  value={quickData.teamInfo.overallRank.toLocaleString()}
                />
                <Stat
                  label="Bank"
                  value={`\u00A3${quickData.teamInfo.bank.toFixed(1)}m`}
                />
              </div>
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat
                  label="Total Points"
                  value={quickData.teamInfo.overallPoints.toString()}
                />
                <Stat
                  label="Team Value"
                  value={`\u00A3${quickData.teamInfo.teamValue.toFixed(1)}m`}
                />
                <Stat
                  label="Gameweek"
                  value={`GW${quickData.currentGameweek}`}
                />
              </div>
            </div>

            {/* Rank History Chart */}
            {quickData.rankHistory && quickData.rankHistory.length > 0 && (
              <RankChart history={quickData.rankHistory} />
            )}

            {/* Mini Leagues */}
            {quickData.leagues.length > 0 && (
              <LeagueSection
                leagues={quickData.leagues}
                teamId={teamId}
              />
            )}

            {/* Squad summary removed — detailed analysis table below covers this */}

            {/* Scroll indicator while loading */}
            {isAnalyzing && (
              <div className="flex flex-col items-center mt-4 animate-bounce">
                <span className="text-slate-500 text-xs mb-1">Detailed analysis loading below</span>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M10 4v10m0 0l-4-4m4 4l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-slate-500" />
                </svg>
              </div>
            )}
          </div>
        )}

        {/* Scroll indicator after full load */}
        {showFull && fullData && (
          <div className="flex flex-col items-center mt-2 mb-2 animate-bounce">
            <span className="text-slate-500 text-xs mb-1">Scroll for detailed analysis & recommendations</span>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M10 4v10m0 0l-4-4m4 4l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-slate-500" />
            </svg>
          </div>
        )}

        {/* Full Analysis Results */}
        {showFull && fullData && (
          <div className="mt-8 space-y-6" ref={recsRef}>
            {/* Weaknesses */}
            {fullData.weaknesses.length > 0 && (
              <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-6">
                <h2 className="text-lg font-semibold text-amber-300 mb-3">
                  Team Weaknesses
                </h2>
                <ul className="space-y-2">
                  {fullData.weaknesses.map((w, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-amber-200"
                    >
                      <span className="mt-0.5 text-amber-500">&#9888;</span>
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Detailed Squad with rolling stats */}
            <div className="rounded-2xl bg-white/5 border border-white/10 p-6 backdrop-blur-sm">
              <h2 className="text-lg font-semibold text-white mb-4">
                Detailed Squad Analysis
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-400 border-b border-white/10">
                      <th className="text-left py-2 pr-3">Player</th>
                      <th className="text-left py-2 pr-3">Pos</th>
                      <th className="text-left py-2 pr-3">Team</th>
                      <th className="text-right py-2 pr-3">Price</th>
                      <th className="text-right py-2 pr-3">Form</th>
                      <th className="text-right py-2 pr-3">npxG/90</th>
                      <th className="text-right py-2 pr-3">xA/90</th>
                      <th className="text-right py-2 pr-3">Def/90</th>
                      <th className="text-left py-2 pr-3">Fixtures</th>
                      <th className="text-center py-2 pr-3">PK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fullData.squad.map((p) => (
                      <tr
                        key={p.player.id}
                        className="border-b border-white/5 text-slate-200"
                      >
                        <td className="py-2 pr-3 font-medium">
                          {p.player.web_name}
                          {p.player.status !== "a" && (
                            <span
                              className={`ml-1 text-xs ${p.player.status === "i" || p.player.status === "s" ? "text-red-400" : "text-amber-400"}`}
                              title={p.player.status === "i" ? "Injured" : p.player.status === "d" ? "Doubtful" : p.player.status === "s" ? "Suspended" : "Unavailable"}
                            >
                              &#9888;
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <span
                            className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${positionColor(p.position)}`}
                          >
                            {p.position}
                          </span>
                        </td>
                        <td className="py-2 pr-3">{p.teamName}</td>
                        <td className="py-2 pr-3 text-right">
                          {"\u00A3"}{(p.player.now_cost / 10).toFixed(1)}m
                        </td>
                        <td className="py-2 pr-3 text-right">
                          {parseFloat(p.player.form).toFixed(1)}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          {p.position === "GK"
                            ? `${p.rollingStats.savesPer90.toFixed(1)}s`
                            : p.rollingStats.npxGPer90.toFixed(2)}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          {p.position === "GK"
                            ? `${p.rollingStats.xGCPer90.toFixed(1)}c`
                            : p.rollingStats.xAPer90.toFixed(2)}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          {p.position !== "GK"
                            ? p.rollingStats.defensiveContribPer90.toFixed(1)
                            : "-"}
                        </td>
                        <td className="py-2 pr-3">
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
                        <td className="py-2 pr-3 text-center">
                          {p.isPenaltyTaker ? (
                            <span className="text-emerald-400">&#10003;</span>
                          ) : (
                            ""
                          )}
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
              {fullData.recommendations.length === 0 ? (
                <p className="text-slate-400">
                  Your team looks solid! No urgent transfers needed.
                </p>
              ) : (
                <div className="space-y-4">
                  {fullData.recommendations.map((rec, i) => (
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
                            ? `+\u00A3${rec.netCost.toFixed(1)}m`
                            : rec.netCost < 0
                              ? `-\u00A3${Math.abs(rec.netCost).toFixed(1)}m`
                              : "Free"}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 mb-3">
                        <PlayerCard
                          label="OUT"
                          labelColor="text-red-400"
                          player={rec.playerOut}
                        />
                        <div className="text-2xl text-slate-500">&#8594;</div>
                        <PlayerCard
                          label="IN"
                          labelColor="text-emerald-400"
                          player={rec.playerIn}
                        />
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
                      {/* Fixture comparison */}
                      <div className="mt-3 grid grid-cols-2 gap-4">
                        <FixtureRow
                          label={rec.playerOut.player.web_name}
                          fixtures={rec.playerOut.upcomingFixtures}
                        />
                        <FixtureRow
                          label={rec.playerIn.player.web_name}
                          fixtures={rec.playerIn.upcomingFixtures}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Other Targets */}
            {fullData.otherTargets &&
              fullData.otherTargets.length > 0 && (
              <div className="rounded-2xl bg-white/5 border border-white/10 p-6 backdrop-blur-sm">
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-lg font-semibold text-white">
                    Other Targets
                  </h2>
                  {fullData.scoutGW && (
                    <span className="text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full">
                      Cross-verified with AllAboutFPL GW{String(fullData.scoutGW)} Scout
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  Top-rated players not in your squad or recommendations
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {fullData.otherTargets.map((t) => (
                    <div
                      key={t.name}
                      className={`rounded-xl border p-3 ${
                        t.isScoutPick
                          ? "bg-purple-500/10 border-purple-500/30"
                          : "bg-white/5 border-white/10"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-white font-semibold text-sm">
                          {t.name}
                          {t.isScoutPick && (
                            <span className="ml-1.5 text-xs text-purple-300" title="AllAboutFPL Scout Pick">
                              SCOUT
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-slate-400">
                          {"\u00A3"}{t.price.toFixed(1)}m
                        </span>
                      </div>
                      <div className="text-xs text-slate-400">
                        {t.position} &middot; {t.team} &middot; Form {t.form.toFixed(1)}
                      </div>
                      {t.fixtures && t.fixtures.length > 0 && (
                        <div className="flex gap-1 mt-2">
                          {t.fixtures.map((f: { opponent: string; difficulty: number; isHome: boolean }, i: number) => (
                            <span
                              key={i}
                              className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${difficultyColor(f.difficulty)}`}
                            >
                              {f.opponent}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Generating skeleton (shown while full analysis loads) */}
        {isAnalyzing && (
          <div className="mt-8 space-y-6">
            <div className="rounded-2xl bg-white/5 border border-white/10 p-6 backdrop-blur-sm">
              <div className="flex items-center gap-3 mb-4">
                <svg
                  className="animate-spin h-5 w-5 text-emerald-400"
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
                <span className="text-emerald-300 font-medium">
                  Analyzing squad &amp; finding transfers...
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Fetching per-game stats for ~135 players, computing rolling
                averages, cross-referencing experts...
              </p>
              <div className="mt-4 space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="animate-pulse">
                    <div className="h-3 bg-white/10 rounded w-full mb-2"></div>
                    <div className="h-3 bg-white/5 rounded w-2/3"></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 mt-auto">
        <div className="mx-auto max-w-5xl px-4 py-4 text-center text-xs text-slate-500">
          <p>Data from the official Fantasy Premier League API. Not affiliated with the Premier League.</p>
          <p className="mt-1">Made by Mustafa Bengali for fun only :P</p>
        </div>
      </footer>
    </div>
  );
}

// ─── Components ───────────────────────────────────────────────────

function SpinnerText({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-2">
      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
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
      {text}
    </span>
  );
}

function QuickSkeleton() {
  return (
    <div className="mt-8 space-y-6">
      {[1, 2].map((i) => (
        <div
          key={i}
          className="rounded-2xl bg-white/5 border border-white/10 p-6 animate-pulse"
        >
          <div className="h-4 bg-white/10 rounded w-1/3 mb-4"></div>
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((j) => (
              <div key={j}>
                <div className="h-3 bg-white/5 rounded w-full mb-2"></div>
                <div className="h-4 bg-white/10 rounded w-2/3"></div>
              </div>
            ))}
          </div>
        </div>
      ))}
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

interface LeagueData {
  id: number;
  name: string;
  rank: number;
  totalEntries: number;
  rankChange: number;
  percentile: number;
}

interface StrategyFixture {
  opponent: string;
  difficulty: number;
  isHome: boolean;
}

interface StrategyPlayer {
  name: string;
  team: string;
  position: string;
  form: number;
  price: number;
  ownedByRivals: number;
  totalRivals: number;
  selectedPct: string;
  fixtures: StrategyFixture[];
  userOwns?: boolean;
}

interface StrategyResult {
  leagueName: string;
  userRank: number;
  userPoints: number;
  attack: {
    enabled: boolean;
    rivals: { name: string; points: number; rank: number }[];
    suggestions: StrategyPlayer[];
  };
  defend: {
    enabled: boolean;
    rivals: { name: string; points: number; rank: number }[];
    suggestions: StrategyPlayer[];
  };
}

function LeagueSection({
  leagues,
  teamId,
}: {
  leagues: LeagueData[];
  teamId: string;
}) {
  const [selectedLeague, setSelectedLeague] = useState<number | null>(null);
  const [strategy, setStrategy] = useState<StrategyResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLeagueClick(league: LeagueData) {
    if (selectedLeague === league.id) {
      setSelectedLeague(null);
      setStrategy(null);
      return;
    }
    setSelectedLeague(league.id);
    setStrategy(null);
    setLoading(true);
    try {
      const res = await fetch("/api/league-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId: league.id, teamId: teamId.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setStrategy(data);
      } else {
        setStrategy({ error: data.error } as unknown as StrategyResult);
      }
    } catch {
      setStrategy({ error: "Failed to connect" } as unknown as StrategyResult);
    }
    setLoading(false);
  }

  return (
    <div className="rounded-2xl bg-white/5 border border-white/10 p-6 backdrop-blur-sm">
      <h2 className="text-lg font-semibold text-white mb-1">
        League Standings
      </h2>
      <p className="text-xs text-slate-400 mb-4">
        Tap a league below for attack/defend strategy
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {leagues.map((league) => (
          <div key={league.id}>
            <div
              onClick={() => handleLeagueClick(league)}
              className={`rounded-xl bg-white/5 border p-4 cursor-pointer transition-all hover:bg-white/10 ${
                selectedLeague === league.id
                  ? "border-emerald-500/50 bg-white/10"
                  : "border-white/5"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-white font-medium truncate pr-2">
                  {league.name}
                </span>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    league.rankChange > 0
                      ? "bg-emerald-500/20 text-emerald-300"
                      : league.rankChange < 0
                        ? "bg-red-500/20 text-red-300"
                        : "bg-slate-500/20 text-slate-300"
                  }`}
                >
                  {league.rankChange > 0
                    ? `+${league.rankChange}`
                    : league.rankChange < 0
                      ? `${league.rankChange}`
                      : "-"}
                </span>
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <span className="text-2xl font-bold text-white">
                    {league.rank.toLocaleString()}
                  </span>
                  <span className="text-slate-400 text-sm">
                    {" "}
                    / {league.totalEntries.toLocaleString()}
                  </span>
                </div>
                <span className="text-xs text-slate-400">
                  Top {league.percentile}%
                </span>
              </div>
              <div className={`mt-2 text-xs flex items-center gap-1 ${selectedLeague === league.id ? "text-emerald-400" : "text-slate-500"}`}>
                <span>{selectedLeague === league.id ? "\u25B2" : "\u25B6"}</span>
                <span>{selectedLeague === league.id ? "Strategy loaded" : "Tap for strategy"}</span>
              </div>
            </div>

            {/* Strategy panel */}
            {selectedLeague === league.id && (
              <div className="mt-2 rounded-xl bg-slate-800/80 border border-white/10 p-4">
                {loading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Analyzing rival squads...
                  </div>
                ) : strategy && (strategy as unknown as { error?: string }).error ? (
                  <p className="text-sm text-slate-400">
                    {(strategy as unknown as { error: string }).error}
                  </p>
                ) : strategy ? (
                  <div className="space-y-4">
                    {/* Attack */}
                    {strategy.attack.enabled && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-lg">&#9876;&#65039;</span>
                          <h3 className="text-sm font-semibold text-amber-400">
                            Attack
                          </h3>
                          <span className="text-xs text-slate-500">
                            — differentials vs managers above
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mb-2">
                          Targeting:{" "}
                          {strategy.attack.rivals
                            .map(
                              (r) =>
                                `${r.name} (${r.points}pts, #${r.rank})`
                            )
                            .join(", ")}
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {strategy.attack.suggestions.map((p) => (
                            <StrategyCard
                              key={p.name}
                              player={p}
                              type="attack"
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Defend */}
                    {strategy.defend.enabled && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-lg">&#128737;&#65039;</span>
                          <h3 className="text-sm font-semibold text-sky-400">
                            Defend
                          </h3>
                          <span className="text-xs text-slate-500">
                            — cover popular picks from managers below
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mb-2">
                          Watching:{" "}
                          {strategy.defend.rivals
                            .map(
                              (r) =>
                                `${r.name} (${r.points}pts, #${r.rank})`
                            )
                            .join(", ")}
                        </div>
                        {strategy.defend.suggestions.length > 0 && strategy.defend.suggestions.every((p) => p.userOwns) && (
                          <div className="text-xs text-emerald-400 mb-2">
                            &#10003; You already own all the key threats — well defended!
                          </div>
                        )}
                        <div className="grid gap-2 sm:grid-cols-2">
                          {strategy.defend.suggestions.map((p) => (
                            <StrategyCard
                              key={p.name}
                              player={p}
                              type="defend"
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {!strategy.attack.enabled &&
                      !strategy.defend.enabled && (
                        <p className="text-sm text-slate-400">
                          No specific strategy needed — you&apos;re comfortably
                          placed.
                        </p>
                      )}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">
                    Failed to load strategy.
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StrategyCard({
  player,
  type,
}: {
  player: StrategyPlayer;
  type: "attack" | "defend";
}) {
  const borderColor =
    type === "attack" ? "border-amber-500/30" : "border-sky-500/30";
  const accentColor =
    type === "attack" ? "text-amber-400" : "text-sky-400";

  return (
    <div
      className={`rounded-lg bg-white/5 border ${borderColor} p-3`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-white font-semibold text-sm">{player.name}</span>
        <span className={`text-xs ${accentColor}`}>
          {player.ownedByRivals}/{player.totalRivals} rivals
        </span>
      </div>
      <div className="text-xs text-slate-400">
        {player.position} &middot; {player.team} &middot; {"\u00A3"}
        {player.price.toFixed(1)}m &middot; Form {player.form.toFixed(1)}
      </div>
      <div className="text-xs text-slate-500 mt-1">
        {type === "attack"
          ? `${player.ownedByRivals === 0 ? "No rivals own this player" : `Only ${player.ownedByRivals} rival(s) own`} — ${player.selectedPct}% overall ownership`
          : player.userOwns
            ? `Owned by ${player.ownedByRivals}/${player.totalRivals} rival(s) — you have this covered`
            : `Owned by ${player.ownedByRivals}/${player.totalRivals} rival(s) — gap in your squad`}
      </div>
      {player.fixtures && player.fixtures.length > 0 && (
        <div className="flex gap-1 mt-2">
          {player.fixtures.map((f, i) => (
            <span
              key={i}
              className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${difficultyColor(f.difficulty)}`}
              title={f.isHome ? "Home" : "Away"}
            >
              {f.opponent}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function RankChart({ history }: { history: RankHistoryEntry[] }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; lines: string[]; containerW: number } | null>(null);
  const chartRef = useRef<SVGSVGElement>(null);

  const ranks = history.map((h) => h.overallRank);
  const pts = history.map((h) => h.points);
  const gwAverages = history.map((h) => h.gwAverage);
  const maxRank = Math.max(...ranks);
  const minRank = Math.min(...ranks);
  const rankRange = maxRank - minRank || 1;
  const allPtsValues = [...pts, ...gwAverages];
  const maxPts = Math.max(...allPtsValues);
  const minPts = Math.min(...allPtsValues);
  const ptsRange = maxPts - minPts || 1;

  // Check last 5 GWs for trend
  const last5 = history.slice(-5);
  let greenArrows = 0;
  for (let i = 1; i < last5.length; i++) {
    if (last5[i].overallRank < last5[i - 1].overallRank) greenArrows++;
  }
  const trendEmoji = greenArrows >= 4 ? "\uD83D\uDD25" : greenArrows <= 2 ? "\u2744\uFE0F" : "";
  const trendLabel =
    greenArrows >= 4
      ? "On fire!"
      : greenArrows <= 2
        ? "Cold streak"
        : "Steady";

  // SVG chart dimensions
  const width = 900;
  const height = 320;
  const padL = 55;
  const padR = 50;
  const padY = 25;
  const padB = 30;
  const chartW = width - padL - padR;
  const chartH = height - padY - padB;

  const rankPoints = history.map((h, i) => {
    const x = padL + (i / Math.max(history.length - 1, 1)) * chartW;
    const y = padY + ((h.overallRank - minRank) / rankRange) * chartH;
    return { x, y, ...h };
  });

  const ptsPoints = history.map((h, i) => {
    const x = padL + (i / Math.max(history.length - 1, 1)) * chartW;
    const y = padY + (1 - (h.points - minPts) / ptsRange) * chartH;
    return { x, y, ...h };
  });

  // GW average points mapped to chart coordinates
  const avgPoints = gwAverages.map((avg, i) => {
    const x = padL + (i / Math.max(history.length - 1, 1)) * chartW;
    const y = padY + (1 - (avg - minPts) / ptsRange) * chartH;
    return { x, y, avg, event: history[i].event };
  });

  const rankLine = rankPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const ptsLine = ptsPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  function handleHover(e: React.MouseEvent<SVGElement>, lines: string[]) {
    const svg = chartRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setTooltip({ x, y, lines, containerW: rect.width });
  }

  // Gradient fill under rank line
  const rankFill = `${rankLine} L ${rankPoints[rankPoints.length - 1].x} ${padY + chartH} L ${rankPoints[0].x} ${padY + chartH} Z`;

  const formatRank = (r: number) => {
    if (r >= 1_000_000) return `${(r / 1_000_000).toFixed(1)}M`;
    if (r >= 1_000) return `${(r / 1_000).toFixed(0)}k`;
    return r.toString();
  };

  return (
    <div className="rounded-2xl bg-gradient-to-br from-slate-800/80 to-slate-900/80 border border-white/10 p-6 backdrop-blur-sm shadow-xl">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-white">Rank History</h2>
          {trendEmoji && (
            <span className="text-2xl" title={trendLabel}>
              {trendEmoji}
            </span>
          )}
          <span className="text-sm text-slate-400">{trendLabel}</span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 bg-emerald-400 rounded"></span>
            <span className="text-slate-400">Overall Rank</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 bg-sky-400 rounded"></span>
            <span className="text-slate-400">GW Points</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-red-500"></span>
            <span className="text-slate-400">GW Average</span>
          </span>
        </div>
      </div>
      <div className="overflow-x-auto relative">
        <svg ref={chartRef} viewBox={`0 0 ${width} ${height}`} className="w-full h-72">
          <defs>
            <linearGradient id="rankGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
            </linearGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
            const y = padY + frac * chartH;
            const rankVal = minRank + frac * rankRange;
            const ptsVal = maxPts - frac * ptsRange;
            return (
              <g key={frac}>
                <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="rgba(255,255,255,0.06)" strokeDasharray="4,4" />
                {/* Left axis: Rank */}
                <text x={padL - 8} y={y + 4} textAnchor="end" fill="#10b981" fontSize="10" opacity="0.7">
                  {formatRank(Math.round(rankVal))}
                </text>
                {/* Right axis: Points */}
                <text x={width - padR + 8} y={y + 4} textAnchor="start" fill="#38bdf8" fontSize="10" opacity="0.7">
                  {Math.round(ptsVal)}
                </text>
              </g>
            );
          })}

          {/* GW labels */}
          {rankPoints.filter((_, i) => i % Math.max(1, Math.floor(rankPoints.length / 10)) === 0 || i === rankPoints.length - 1).map((p) => (
            <text key={p.event} x={p.x} y={height - 8} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="10">
              {p.event}
            </text>
          ))}
          <text x={width / 2} y={height} textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="9">
            Gameweek
          </text>

          {/* Rank gradient fill */}
          <path d={rankFill} fill="url(#rankGrad)" />

          {/* Points bars */}
          {ptsPoints.map((p) => {
            const barW = Math.max(4, chartW / history.length * 0.6);
            return (
              <rect
                key={`bar-${p.event}`}
                x={p.x - barW / 2}
                y={p.y}
                width={barW}
                height={padY + chartH - p.y}
                fill="#38bdf8"
                opacity="0.25"
                rx="2"
                className="cursor-pointer"
                onMouseEnter={(e) => handleHover(e, [`GW${p.event}`, `Points: ${p.points}`])}
                onMouseLeave={() => setTooltip(null)}
              />
            );
          })}

          {/* Running average dots */}
          {avgPoints.map((p) => (
            <circle
              key={`avg-${p.event}`}
              cx={p.x}
              cy={p.y}
              r="3.5"
              fill="#ef4444"
              stroke="#7f1d1d"
              strokeWidth="1"
              className="cursor-pointer"
              onMouseEnter={(e) => handleHover(e, [`GW${p.event}`, `GW Average: ${p.avg}pts`])}
              onMouseLeave={() => setTooltip(null)}
            />
          ))}

          {/* Rank line with glow */}
          <path d={rankLine} fill="none" stroke="#10b981" strokeWidth="2.5" filter="url(#glow)" />

          {/* Points bar tops */}
          {ptsPoints.map((p) => (
            <circle key={`pts-${p.event}`} cx={p.x} cy={p.y} r="2" fill="#38bdf8" opacity="0.8" />
          ))}

          {/* Rank dots */}
          {rankPoints.map((p) => (
            <circle
              key={`rank-${p.event}`}
              cx={p.x}
              cy={p.y}
              r="3.5"
              fill="#10b981"
              stroke="#064e3b"
              strokeWidth="1"
              className="cursor-pointer"
              onMouseEnter={(e) => handleHover(e, [`GW${p.event}`, `Rank: ${p.overallRank.toLocaleString()}`, `Points: ${p.points}`])}
              onMouseLeave={() => setTooltip(null)}
            />
          ))}

          {/* Current rank highlight */}
          {rankPoints.length > 0 && (
            <circle
              cx={rankPoints[rankPoints.length - 1].x}
              cy={rankPoints[rankPoints.length - 1].y}
              r="6"
              fill="#10b981"
              stroke="white"
              strokeWidth="2"
              filter="url(#glow)"
            />
          )}
        </svg>
        {tooltip && (
          <div
            className="absolute pointer-events-none z-10 bg-slate-800 border border-white/20 rounded-lg px-3 py-2 shadow-xl"
            style={{
              left: tooltip.x > tooltip.containerW * 0.7 ? undefined : tooltip.x + 12,
              right: tooltip.x > tooltip.containerW * 0.7 ? tooltip.containerW - tooltip.x + 12 : undefined,
              top: tooltip.y - 10,
              transform: "translateY(-100%)",
            }}
          >
            {tooltip.lines.map((line, i) => (
              <div
                key={i}
                className={`text-xs whitespace-nowrap ${i === 0 ? "text-white font-semibold" : "text-slate-300"}`}
              >
                {line}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PlayerCard({
  label,
  labelColor,
  player,
}: {
  label: string;
  labelColor: string;
  player: import("@/lib/types").PlayerAnalysis;
}) {
  return (
    <div className="flex-1 text-center">
      <div className={`${labelColor} text-xs mb-1`}>{label}</div>
      <div className="text-white font-semibold">
        {player.player.web_name}
        {player.isPenaltyTaker && (
          <span className="ml-1 text-xs text-yellow-400" title="Penalty taker">
            PK
          </span>
        )}
      </div>
      <div className="text-slate-400 text-xs">
        {player.teamName} &middot; {"\u00A3"}
        {(player.player.now_cost / 10).toFixed(1)}m &middot; Form{" "}
        {parseFloat(player.player.form).toFixed(1)}
      </div>
      <div className="text-slate-500 text-xs mt-1">
        npxG {player.rollingStats.npxGPer90.toFixed(2)} &middot; xA{" "}
        {player.rollingStats.xAPer90.toFixed(2)}
      </div>
    </div>
  );
}

function FixtureRow({
  label,
  fixtures,
}: {
  label: string;
  fixtures: import("@/lib/types").FixtureAnalysis[];
}) {
  return (
    <div>
      <div className="text-xs text-slate-500 mb-1">
        {label}&apos;s fixtures
      </div>
      <div className="flex gap-1">
        {fixtures.slice(0, 5).map((f, k) => (
          <span
            key={k}
            className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${difficultyColor(f.difficulty)}`}
          >
            {f.opponent}
          </span>
        ))}
      </div>
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
