import { readFile } from "fs/promises";
import { join } from "path";
import { FPLPlayer, RollingStats, FixtureAnalysis } from "./types";

// ─── Types ────────────────────────────────────────────────────────

interface TreeNode {
  nodeid: number;
  split?: string;
  split_condition?: number;
  yes?: number;
  no?: number;
  missing?: number;
  children?: TreeNode[];
  leaf?: number;
}

interface XGBoostModel {
  feature_names: string[];
  trees: TreeNode[];
  base_score: number;
  objective: string;
  n_trees: number;
}

interface ModelSet {
  play: XGBoostModel;
  points: XGBoostModel;
}

type PositionModels = Record<"GK" | "DEF" | "MID" | "FWD", ModelSet>;

// ─── Tree Traversal ───────────────────────────────────────────────

function traverseTree(
  node: TreeNode,
  features: Record<string, number>
): number {
  // Leaf node — return value
  if (node.leaf !== undefined) return node.leaf;

  // Internal node — split on feature
  const featureValue = features[node.split!];
  const childMap = new Map(
    (node.children || []).map((c) => [c.nodeid, c])
  );

  let nextId: number;
  if (
    featureValue === undefined ||
    featureValue === null ||
    isNaN(featureValue)
  ) {
    nextId = node.missing!;
  } else if (featureValue < node.split_condition!) {
    nextId = node.yes!;
  } else {
    nextId = node.no!;
  }

  const nextNode = childMap.get(nextId);
  if (!nextNode) return 0;
  return traverseTree(nextNode, features);
}

function predict(model: XGBoostModel, features: Record<string, number>): number {
  let sum = model.base_score;
  for (const tree of model.trees) {
    sum += traverseTree(tree, features);
  }

  // Apply sigmoid for binary classification
  if (model.objective === "binary:logistic") {
    return 1 / (1 + Math.exp(-sum));
  }
  return sum;
}

// ─── Model Loading (cached) ──────────────────────────────────────

let cachedModels: PositionModels | null = null;
let modelLoadFailed = false;

async function loadModels(): Promise<PositionModels | null> {
  if (cachedModels) return cachedModels;
  if (modelLoadFailed) return null;

  try {
    const modelsDir = join(process.cwd(), "public", "models");
    const positions = ["gk", "def", "mid", "fwd"] as const;
    const posMap = {
      gk: "GK",
      def: "DEF",
      mid: "MID",
      fwd: "FWD",
    } as const;

    const models = {} as PositionModels;
    for (const pos of positions) {
      const [playJson, pointsJson] = await Promise.all([
        readFile(join(modelsDir, `${pos}_play.json`), "utf-8"),
        readFile(join(modelsDir, `${pos}_points.json`), "utf-8"),
      ]);
      models[posMap[pos]] = {
        play: JSON.parse(playJson),
        points: JSON.parse(pointsJson),
      };
    }

    cachedModels = models;
    return models;
  } catch (err) {
    console.error("Failed to load ML models, falling back to heuristic scoring:", err);
    modelLoadFailed = true;
    return null;
  }
}

// ─── Feature Extraction ──────────────────────────────────────────

function extractFeatures(
  player: FPLPlayer,
  rolling: RollingStats,
  upcomingFixtures: FixtureAnalysis[],
  isPenaltyTaker: boolean
): Record<string, number> {
  const avgFixtureDifficulty =
    upcomingFixtures.length > 0
      ? upcomingFixtures.reduce((s, f) => s + f.difficulty, 0) /
        upcomingFixtures.length
      : 3;

  let injuryRisk = 0;
  if (player.status === "i" || player.status === "s") injuryRisk = 1;
  else if (player.status === "d") injuryRisk = 0.5;

  return {
    npxg_per90: rolling.npxGPer90,
    xa_per90: rolling.xAPer90,
    saves_per90: rolling.savesPer90,
    xgc_per90: rolling.xGCPer90,
    def_contrib_per90: rolling.defensiveContribPer90,
    ict_per90: rolling.ictPer90,
    minutes_per90: rolling.minutesPer90,
    form: parseFloat(player.form) || 0,
    is_penalty_taker: isPenaltyTaker ? 1 : 0,
    avg_fixture_difficulty: avgFixtureDifficulty,
    games_played: rolling.gamesPlayed,
    injury_risk: injuryRisk,
    is_home_next:
      upcomingFixtures.length > 0 && upcomingFixtures[0].isHome ? 1 : 0,
    value: player.now_cost / 10,
    selected_pct: parseFloat(player.selected_by_percent) || 0,
    bps_per90: rolling.bpsPer90,
    goals_per90: rolling.goalsPer90,
    assists_per90: rolling.assistsPer90,
    clean_sheets_per90: rolling.cleanSheetsPer90,
    bonus_per90: rolling.bonusPer90,
  };
}

// ─── Public API ──────────────────────────────────────────────────

export interface PredictionResult {
  expectedPoints: number;
  playProbability: number;
  conditionalPoints: number;
}

export async function predictExpectedPoints(
  player: FPLPlayer,
  position: string,
  rolling: RollingStats,
  upcomingFixtures: FixtureAnalysis[],
  isPenaltyTaker: boolean
): Promise<PredictionResult | null> {
  const models = await loadModels();
  if (!models) return null;

  const posKey = position as keyof PositionModels;
  const modelSet = models[posKey];
  if (!modelSet) return null;

  const features = extractFeatures(
    player,
    rolling,
    upcomingFixtures,
    isPenaltyTaker
  );

  const conditionalPoints = Math.max(0, predict(modelSet.points, features));

  // Scale by number of remaining fixtures if < 5
  const fixtureCount = Math.min(upcomingFixtures.length, 5);
  const scaleFactor = fixtureCount > 0 ? fixtureCount / 5 : 1;
  const expectedPoints = conditionalPoints * scaleFactor;

  return {
    expectedPoints: Math.round(expectedPoints * 10) / 10,
    playProbability: 1, // P(play) removed — availability shown via injury status instead
    conditionalPoints: Math.round(expectedPoints * 10) / 10,
  };
}

export function isModelAvailable(): boolean {
  return cachedModels !== null && !modelLoadFailed;
}
