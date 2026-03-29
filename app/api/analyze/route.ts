import { NextRequest, NextResponse } from "next/server";
import { analyzeTeam } from "@/lib/analyzer";
import { crossReferenceExperts, fetchScoutPicks } from "@/lib/scraper";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { teamId } = await request.json();

    if (!teamId || isNaN(Number(teamId))) {
      return NextResponse.json(
        { error: "Please provide a valid FPL team ID" },
        { status: 400 }
      );
    }

    const result = await analyzeTeam(Number(teamId));

    // Cross-reference with expert picks
    result.recommendations = await crossReferenceExperts(
      result.recommendations
    );

    // Re-sort after expert boost
    result.recommendations.sort((a, b) => b.priority - a.priority);

    // Trim to top 5
    result.recommendations = result.recommendations.slice(0, 5);

    // Build "Other Targets" — top 10 players not in squad or recommendations
    const squadIds = new Set(result.squad.map((p) => p.player.id));
    const recInIds = new Set(
      result.recommendations.map((r) => r.playerIn.player.id)
    );

    // allAnalyzedCandidates is not directly available, so we use the full
    // candidate pool from the result. We'll sort all available players by score
    // and exclude squad + rec players.
    // The candidates are already analyzed in analyzeTeam — we need to expose them.
    // For now, use the recommendations' analyzed candidates approach.

    // Fetch scout picks for cross-referencing
    const nextGW = result.currentGameweek + 1;
    const [scoutNames] = await Promise.all([
      fetchScoutPicks(nextGW),
    ]);

    // Build top targets from allCandidates (exposed from analyzeTeam)
    const topTargets = result.allCandidates;

    let otherTargets: {
      name: string;
      team: string;
      position: string;
      form: number;
      price: number;
      score: number;
      isScoutPick: boolean;
      fixtures: { opponent: string; difficulty: number; isHome: boolean }[];
    }[] = [];

    if (topTargets) {
      const normalizeForMatch = (s: string) =>
        s
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .trim();

      const scoutNorm = scoutNames.map(normalizeForMatch);
      const filtered = topTargets
        .filter((p) => !squadIds.has(p.id) && !recInIds.has(p.id))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

      otherTargets = filtered.map((p) => ({
        name: p.web_name,
        team: p.team,
        position: p.position,
        form: p.form,
        price: p.price,
        score: p.score,
        isScoutPick: scoutNorm.some(
          (s) =>
            normalizeForMatch(p.web_name).includes(s) ||
            s.includes(normalizeForMatch(p.web_name))
        ),
        fixtures: p.fixtures,
      }));

      // Sort: scout picks first, then by score
      otherTargets.sort((a, b) => {
        if (a.isScoutPick !== b.isScoutPick)
          return a.isScoutPick ? -1 : 1;
        return b.score - a.score;
      });

      // Trim to 5
      otherTargets = otherTargets.slice(0, 5);
    }

    return NextResponse.json({
      ...result,
      otherTargets,
      scoutGW: scoutNames.length > 0 ? nextGW : null,
    });
  } catch (error) {
    console.error("Analysis error:", error);
    const message =
      error instanceof Error ? error.message : "Analysis failed";

    if (message.includes("404")) {
      return NextResponse.json(
        { error: "Team not found. Please check your FPL team ID." },
        { status: 404 }
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
