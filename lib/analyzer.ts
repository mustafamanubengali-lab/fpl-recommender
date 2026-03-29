import {
  FPLBootstrap,
  FPLFixture,
  FPLTeamPicks,
  FPLPlayer,
  FPLPlayerHistory,
  FPLPlayerSummary,
  PlayerAnalysis,
  FixtureAnalysis,
  RollingStats,
  TransferRecommendation,
  AnalysisResult,
  QuickTeamResult,
} from "./types";
import { predictExpectedPoints } from "./model";
import {
  getBootstrapData,
  getTeamInfo,
  getTeamPicks,
  getFixtures,
  getCurrentGameweek,
  getPositionName,
  batchGetPlayerSummaries,
} from "./fpl-api";

const FIXTURE_LOOKAHEAD = 5;
const ROLLING_GAMES = 5;
const PENALTY_XG = 0.76; // xG value of a penalty

// ─── Fixture helpers ───────────────────────────────────────────────

function getUpcomingFixtures(
  teamId: number,
  currentGW: number,
  fixtures: FPLFixture[],
  teams: FPLBootstrap["teams"]
): FixtureAnalysis[] {
  return fixtures
    .filter(
      (f) =>
        f.event !== null &&
        f.event > currentGW &&
        f.event <= currentGW + FIXTURE_LOOKAHEAD &&
        (f.team_h === teamId || f.team_a === teamId)
    )
    .sort((a, b) => (a.event ?? 0) - (b.event ?? 0))
    .map((f) => {
      const isHome = f.team_h === teamId;
      const opponentId = isHome ? f.team_a : f.team_h;
      const opponent = teams.find((t) => t.id === opponentId);
      return {
        gameweek: f.event!,
        opponent: opponent?.short_name || "???",
        difficulty: isHome ? f.team_h_difficulty : f.team_a_difficulty,
        isHome,
      };
    });
}

// ─── Penalty taker detection ───────────────────────────────────────

function buildPenaltyTakerMap(allPlayers: FPLPlayer[]): Map<number, number> {
  // Map: teamId -> playerId of designated penalty taker
  const teamMap = new Map<number, number>();
  const teamPlayers = new Map<number, FPLPlayer[]>();

  for (const p of allPlayers) {
    if (!teamPlayers.has(p.team)) teamPlayers.set(p.team, []);
    teamPlayers.get(p.team)!.push(p);
  }

  for (const [teamId, players] of teamPlayers) {
    // Sort by penalties_order first (1 = designated taker), then by penalties taken
    const candidates = players
      .filter(
        (p) =>
          p.status === "a" ||
          p.status === "d" // include doubtful, we'll check injury below
      )
      .sort((a, b) => {
        // Players with penalties_order set come first
        const aOrder = a.penalties_order ?? 999;
        const bOrder = b.penalties_order ?? 999;
        if (aOrder !== bOrder) return aOrder - bOrder;
        // Fallback: most penalties taken (missed is our proxy + goals above npxG)
        const aPens = a.penalties_missed + Math.max(0, a.goals_scored - parseFloat(a.expected_goals || "0"));
        const bPens = b.penalties_missed + Math.max(0, b.goals_scored - parseFloat(b.expected_goals || "0"));
        return bPens - aPens;
      });

    // Find first available (not injured/suspended) player
    for (const c of candidates) {
      if (c.status === "a" || (c.status === "d" && (c.chance_of_playing_next_round ?? 0) >= 50)) {
        teamMap.set(teamId, c.id);
        break;
      }
    }
  }

  return teamMap;
}

// ─── Rolling per-90 stats (last 5 games, fixture-normalized) ──────

function computeRollingStats(
  history: FPLPlayerHistory[],
  fixtures: FPLFixture[],
  elementType: number
): RollingStats {
  // Get last N games where the player actually played
  const played = history
    .filter((h) => h.minutes > 0)
    .slice(-ROLLING_GAMES);

  if (played.length === 0) {
    return {
      npxGPer90: 0,
      xAPer90: 0,
      savesPer90: 0,
      xGCPer90: 0,
      defensiveContribPer90: 0,
      ictPer90: 0,
      minutesPer90: 0,
      gamesPlayed: 0,
      goalsPer90: 0,
      assistsPer90: 0,
      cleanSheetsPer90: 0,
      bonusPer90: 0,
      bpsPer90: 0,
    };
  }

  let totalNpxG = 0;
  let totalXA = 0;
  let totalSaves = 0;
  let totalXGC = 0;
  let totalDefContrib = 0;
  let totalICT = 0;
  let totalMinutes = 0;
  let totalGoals = 0;
  let totalAssists = 0;
  let totalCleanSheets = 0;
  let totalBonus = 0;
  let totalBPS = 0;

  for (const game of played) {
    const mins = game.minutes;
    if (mins === 0) continue;

    // Find the fixture difficulty for this game
    const fixtureDifficulty = getGameDifficulty(game, fixtures) || 3;
    // Normalize: stats against harder teams are worth more
    // difficulty/3 means avg difficulty (3) = 1x multiplier
    const diffMultiplier = fixtureDifficulty / 3;

    const per90 = 90 / mins;

    // npxG: subtract penalty xG from total xG
    const rawXG = parseFloat(game.expected_goals || "0");
    const pensThisGame = game.penalties_missed + estimatePenScored(game);
    const npxG = Math.max(0, rawXG - pensThisGame * PENALTY_XG);

    totalNpxG += npxG * per90 * diffMultiplier;
    totalXA += parseFloat(game.expected_assists || "0") * per90 * diffMultiplier;
    totalSaves += game.saves * per90 * diffMultiplier;
    totalXGC += parseFloat(game.expected_goals_conceded || "0") * per90; // don't normalize xGC by difficulty (already reflects opponent)
    totalDefContrib += game.defensive_contribution * per90 * diffMultiplier;
    totalICT += parseFloat(game.ict_index || "0") * per90 * diffMultiplier;
    totalMinutes += mins;
    totalGoals += game.goals_scored * per90 * diffMultiplier;
    totalAssists += game.assists * per90 * diffMultiplier;
    totalCleanSheets += game.clean_sheets * per90 * diffMultiplier;
    totalBonus += game.bonus * per90 * diffMultiplier;
    totalBPS += game.bps * per90 * diffMultiplier;
  }

  const n = played.length;
  return {
    npxGPer90: totalNpxG / n,
    xAPer90: totalXA / n,
    savesPer90: totalSaves / n,
    xGCPer90: totalXGC / n,
    defensiveContribPer90: totalDefContrib / n,
    ictPer90: totalICT / n,
    minutesPer90: totalMinutes / n,
    gamesPlayed: n,
    goalsPer90: totalGoals / n,
    assistsPer90: totalAssists / n,
    cleanSheetsPer90: totalCleanSheets / n,
    bonusPer90: totalBonus / n,
    bpsPer90: totalBPS / n,
  };
}

function getGameDifficulty(
  game: FPLPlayerHistory,
  fixtures: FPLFixture[]
): number {
  const fixture = fixtures.find((f) => f.id === game.fixture);
  if (!fixture) return 3; // default average
  return game.was_home
    ? fixture.team_h_difficulty
    : fixture.team_a_difficulty;
}

function estimatePenScored(game: FPLPlayerHistory): number {
  // Rough estimate: if goals > npxG by a decent margin, likely a penalty
  const goals = game.goals_scored;
  const xg = parseFloat(game.expected_goals || "0");
  if (goals > 0 && goals > xg + 0.5) {
    return Math.round(goals - xg);
  }
  return 0;
}

// ─── Fallback rolling stats from bootstrap (season-level per-90) ──

function fallbackRollingStats(player: FPLPlayer): RollingStats {
  const totalMins = player.minutes;
  if (totalMins < 90) {
    return {
      npxGPer90: 0,
      xAPer90: 0,
      savesPer90: 0,
      xGCPer90: 0,
      defensiveContribPer90: 0,
      ictPer90: 0,
      minutesPer90: 0,
      gamesPlayed: 0,
      goalsPer90: 0,
      assistsPer90: 0,
      cleanSheetsPer90: 0,
      bonusPer90: 0,
      bpsPer90: 0,
    };
  }

  const per90 = 90 / totalMins;
  const totalXG = parseFloat(player.expected_goals || "0");
  const totalPens = player.penalties_missed + Math.max(0, player.goals_scored - totalXG);
  const npxG = Math.max(0, totalXG - totalPens * PENALTY_XG);

  return {
    npxGPer90: npxG * per90,
    xAPer90: parseFloat(player.expected_assists || "0") * per90,
    savesPer90: player.saves * per90,
    xGCPer90: parseFloat(player.expected_goals_conceded || "0") * per90,
    defensiveContribPer90: player.defensive_contribution * per90,
    ictPer90: parseFloat(player.ict_index || "0") * per90,
    minutesPer90: totalMins / Math.max(1, player.starts),
    gamesPlayed: player.starts,
    goalsPer90: player.goals_scored * per90,
    assistsPer90: player.assists * per90,
    cleanSheetsPer90: player.clean_sheets * per90,
    bonusPer90: 0, // bonus not available on bootstrap player object
    bpsPer90: 0, // bps not available on bootstrap player object
  };
}

// ─── Position-specific scoring ─────────────────────────────────────

interface PositionWeights {
  form: number;
  npxG: number;
  xA: number;
  defensiveContrib: number;
  saves: number;
  xGC: number; // penalty: lower is better, so this is subtracted
  fixtures: number;
  injury: number;
  minutes: number;
  penaltyTaker: number;
  ict: number;
}

const WEIGHTS: Record<string, PositionWeights> = {
  GK: {
    form: 3,
    npxG: 0,
    xA: 0,
    defensiveContrib: 0,
    saves: 3,
    xGC: 2,
    fixtures: 2,
    injury: -2,
    minutes: 2,
    penaltyTaker: 0,
    ict: 1,
  },
  DEF: {
    form: 3,
    npxG: 1,
    xA: 1,
    defensiveContrib: 3,
    saves: 0,
    xGC: 2,
    fixtures: 2,
    injury: -2,
    minutes: 2,
    penaltyTaker: 1,
    ict: 1,
  },
  MID: {
    form: 3,
    npxG: 3,
    xA: 3,
    defensiveContrib: 2,
    saves: 0,
    xGC: 0,
    fixtures: 2,
    injury: -2,
    minutes: 2,
    penaltyTaker: 1,
    ict: 1,
  },
  FWD: {
    form: 3,
    npxG: 3,
    xA: 3,
    defensiveContrib: 1,
    saves: 0,
    xGC: 0,
    fixtures: 2,
    injury: -2,
    minutes: 2,
    penaltyTaker: 1,
    ict: 1,
  },
};

function scorePlayer(
  player: FPLPlayer,
  position: string,
  upcomingFixtures: FixtureAnalysis[],
  rolling: RollingStats,
  isPenaltyTaker: boolean
): {
  score: number;
  formScore: number;
  minutesScore: number;
  injuryRisk: number;
  avgFixtureDifficulty: number;
  weaknesses: string[];
} {
  const w = WEIGHTS[position] || WEIGHTS.MID;
  const weaknesses: string[] = [];

  // Form (0-10)
  const form = parseFloat(player.form) || 0;
  const formScore = Math.min(form, 10);
  if (form < 3) weaknesses.push(`Low form (${form})`);

  // Minutes (0-10)
  const minutesScore = Math.min(rolling.minutesPer90 / 9, 10); // 90 mins = 10
  if (rolling.gamesPlayed < 3) weaknesses.push("Limited recent games");
  else if (rolling.minutesPer90 < 60) weaknesses.push("Limited minutes per game");

  // Fixture difficulty
  const avgFixtureDifficulty =
    upcomingFixtures.length > 0
      ? upcomingFixtures.reduce((sum, f) => sum + f.difficulty, 0) /
        upcomingFixtures.length
      : 3;
  const fixtureScore = (5 - avgFixtureDifficulty) * 2; // 0-8
  if (avgFixtureDifficulty >= 4)
    weaknesses.push(
      `Tough upcoming fixtures (avg ${avgFixtureDifficulty.toFixed(1)})`
    );

  // Injury risk (0-10)
  let injuryRisk = 0;
  if (player.status === "i" || player.status === "s") {
    injuryRisk = 10;
    weaknesses.push(player.news || "Injured/Suspended");
  } else if (player.status === "d") {
    injuryRisk = 5;
    weaknesses.push(player.news || "Doubtful");
  } else if (
    player.chance_of_playing_next_round !== null &&
    player.chance_of_playing_next_round < 75
  ) {
    injuryRisk = (100 - player.chance_of_playing_next_round) / 10;
    weaknesses.push(
      `${player.chance_of_playing_next_round}% chance of playing`
    );
  }

  // Normalize rolling stats to ~0-10 scale for scoring
  const npxGScore = Math.min(rolling.npxGPer90 * 20, 10); // 0.5 npxG/90 = 10
  const xAScore = Math.min(rolling.xAPer90 * 20, 10); // 0.5 xA/90 = 10
  const savesScore = Math.min(rolling.savesPer90 / 0.5, 10); // 5 saves/90 = 10
  const xGCScore = Math.min(rolling.xGCPer90 * 5, 10); // 2.0 xGC/90 = 10 (penalty)
  const defContribScore = Math.min(rolling.defensiveContribPer90 / 2, 10); // 20 dc/90 = 10
  const ictScore = Math.min(rolling.ictPer90 / 1.5, 10); // 15 ict/90 = 10
  const penScore = isPenaltyTaker ? 10 : 0;

  // Low rolling stats = weaknesses
  if (position !== "GK" && rolling.npxGPer90 < 0.05 && (position === "FWD" || position === "MID"))
    weaknesses.push(`Low npxG/90 (${rolling.npxGPer90.toFixed(2)})`);
  if (position !== "GK" && rolling.xAPer90 < 0.05 && (position === "FWD" || position === "MID"))
    weaknesses.push(`Low xA/90 (${rolling.xAPer90.toFixed(2)})`);

  // Composite score
  const score =
    w.form * formScore +
    w.npxG * npxGScore +
    w.xA * xAScore +
    w.defensiveContrib * defContribScore +
    w.saves * savesScore -
    w.xGC * xGCScore + // subtract: more xGC = worse
    w.fixtures * fixtureScore +
    w.injury * injuryRisk + // injury weight is negative, so this subtracts
    w.minutes * minutesScore +
    w.penaltyTaker * penScore +
    w.ict * ictScore;

  return {
    score,
    formScore,
    minutesScore,
    injuryRisk,
    avgFixtureDifficulty,
    weaknesses,
  };
}

// ─── Quick team overview (fast, no player summaries needed) ────────

export async function quickTeamOverview(
  teamId: number
): Promise<QuickTeamResult> {
  const [bootstrap, teamInfo] = await Promise.all([
    getBootstrapData(),
    getTeamInfo(teamId),
  ]);

  const currentGW = getCurrentGameweek(bootstrap);
  const teamPicks = await getTeamPicks(teamId, currentGW);

  // Build league summary — filter to interesting leagues (private + notable system ones)
  const leagues = teamInfo.leagues.classic
    .filter((l) => l.league_type === "x" || l.rank_count < 100000) // private leagues or small system ones
    .map((l) => ({
      id: l.id,
      name: l.name,
      rank: l.entry_rank,
      totalEntries: l.rank_count,
      rankChange: l.entry_last_rank - l.entry_rank, // positive = improved
      percentile: l.entry_percentile_rank,
    }))
    .sort((a, b) => a.totalEntries - b.totalEntries); // smallest leagues first (most personal)

  // Also include notable system leagues (country, overall)
  const systemLeagues = teamInfo.leagues.classic
    .filter(
      (l) =>
        l.league_type === "s" &&
        l.rank_count >= 100000 &&
        !l.short_name.startsWith("event-") // skip gameweek leagues
    )
    .map((l) => ({
      id: l.id,
      name: l.name,
      rank: l.entry_rank,
      totalEntries: l.rank_count,
      rankChange: l.entry_last_rank - l.entry_rank,
      percentile: l.entry_percentile_rank,
    }));

  // Squad summary
  const squadSummary = teamPicks.picks.map((pick) => {
    const player = bootstrap.elements.find((p) => p.id === pick.element)!;
    const team = bootstrap.teams.find((t) => t.id === player.team);
    return {
      playerName: player.web_name,
      position: getPositionName(player.element_type),
      teamName: team?.short_name || "???",
      form: parseFloat(player.form),
      price: player.now_cost / 10,
      status: player.status,
    };
  });

  return {
    teamInfo: {
      name: teamInfo.name,
      managerName: `${teamInfo.player_first_name} ${teamInfo.player_last_name}`,
      overallPoints: teamInfo.summary_overall_points,
      overallRank: teamInfo.summary_overall_rank,
      bank: teamPicks.entry_history.bank / 10,
      teamValue: teamPicks.entry_history.value / 10,
    },
    currentGameweek: currentGW,
    leagues: [...leagues, ...systemLeagues],
    squadSummary,
  };
}

// ─── Full analysis (slow, fetches player histories) ────────────────

export async function analyzeTeam(teamId: number): Promise<AnalysisResult> {
  const [bootstrap, teamInfo, fixtures] = await Promise.all([
    getBootstrapData(),
    getTeamInfo(teamId),
    getFixtures(),
  ]);

  const currentGW = getCurrentGameweek(bootstrap);
  const { teams, elements: allPlayers } = bootstrap;

  const teamPicks = await getTeamPicks(teamId, currentGW);
  const bank = teamPicks.entry_history.bank;

  // Build penalty taker map
  const penaltyTakers = buildPenaltyTakerMap(allPlayers);

  // Identify squad player IDs
  const currentSquadIds = new Set(teamPicks.picks.map((p) => p.element));

  // Pre-filter candidates: for each position, get top players by bootstrap stats
  const candidatesPerPosition = new Map<number, FPLPlayer[]>();
  for (const pos of [1, 2, 3, 4]) {
    const posPlayers = allPlayers
      .filter(
        (p) =>
          p.element_type === pos &&
          !currentSquadIds.has(p.id) &&
          p.status === "a" &&
          p.minutes > 180
      )
      .sort((a, b) => {
        // Quick sort by form + points_per_game
        const aScore = parseFloat(a.form) + parseFloat(a.points_per_game);
        const bScore = parseFloat(b.form) + parseFloat(b.points_per_game);
        return bScore - aScore;
      })
      .slice(0, 30); // top 30 per position
    candidatesPerPosition.set(pos, posPlayers);
  }

  // Collect all player IDs we need summaries for
  const allCandidateIds = Array.from(candidatesPerPosition.values())
    .flat()
    .map((p) => p.id);
  const squadIds = teamPicks.picks.map((p) => p.element);
  const allPlayerIdsToFetch = [...new Set([...squadIds, ...allCandidateIds])];

  // Batch fetch all player summaries
  const summaries = await batchGetPlayerSummaries(allPlayerIdsToFetch, 15);

  // Build analysis for a player
  async function analyzePlayer(player: FPLPlayer): Promise<PlayerAnalysis> {
    const position = getPositionName(player.element_type);
    const teamObj = teams.find((t) => t.id === player.team);
    const upcomingFixtures = getUpcomingFixtures(
      player.team,
      currentGW,
      fixtures,
      teams
    );
    const isPenaltyTaker = penaltyTakers.get(player.team) === player.id;

    // Get rolling stats from history or fallback to bootstrap
    const summary = summaries.get(player.id);
    const rolling = summary
      ? computeRollingStats(summary.history, fixtures, player.element_type)
      : fallbackRollingStats(player);

    // Heuristic scoring (used as fallback and for weakness detection)
    const analysis = scorePlayer(
      player,
      position,
      upcomingFixtures,
      rolling,
      isPenaltyTaker
    );

    // ML prediction (replaces heuristic score if available)
    const prediction = await predictExpectedPoints(
      player,
      position,
      rolling,
      upcomingFixtures,
      isPenaltyTaker
    );

    const expectedPoints = prediction?.expectedPoints ?? analysis.score;
    const playProbability = prediction?.playProbability ?? 1;
    const conditionalPoints = prediction?.conditionalPoints ?? analysis.score;

    return {
      player,
      position,
      teamName: teamObj?.short_name || "???",
      upcomingFixtures,
      isPenaltyTaker,
      rollingStats: rolling,
      expectedPoints,
      playProbability,
      conditionalPoints,
      ...analysis,
      // Override heuristic score with ML prediction
      score: expectedPoints,
    };
  }

  // Analyze squad
  const squad = await Promise.all(
    teamPicks.picks.map(async (pick) => {
      const player = allPlayers.find((p) => p.id === pick.element)!;
      return analyzePlayer(player);
    })
  );

  // Sort squad by score (weakest first) to find transfer targets
  const sortedSquad = [...squad].sort((a, b) => a.score - b.score);
  const weakPlayers = sortedSquad
    .filter((p) => p.weaknesses.length > 0 || p.score < 15)
    .slice(0, 5);

  // Analyze ALL candidates (for "Other Targets" feature)
  const allAnalyzedCandidates: PlayerAnalysis[] = [];
  const analyzedCache = new Map<number, PlayerAnalysis>();

  for (const [, posPlayers] of candidatesPerPosition) {
    const analyzed = await Promise.all(
      posPlayers.map(async (p) => {
        if (analyzedCache.has(p.id)) return analyzedCache.get(p.id)!;
        const a = await analyzePlayer(p);
        analyzedCache.set(p.id, a);
        return a;
      })
    );
    allAnalyzedCandidates.push(...analyzed);
  }

  // Find transfer recommendations (cap each playerIn to max 2 appearances)
  const recommendations: TransferRecommendation[] = [];
  const playerInCount = new Map<number, number>();
  const MAX_SAME_PLAYER_IN = 2;

  for (const weakPlayer of weakPlayers) {
    const positionCandidates =
      candidatesPerPosition.get(weakPlayer.player.element_type) || [];
    const sellingPrice = weakPlayer.player.now_cost;
    const availableBudget = bank + sellingPrice;

    const analyzedCandidates = positionCandidates
      .filter((p) => p.now_cost <= availableBudget)
      .map((p) => analyzedCache.get(p.id)!)
      .filter(Boolean);
    const replacements = analyzedCandidates.sort((a, b) => b.score - a.score);

    // Find the best replacement that hasn't been recommended too many times
    const best = replacements.find((r) => {
      const count = playerInCount.get(r.player.id) || 0;
      return count < MAX_SAME_PLAYER_IN;
    });

    if (best) {
      playerInCount.set(best.player.id, (playerInCount.get(best.player.id) || 0) + 1);
      const netCost = (best.player.now_cost - weakPlayer.player.now_cost) / 10;
      recommendations.push({
        playerOut: weakPlayer,
        playerIn: best,
        netCost,
        reasoning: generateReasoning(weakPlayer, best),
        expertBacked: false,
        priority: best.score - weakPlayer.score,
      });
    }
  }

  recommendations.sort((a, b) => b.priority - a.priority);

  // Team-level weaknesses
  const teamWeaknesses: string[] = [];
  const injuredCount = squad.filter((p) => p.injuryRisk > 0).length;
  const avgForm =
    squad.reduce((sum, p) => sum + p.formScore, 0) / squad.length;

  if (injuredCount > 0)
    teamWeaknesses.push(`${injuredCount} player(s) injured or doubtful`);
  if (avgForm < 4)
    teamWeaknesses.push(
      `Low overall team form (avg ${avgForm.toFixed(1)})`
    );

  const hardFixturePlayers = squad.filter(
    (p) => p.avgFixtureDifficulty >= 4
  ).length;
  if (hardFixturePlayers > 4)
    teamWeaknesses.push(
      `${hardFixturePlayers} players face tough upcoming fixtures`
    );

  const lowNpxGAttackers = squad.filter(
    (p) =>
      (p.position === "MID" || p.position === "FWD") &&
      p.rollingStats.npxGPer90 < 0.1
  ).length;
  if (lowNpxGAttackers > 2)
    teamWeaknesses.push(
      `${lowNpxGAttackers} attackers with low npxG/90 — lacking goal threat`
    );

  // Build allCandidates summary for "Other Targets"
  const allCandidates = allAnalyzedCandidates.map((c) => ({
    id: c.player.id,
    web_name: c.player.web_name,
    team: c.teamName,
    position: c.position,
    form: parseFloat(c.player.form),
    price: c.player.now_cost / 10,
    score: c.score,
    fixtures: c.upcomingFixtures.slice(0, 3).map((f) => ({
      opponent: f.opponent,
      difficulty: f.difficulty,
      isHome: f.isHome,
    })),
  }));

  return {
    teamInfo: {
      name: teamInfo.name,
      managerName: `${teamInfo.player_first_name} ${teamInfo.player_last_name}`,
      overallPoints: teamInfo.summary_overall_points,
      overallRank: teamInfo.summary_overall_rank,
      bank: bank / 10,
      teamValue: teamPicks.entry_history.value / 10,
    },
    currentGameweek: currentGW,
    squad: squad.sort((a, b) => {
      if (a.player.element_type !== b.player.element_type)
        return a.player.element_type - b.player.element_type;
      return b.score - a.score;
    }),
    weaknesses: teamWeaknesses,
    recommendations: recommendations.slice(0, 5),
    allCandidates,
  };
}

// ─── Reasoning generator ──────────────────────────────────────────

function generateReasoning(
  out: PlayerAnalysis,
  inp: PlayerAnalysis
): string[] {
  const reasons: string[] = [];

  if (inp.formScore > out.formScore) {
    reasons.push(
      `Better form: ${parseFloat(inp.player.form).toFixed(1)} vs ${parseFloat(out.player.form).toFixed(1)}`
    );
  }

  if (inp.avgFixtureDifficulty < out.avgFixtureDifficulty) {
    reasons.push(
      `Easier fixtures: avg ${inp.avgFixtureDifficulty.toFixed(1)} vs ${out.avgFixtureDifficulty.toFixed(1)}`
    );
  }

  if (inp.rollingStats.npxGPer90 > out.rollingStats.npxGPer90 + 0.05) {
    reasons.push(
      `Higher npxG/90: ${inp.rollingStats.npxGPer90.toFixed(2)} vs ${out.rollingStats.npxGPer90.toFixed(2)}`
    );
  }

  if (inp.rollingStats.xAPer90 > out.rollingStats.xAPer90 + 0.05) {
    reasons.push(
      `Higher xA/90: ${inp.rollingStats.xAPer90.toFixed(2)} vs ${out.rollingStats.xAPer90.toFixed(2)}`
    );
  }

  if (inp.rollingStats.defensiveContribPer90 > out.rollingStats.defensiveContribPer90 + 1) {
    reasons.push(
      `Stronger defensive contribution: ${inp.rollingStats.defensiveContribPer90.toFixed(1)} vs ${out.rollingStats.defensiveContribPer90.toFixed(1)}/90`
    );
  }

  if (out.injuryRisk > 0 && inp.injuryRisk === 0) {
    reasons.push("Replacing injured/doubtful player with fully fit option");
  }

  if (inp.isPenaltyTaker && !out.isPenaltyTaker) {
    reasons.push("Designated penalty taker — bonus point upside");
  }

  if (inp.minutesScore > out.minutesScore + 1) {
    reasons.push("More consistent minutes");
  }

  if (reasons.length === 0) {
    reasons.push("Overall better composite score for upcoming gameweeks");
  }

  return reasons;
}
