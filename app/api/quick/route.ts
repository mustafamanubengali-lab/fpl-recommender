import { NextRequest, NextResponse } from "next/server";
import { quickTeamOverview } from "@/lib/analyzer";
import { getTeamHistory, getBootstrapData } from "@/lib/fpl-api";

export async function POST(request: NextRequest) {
  try {
    const { teamId } = await request.json();

    if (!teamId || isNaN(Number(teamId))) {
      return NextResponse.json(
        { error: "Please provide a valid FPL team ID" },
        { status: 400 }
      );
    }

    const [result, history, bootstrap] = await Promise.all([
      quickTeamOverview(Number(teamId)),
      getTeamHistory(Number(teamId)),
      getBootstrapData(),
    ]);

    const gwAvgMap = new Map(
      bootstrap.events.map((e) => [e.id, e.average_entry_score])
    );

    const rankHistory = history.current.map((gw) => ({
      event: gw.event,
      overallRank: gw.overall_rank,
      points: gw.points,
      totalPoints: gw.total_points,
      gwAverage: gwAvgMap.get(gw.event) ?? 0,
    }));

    return NextResponse.json({ ...result, rankHistory });
  } catch (error) {
    console.error("Quick overview error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to load team";

    if (message.includes("404")) {
      return NextResponse.json(
        { error: "Team not found. Please check your FPL team ID." },
        { status: 404 }
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
