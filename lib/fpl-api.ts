import {
  FPLBootstrap,
  FPLFixture,
  FPLTeamPicks,
  FPLTeamInfo,
  FPLPlayerSummary,
} from "./types";

const BASE_URL = "https://fantasy.premierleague.com/api";

async function fplFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "User-Agent": "FPL-Recommender/1.0",
    },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    throw new Error(
      `FPL API error: ${res.status} ${res.statusText} for ${path}`
    );
  }

  return res.json();
}

export async function getBootstrapData(): Promise<FPLBootstrap> {
  return fplFetch<FPLBootstrap>("/bootstrap-static/");
}

export async function getTeamInfo(teamId: number): Promise<FPLTeamInfo> {
  return fplFetch<FPLTeamInfo>(`/entry/${teamId}/`);
}

export async function getTeamPicks(
  teamId: number,
  gameweek: number
): Promise<FPLTeamPicks> {
  return fplFetch<FPLTeamPicks>(`/entry/${teamId}/event/${gameweek}/picks/`);
}

export interface FPLTeamHistory {
  current: {
    event: number;
    points: number;
    total_points: number;
    rank: number;
    overall_rank: number;
    event_transfers: number;
    event_transfers_cost: number;
    value: number;
    points_on_bench: number;
  }[];
}

export async function getTeamHistory(teamId: number): Promise<FPLTeamHistory> {
  return fplFetch<FPLTeamHistory>(`/entry/${teamId}/history/`);
}

export interface FPLLeagueStandings {
  league: { id: number; name: string };
  standings: {
    results: {
      id: number; // standing ID
      entry: number; // team ID
      entry_name: string;
      player_name: string;
      rank: number;
      last_rank: number;
      total: number; // total points
      event_total: number; // latest GW points
    }[];
    has_next: boolean;
    page: number;
  };
}

export async function getLeagueStandings(
  leagueId: number,
  page: number = 1
): Promise<FPLLeagueStandings> {
  return fplFetch<FPLLeagueStandings>(
    `/leagues-classic/${leagueId}/standings/?page_standings=${page}`
  );
}

export async function getFixtures(): Promise<FPLFixture[]> {
  return fplFetch<FPLFixture[]>("/fixtures/");
}

export async function getPlayerSummary(
  playerId: number
): Promise<FPLPlayerSummary> {
  return fplFetch<FPLPlayerSummary>(`/element-summary/${playerId}/`);
}

// Batch fetch player summaries with concurrency limit to avoid rate limiting
export async function batchGetPlayerSummaries(
  playerIds: number[],
  concurrency: number = 10
): Promise<Map<number, FPLPlayerSummary>> {
  const results = new Map<number, FPLPlayerSummary>();
  const queue = [...playerIds];

  async function worker() {
    while (queue.length > 0) {
      const id = queue.shift()!;
      try {
        const summary = await getPlayerSummary(id);
        results.set(id, summary);
      } catch {
        // Skip players whose data can't be fetched
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return results;
}

export function getCurrentGameweek(bootstrap: FPLBootstrap): number {
  const current = bootstrap.events.find((e) => e.is_current);
  if (current) return current.id;

  const next = bootstrap.events.find((e) => e.is_next);
  if (next) return next.id;

  const finished = bootstrap.events.filter((e) => e.finished);
  return finished.length > 0 ? finished[finished.length - 1].id : 1;
}

export function getPositionName(elementType: number): string {
  const positions: Record<number, string> = {
    1: "GK",
    2: "DEF",
    3: "MID",
    4: "FWD",
  };
  return positions[elementType] || "Unknown";
}
