import {
  FPLBootstrap,
  FPLFixture,
  FPLTeamPicks,
  FPLTeamInfo,
  FPLPlayer,
  PlayerAnalysis,
  FixtureAnalysis,
  TransferRecommendation,
  AnalysisResult,
} from "./types";
import {
  getBootstrapData,
  getTeamInfo,
  getTeamPicks,
  getFixtures,
  getCurrentGameweek,
  getPositionName,
} from "./fpl-api";

const FIXTURE_LOOKAHEAD = 5;

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

function scorePlayer(
  player: FPLPlayer,
  upcomingFixtures: FixtureAnalysis[]
): {
  score: number;
  formScore: number;
  minutesScore: number;
  injuryRisk: number;
  avgFixtureDifficulty: number;
  weaknesses: string[];
} {
  const weaknesses: string[] = [];

  // Form score (0-10): higher is better
  const form = parseFloat(player.form) || 0;
  const formScore = Math.min(form, 10);
  if (form < 3) weaknesses.push(`Low form (${form})`);

  // Minutes score (0-10): penalize players not getting minutes
  const minutesScore = Math.min(player.minutes / 270, 10); // ~3 full games = max
  if (player.minutes < 90) weaknesses.push("Barely playing");
  else if (player.minutes < 180) weaknesses.push("Limited minutes");

  // Fixture difficulty (1-5 scale, lower is easier)
  const avgFixtureDifficulty =
    upcomingFixtures.length > 0
      ? upcomingFixtures.reduce((sum, f) => sum + f.difficulty, 0) /
        upcomingFixtures.length
      : 3;
  const fixtureScore = (5 - avgFixtureDifficulty) * 2; // 0-8 scale
  if (avgFixtureDifficulty >= 4)
    weaknesses.push(`Tough upcoming fixtures (avg ${avgFixtureDifficulty.toFixed(1)})`);

  // Injury risk
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

  // Composite score: higher = better player to keep
  const score =
    formScore * 3 +
    minutesScore * 2 +
    fixtureScore * 2 -
    injuryRisk * 2 +
    parseFloat(player.ict_index || "0") * 0.1;

  return {
    score,
    formScore,
    minutesScore,
    injuryRisk,
    avgFixtureDifficulty,
    weaknesses,
  };
}

function findReplacements(
  weakPlayer: PlayerAnalysis,
  allPlayers: FPLPlayer[],
  currentSquadIds: Set<number>,
  budget: number,
  currentGW: number,
  fixtures: FPLFixture[],
  teams: FPLBootstrap["teams"]
): PlayerAnalysis[] {
  // Find players in the same position, not already in squad, within budget
  const sellingPrice = weakPlayer.player.now_cost; // simplified: assume selling price = current price
  const availableBudget = budget + sellingPrice;

  const candidates = allPlayers
    .filter(
      (p) =>
        p.element_type === weakPlayer.player.element_type &&
        !currentSquadIds.has(p.id) &&
        p.now_cost <= availableBudget &&
        p.status === "a" &&
        p.minutes > 90 // must have some game time
    )
    .map((player) => {
      const upcomingFixtures = getUpcomingFixtures(
        player.team,
        currentGW,
        fixtures,
        teams
      );
      const analysis = scorePlayer(player, upcomingFixtures);
      const teamObj = teams.find((t) => t.id === player.team);
      return {
        player,
        position: getPositionName(player.element_type),
        teamName: teamObj?.short_name || "???",
        upcomingFixtures,
        ...analysis,
      };
    })
    .sort((a, b) => b.score - a.score);

  return candidates.slice(0, 10);
}

function generateReasoning(
  playerOut: PlayerAnalysis,
  playerIn: PlayerAnalysis
): string[] {
  const reasons: string[] = [];

  if (playerIn.formScore > playerOut.formScore) {
    reasons.push(
      `Better form: ${parseFloat(playerIn.player.form).toFixed(1)} vs ${parseFloat(playerOut.player.form).toFixed(1)}`
    );
  }

  if (playerIn.avgFixtureDifficulty < playerOut.avgFixtureDifficulty) {
    reasons.push(
      `Easier fixtures: avg ${playerIn.avgFixtureDifficulty.toFixed(1)} vs ${playerOut.avgFixtureDifficulty.toFixed(1)}`
    );
  }

  if (playerOut.injuryRisk > 0 && playerIn.injuryRisk === 0) {
    reasons.push("Replacing injured/doubtful player with fully fit option");
  }

  if (playerIn.minutesScore > playerOut.minutesScore) {
    reasons.push("More consistent minutes");
  }

  const xgiIn = parseFloat(playerIn.player.expected_goal_involvements || "0");
  const xgiOut = parseFloat(playerOut.player.expected_goal_involvements || "0");
  if (xgiIn > xgiOut) {
    reasons.push(
      `Higher expected goal involvement: ${xgiIn.toFixed(2)} vs ${xgiOut.toFixed(2)}`
    );
  }

  if (reasons.length === 0) {
    reasons.push("Overall better composite score for upcoming gameweeks");
  }

  return reasons;
}

export async function analyzeTeam(teamId: number): Promise<AnalysisResult> {
  // Fetch all data in parallel
  const [bootstrap, teamInfo, fixtures] = await Promise.all([
    getBootstrapData(),
    getTeamInfo(teamId),
    getFixtures(),
  ]);

  const currentGW = getCurrentGameweek(bootstrap);
  const { teams, elements: allPlayers } = bootstrap;

  // Get current squad picks
  const teamPicks = await getTeamPicks(teamId, currentGW);
  const bank = teamPicks.entry_history.bank; // in tenths

  // Build squad analysis
  const currentSquadIds = new Set(teamPicks.picks.map((p) => p.element));
  const squad: PlayerAnalysis[] = teamPicks.picks.map((pick) => {
    const player = allPlayers.find((p) => p.id === pick.element)!;
    const upcomingFixtures = getUpcomingFixtures(
      player.team,
      currentGW,
      fixtures,
      teams
    );
    const analysis = scorePlayer(player, upcomingFixtures);
    const teamObj = teams.find((t) => t.id === player.team);
    return {
      player,
      position: getPositionName(player.element_type),
      teamName: teamObj?.short_name || "???",
      upcomingFixtures,
      ...analysis,
    };
  });

  // Sort squad by score (weakest first)
  const sortedSquad = [...squad].sort((a, b) => a.score - b.score);

  // Identify weakest players (bottom 5 or those with significant weaknesses)
  const weakPlayers = sortedSquad
    .filter((p) => p.weaknesses.length > 0 || p.score < 15)
    .slice(0, 5);

  // Find transfer recommendations
  const recommendations: TransferRecommendation[] = [];
  for (const weakPlayer of weakPlayers) {
    const replacements = findReplacements(
      weakPlayer,
      allPlayers,
      currentSquadIds,
      bank,
      currentGW,
      fixtures,
      teams
    );

    if (replacements.length > 0) {
      const bestReplacement = replacements[0];
      const netCost =
        (bestReplacement.player.now_cost - weakPlayer.player.now_cost) / 10;
      recommendations.push({
        playerOut: weakPlayer,
        playerIn: bestReplacement,
        netCost,
        reasoning: generateReasoning(weakPlayer, bestReplacement),
        expertBacked: false, // will be updated by scraper
        priority: bestReplacement.score - weakPlayer.score,
      });
    }
  }

  // Sort by priority (biggest improvement first)
  recommendations.sort((a, b) => b.priority - a.priority);

  // Overall team weaknesses
  const teamWeaknesses: string[] = [];
  const positionCounts = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  const injuredCount = squad.filter((p) => p.injuryRisk > 0).length;
  const avgForm =
    squad.reduce((sum, p) => sum + p.formScore, 0) / squad.length;

  squad.forEach((p) => {
    if (p.position in positionCounts) {
      positionCounts[p.position as keyof typeof positionCounts]++;
    }
  });

  if (injuredCount > 0)
    teamWeaknesses.push(`${injuredCount} player(s) injured or doubtful`);
  if (avgForm < 4) teamWeaknesses.push(`Low overall team form (avg ${avgForm.toFixed(1)})`);

  const highDifficultyPlayers = squad.filter(
    (p) => p.avgFixtureDifficulty >= 4
  ).length;
  if (highDifficultyPlayers > 4)
    teamWeaknesses.push(
      `${highDifficultyPlayers} players face tough upcoming fixtures`
    );

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
      // Sort by position then score
      if (a.player.element_type !== b.player.element_type)
        return a.player.element_type - b.player.element_type;
      return b.score - a.score;
    }),
    weaknesses: teamWeaknesses,
    recommendations: recommendations.slice(0, 5),
  };
}
