export interface FPLBootstrap {
  elements: FPLPlayer[];
  teams: FPLTeam[];
  events: FPLGameweek[];
  element_types: FPLPosition[];
}

export interface FPLPlayer {
  id: number;
  web_name: string;
  first_name: string;
  second_name: string;
  team: number;
  element_type: number; // 1=GK, 2=DEF, 3=MID, 4=FWD
  now_cost: number; // cost * 10
  form: string;
  total_points: number;
  points_per_game: string;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  ict_index: string;
  expected_goals: string;
  expected_assists: string;
  expected_goal_involvements: string;
  expected_goals_conceded: string;
  selected_by_percent: string;
  status: string; // 'a' = available, 'i' = injured, 'd' = doubtful, 'u' = unavailable, 's' = suspended
  chance_of_playing_next_round: number | null;
  news: string;
  selling_price?: number;
  penalties_order: number | null;
  penalties_missed: number;
  penalties_text: string;
  saves: number;
  saves_per_90: number;
  expected_goals_per_90: number;
  expected_assists_per_90: number;
  expected_goal_involvements_per_90: number;
  expected_goals_conceded_per_90: number;
  clean_sheets_per_90: number;
  defensive_contribution_per_90: number;
  starts: number;
  influence: string;
  creativity: string;
  threat: string;
  clearances_blocks_interceptions: number;
  recoveries: number;
  tackles: number;
  defensive_contribution: number;
}

export interface FPLTeam {
  id: number;
  name: string;
  short_name: string;
  strength_overall_home: number;
  strength_overall_away: number;
  strength_attack_home: number;
  strength_attack_away: number;
  strength_defence_home: number;
  strength_defence_away: number;
}

export interface FPLGameweek {
  id: number;
  name: string;
  deadline_time: string;
  is_current: boolean;
  is_next: boolean;
  finished: boolean;
  average_entry_score: number;
}

export interface FPLPosition {
  id: number;
  singular_name: string;
  singular_name_short: string;
  plural_name: string;
}

export interface FPLFixture {
  id: number;
  event: number | null;
  team_h: number;
  team_a: number;
  team_h_difficulty: number;
  team_a_difficulty: number;
  finished: boolean;
  kickoff_time: string;
}

export interface FPLTeamPicks {
  active_chip: string | null;
  entry_history: {
    bank: number;
    value: number;
    event_transfers: number;
    event_transfers_cost: number;
  };
  picks: FPLPick[];
}

export interface FPLPick {
  element: number;
  position: number;
  multiplier: number;
  is_captain: boolean;
  is_vice_captain: boolean;
}

export interface FPLTeamInfo {
  id: number;
  name: string;
  player_first_name: string;
  player_last_name: string;
  summary_overall_points: number;
  summary_overall_rank: number;
  current_event: number;
  last_deadline_bank: number;
  last_deadline_value: number;
  last_deadline_total_transfers: number;
  leagues: {
    classic: FPLLeague[];
    h2h: FPLLeague[];
  };
}

export interface FPLLeague {
  id: number;
  name: string;
  short_name: string;
  league_type: string; // 's' = system, 'x' = private
  scoring: string;
  rank_count: number;
  entry_rank: number;
  entry_last_rank: number;
  entry_percentile_rank: number;
  active_phases: {
    phase: number;
    rank: number;
    last_rank: number;
    total: number;
    rank_count: number;
    entry_percentile_rank: number;
  }[];
}

export interface FPLPlayerSummary {
  fixtures: FPLPlayerFixture[];
  history: FPLPlayerHistory[];
}

export interface FPLPlayerFixture {
  event: number;
  is_home: boolean;
  difficulty: number;
  team_h: number;
  team_a: number;
}

export interface FPLPlayerHistory {
  element: number;
  fixture: number;
  opponent_team: number;
  round: number;
  total_points: number;
  was_home: boolean;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  goals_conceded: number;
  penalties_saved: number;
  penalties_missed: number;
  saves: number;
  bonus: number;
  bps: number;
  influence: string;
  creativity: string;
  threat: string;
  ict_index: string;
  clearances_blocks_interceptions: number;
  recoveries: number;
  tackles: number;
  defensive_contribution: number;
  starts: number;
  expected_goals: string;
  expected_assists: string;
  expected_goal_involvements: string;
  expected_goals_conceded: string;
}

// Analysis types

export interface RollingStats {
  npxGPer90: number;
  xAPer90: number;
  savesPer90: number;
  xGCPer90: number;
  defensiveContribPer90: number;
  ictPer90: number;
  minutesPer90: number;
  gamesPlayed: number;
  goalsPer90: number;
  assistsPer90: number;
  cleanSheetsPer90: number;
  bonusPer90: number;
  bpsPer90: number;
}

export interface PlayerAnalysis {
  player: FPLPlayer;
  position: string;
  teamName: string;
  score: number;
  expectedPoints: number;
  playProbability: number;
  conditionalPoints: number;
  upcomingFixtures: FixtureAnalysis[];
  avgFixtureDifficulty: number;
  formScore: number;
  minutesScore: number;
  injuryRisk: number;
  isPenaltyTaker: boolean;
  rollingStats: RollingStats;
  weaknesses: string[];
}

export interface FixtureAnalysis {
  gameweek: number;
  opponent: string;
  difficulty: number;
  isHome: boolean;
}

export interface TransferRecommendation {
  playerOut: PlayerAnalysis;
  playerIn: PlayerAnalysis;
  netCost: number;
  reasoning: string[];
  expertBacked: boolean;
  priority: number;
}

export interface QuickTeamResult {
  teamInfo: {
    name: string;
    managerName: string;
    overallPoints: number;
    overallRank: number;
    bank: number;
    teamValue: number;
  };
  currentGameweek: number;
  leagues: {
    id: number;
    name: string;
    rank: number;
    totalEntries: number;
    rankChange: number; // positive = improved
    percentile: number;
  }[];
  squadSummary: {
    playerName: string;
    position: string;
    teamName: string;
    form: number;
    price: number;
    status: string;
  }[];
}

export interface AnalysisResult {
  teamInfo: {
    name: string;
    managerName: string;
    overallPoints: number;
    overallRank: number;
    bank: number;
    teamValue: number;
  };
  currentGameweek: number;
  squad: PlayerAnalysis[];
  weaknesses: string[];
  recommendations: TransferRecommendation[];
  allCandidates?: { id: number; web_name: string; team: string; position: string; form: number; price: number; score: number; fixtures: { opponent: string; difficulty: number; isHome: boolean }[] }[];
}
