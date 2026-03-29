import { NextRequest, NextResponse } from "next/server";
import {
  getLeagueStandings,
  getBootstrapData,
  getTeamPicks,
  getFixtures,
  getCurrentGameweek,
  getPositionName,
} from "@/lib/fpl-api";

export const maxDuration = 30;

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

export async function POST(request: NextRequest) {
  try {
    const { leagueId, teamId } = await request.json();

    if (!leagueId || !teamId) {
      return NextResponse.json(
        { error: "leagueId and teamId required" },
        { status: 400 }
      );
    }

    const [standings, bootstrap, allFixtures] = await Promise.all([
      getLeagueStandings(Number(leagueId)),
      getBootstrapData(),
      getFixtures(),
    ]);

    const currentGW = getCurrentGameweek(bootstrap);
    let results = standings.standings.results;
    let userEntry = results.find((r) => r.entry === Number(teamId));

    // If user not on page 1, try fetching more pages (up to 3)
    if (!userEntry && standings.standings.has_next) {
      for (let page = 2; page <= 3 && !userEntry; page++) {
        try {
          const next = await getLeagueStandings(Number(leagueId), page);
          results = [...results, ...next.standings.results];
          userEntry = next.standings.results.find((r) => r.entry === Number(teamId));
        } catch { break; }
      }
    }

    if (!userEntry) {
      return NextResponse.json(
        { error: "League too large for strategy analysis (50+ page standings)" },
        { status: 404 }
      );
    }

    const POINTS_THRESHOLD = 50;

    // Attack: managers above user within 50 pts (or just the next one if gap > 50)
    const managersAbove = results.filter(
      (r) => r.total > userEntry.total && r.entry !== userEntry.entry
    );
    let attackRivals: typeof results = [];
    const closeAbove = managersAbove.filter(
      (r) => r.total - userEntry.total <= POINTS_THRESHOLD
    );
    if (closeAbove.length > 0) {
      attackRivals = closeAbove;
    } else if (managersAbove.length > 0) {
      // Just target the next manager above
      attackRivals = [
        managersAbove.sort((a, b) => a.total - b.total)[0], // closest above
      ];
    }

    // Defend: managers below user within 50 pts
    const defendRivals = results.filter(
      (r) =>
        r.total < userEntry.total &&
        userEntry.total - r.total <= POINTS_THRESHOLD &&
        r.entry !== userEntry.entry
    );
    // Also defend if user is 1st
    const isFirst = userEntry.rank === 1;
    const shouldDefend = isFirst || defendRivals.length > 0;
    const shouldAttack = attackRivals.length > 0;

    // Get user's picks
    const userPicks = await getTeamPicks(Number(teamId), currentGW);
    const userPlayerIds = new Set(userPicks.picks.map((p) => p.element));

    // Get rival picks in parallel
    const allRivalEntries = [
      ...new Set([
        ...attackRivals.map((r) => r.entry),
        ...(shouldDefend ? defendRivals.map((r) => r.entry) : []),
      ]),
    ];

    const rivalPicksMap = new Map<number, Set<number>>();
    const batchSize = 5;
    for (let i = 0; i < allRivalEntries.length; i += batchSize) {
      const batch = allRivalEntries.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (entry) => {
          try {
            const picks = await getTeamPicks(entry, currentGW);
            return {
              entry,
              playerIds: new Set(picks.picks.map((p) => p.element)),
            };
          } catch {
            return { entry, playerIds: new Set<number>() };
          }
        })
      );
      for (const r of batchResults) {
        rivalPicksMap.set(r.entry, r.playerIds);
      }
    }

    const playerMap = new Map(bootstrap.elements.map((p) => [p.id, p]));
    const teamMap = new Map(bootstrap.teams.map((t) => [t.id, t]));

    function getUpcoming3(teamIdNum: number): StrategyFixture[] {
      return allFixtures
        .filter(
          (f) =>
            !f.finished &&
            f.event !== null &&
            (f.team_h === teamIdNum || f.team_a === teamIdNum)
        )
        .sort((a, b) => (a.event ?? 99) - (b.event ?? 99))
        .slice(0, 3)
        .map((f) => {
          const isHome = f.team_h === teamIdNum;
          const oppId = isHome ? f.team_a : f.team_h;
          const opp = teamMap.get(oppId);
          return {
            opponent: opp?.short_name || "???",
            difficulty: isHome ? f.team_h_difficulty : f.team_a_difficulty,
            isHome,
          };
        });
    }

    function buildPlayerInfo(playerId: number): StrategyPlayer | null {
      const player = playerMap.get(playerId);
      if (!player) return null;
      const team = teamMap.get(player.team);
      return {
        name: player.web_name,
        team: team?.short_name || "???",
        position: getPositionName(player.element_type),
        form: parseFloat(player.form),
        price: player.now_cost / 10,
        ownedByRivals: 0,
        totalRivals: 0,
        selectedPct: player.selected_by_percent,
        fixtures: getUpcoming3(player.team),
      };
    }

    // ATTACK: find players user doesn't own that attack rivals also don't own
    // From all available players with good form, pick ones rivals lack
    let attackSuggestions: StrategyPlayer[] = [];
    if (shouldAttack) {
      const attackRivalIds = attackRivals.map((r) => r.entry);
      // Get all good players (high form, available)
      const candidates = bootstrap.elements
        .filter(
          (p) =>
            p.status === "a" &&
            !userPlayerIds.has(p.id) &&
            parseFloat(p.form) >= 4 &&
            p.minutes > 200
        )
        .sort((a, b) => parseFloat(b.form) - parseFloat(a.form))
        .slice(0, 50); // top 50 by form

      attackSuggestions = candidates
        .map((p) => {
          const info = buildPlayerInfo(p.id)!;
          const rivalsOwning = attackRivalIds.filter((entry) =>
            rivalPicksMap.get(entry)?.has(p.id)
          ).length;
          info.ownedByRivals = rivalsOwning;
          info.totalRivals = attackRivalIds.length;
          return info;
        })
        // Prefer players NOT owned by rivals, tiebreak by lowest overall ownership
        .sort((a, b) => {
          if (a.ownedByRivals !== b.ownedByRivals)
            return a.ownedByRivals - b.ownedByRivals;
          return parseFloat(a.selectedPct) - parseFloat(b.selectedPct);
        })
        .slice(0, 2);
    }

    // DEFEND: find players rivals own that user doesn't
    let defendSuggestions: StrategyPlayer[] = [];
    if (shouldDefend) {
      const defendRivalIds = (isFirst && defendRivals.length === 0)
        ? results
            .filter((r) => r.entry !== userEntry.entry)
            .slice(0, 3)
            .map((r) => r.entry)
        : defendRivals.map((r) => r.entry);

      // Count how many defend rivals own each player the user doesn't have
      const playerOwnership = new Map<number, number>();
      for (const rivalId of defendRivalIds) {
        const rivalPlayers = rivalPicksMap.get(rivalId);
        if (!rivalPlayers) continue;
        for (const pid of rivalPlayers) {
          if (!userPlayerIds.has(pid)) {
            playerOwnership.set(pid, (playerOwnership.get(pid) || 0) + 1);
          }
        }
      }

      defendSuggestions = [...playerOwnership.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([pid, count]) => {
          const info = buildPlayerInfo(pid);
          if (!info) return null;
          info.ownedByRivals = count;
          info.totalRivals = defendRivalIds.length;
          return info;
        })
        .filter((p): p is StrategyPlayer => p !== null)
        .filter((p) => p.form >= 2) // filter out truly awful players
        .slice(0, 2);
    }

    const result: StrategyResult = {
      leagueName: standings.league.name,
      userRank: userEntry.rank,
      userPoints: userEntry.total,
      attack: {
        enabled: shouldAttack,
        rivals: attackRivals.map((r) => ({
          name: r.player_name,
          points: r.total,
          rank: r.rank,
        })),
        suggestions: attackSuggestions,
      },
      defend: {
        enabled: shouldDefend,
        rivals: (isFirst && defendRivals.length === 0
          ? results.filter((r) => r.entry !== userEntry.entry).slice(0, 3)
          : defendRivals
        ).map((r) => ({
          name: r.player_name,
          points: r.total,
          rank: r.rank,
        })),
        suggestions: defendSuggestions,
      },
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("League strategy error:", error);
    const message =
      error instanceof Error ? error.message : "Strategy analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
