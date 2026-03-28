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
  selected_by_percent: string;
  status: string; // 'a' = available, 'i' = injured, 'd' = doubtful, 'u' = unavailable, 's' = suspended
  chance_of_playing_next_round: number | null;
  news: string;
  selling_price?: number;
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
}

export interface FPLPosition {
  id: number;
  singular_name: string;
  singular_name_short: string;
  plural_name: string;
}

export interface FPLFixture {
  id: number;
  event: number | null; // gameweek
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
    bank: number; // remaining budget * 10
    value: number;
    event_transfers: number;
    event_transfers_cost: number;
  };
  picks: FPLPick[];
}

export interface FPLPick {
  element: number; // player id
  position: number; // squad position (1-15)
  multiplier: number; // 0=bench, 1=playing, 2=captain, 3=triple captain
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
  round: number;
  total_points: number;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  bps: number;
}

// Analysis types

export interface PlayerAnalysis {
  player: FPLPlayer;
  position: string;
  teamName: string;
  score: number;
  upcomingFixtures: FixtureAnalysis[];
  avgFixtureDifficulty: number;
  formScore: number;
  minutesScore: number;
  injuryRisk: number;
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
}
