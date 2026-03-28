import { NextRequest, NextResponse } from "next/server";
import { analyzeTeam } from "@/lib/analyzer";
import { crossReferenceExperts } from "@/lib/scraper";

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

    // Trim to top 3
    result.recommendations = result.recommendations.slice(0, 3);

    return NextResponse.json(result);
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
