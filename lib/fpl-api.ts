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
    next: { revalidate: 300 }, // cache for 5 minutes
  });

  if (!res.ok) {
    throw new Error(`FPL API error: ${res.status} ${res.statusText} for ${path}`);
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

export async function getFixtures(): Promise<FPLFixture[]> {
  return fplFetch<FPLFixture[]>("/fixtures/");
}

export async function getPlayerSummary(
  playerId: number
): Promise<FPLPlayerSummary> {
  return fplFetch<FPLPlayerSummary>(`/element-summary/${playerId}/`);
}

export function getCurrentGameweek(bootstrap: FPLBootstrap): number {
  const current = bootstrap.events.find((e) => e.is_current);
  if (current) return current.id;

  const next = bootstrap.events.find((e) => e.is_next);
  if (next) return next.id;

  // fallback: latest finished gameweek
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
