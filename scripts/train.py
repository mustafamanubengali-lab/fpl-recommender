"""
Train XGBoost models to predict FPL points over next N gameweeks.

Two-stage pipeline per position (GK, DEF, MID, FWD):
  Stage 1: P(player gets minutes next GW) — binary classification
  Stage 2: E(total points over next N GWs | player plays) — regression

Features mirror the app's existing computeRollingStats() function:
  Rolling 5-game per-90 averages, fixture-difficulty normalized.
"""

import json
import os
import warnings

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, roc_auc_score

warnings.filterwarnings("ignore")

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
MODELS_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "models")
os.makedirs(MODELS_DIR, exist_ok=True)

ROLLING_WINDOW = 5
MAX_LOOKAHEAD = 5
PENALTY_XG = 0.76

POSITIONS = {"GK": "GK", "DEF": "DEF", "MID": "MID", "FWD": "FWD"}
POS_CODE_MAP = {"GK": 1, "DEF": 2, "MID": 3, "FWD": 4}
TRAIN_SEASONS = ["2022-23", "2023-24"]
VAL_SEASON = "2024-25"

FEATURE_NAMES = [
    "npxg_per90",
    "xa_per90",
    "saves_per90",
    "xgc_per90",
    "def_contrib_per90",
    "ict_per90",
    "minutes_per90",
    "form",
    "is_penalty_taker",
    "avg_fixture_difficulty",
    "games_played",
    "injury_risk",
    "is_home_next",
    "value",
    "selected_pct",
    "bps_per90",
    "goals_per90",
    "assists_per90",
    "clean_sheets_per90",
    "bonus_per90",
]


# ─── Data Loading ───────────────────────────────────────────────────


def load_season(season: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Load merged gameweek data and fixtures for a season."""
    season_dir = os.path.join(DATA_DIR, season)

    gw = pd.read_csv(
        os.path.join(season_dir, "merged_gw.csv"), encoding="utf-8-sig"
    )
    fixtures = pd.read_csv(
        os.path.join(season_dir, "fixtures.csv"), encoding="utf-8-sig"
    )

    gw["season"] = season
    fixtures["season"] = season

    # Ensure numeric types
    for col in [
        "expected_goals", "expected_assists", "expected_goal_involvements",
        "expected_goals_conceded", "ict_index", "influence", "creativity",
        "threat",
    ]:
        if col in gw.columns:
            gw[col] = pd.to_numeric(gw[col], errors="coerce").fillna(0)

    return gw, fixtures


def get_fixture_difficulty(
    gw_row: pd.Series, fixtures: pd.DataFrame
) -> float:
    """Get fixture difficulty for a player's game."""
    if "fixture" not in gw_row or pd.isna(gw_row.get("fixture")):
        return 3.0

    fix = fixtures[fixtures["id"] == gw_row["fixture"]]
    if fix.empty:
        return 3.0

    fix = fix.iloc[0]
    was_home = gw_row.get("was_home", True)
    if isinstance(was_home, str):
        was_home = was_home.lower() in ("true", "1", "yes")

    if was_home:
        return float(fix.get("team_h_difficulty", 3))
    else:
        return float(fix.get("team_a_difficulty", 3))


# ─── Feature Engineering ───────────────────────────────────────────


def compute_rolling_features(player_games: pd.DataFrame, fixtures: pd.DataFrame) -> pd.DataFrame:
    """Compute rolling 5-game per-90 features for a single player's games."""
    if len(player_games) < 2:
        return pd.DataFrame()

    # Sort by round
    games = player_games.sort_values("round").reset_index(drop=True)

    # Pre-compute fixture difficulty for each game
    difficulties = []
    for _, row in games.iterrows():
        difficulties.append(get_fixture_difficulty(row, fixtures))
    games["fixture_difficulty"] = difficulties

    rows = []
    for i in range(len(games)):
        # Rolling window: last ROLLING_WINDOW games with minutes > 0, BEFORE this game
        past = games.iloc[:i]
        played = past[past["minutes"] > 0].tail(ROLLING_WINDOW)

        if len(played) < 2:
            continue

        current = games.iloc[i]
        n = len(played)

        # Per-game per-90 stats, fixture-normalized
        total_npxg = 0
        total_xa = 0
        total_saves = 0
        total_xgc = 0
        total_def_contrib = 0
        total_ict = 0
        total_bps = 0
        total_goals = 0
        total_assists = 0
        total_cs = 0
        total_bonus = 0
        total_minutes = 0

        for _, g in played.iterrows():
            mins = g["minutes"]
            if mins <= 0:
                continue

            diff = g.get("fixture_difficulty", 3)
            diff_mult = diff / 3.0  # normalize: avg difficulty = 1x
            per90 = 90.0 / mins

            # npxG: xG minus estimated penalty xG
            raw_xg = float(g.get("expected_goals", 0) or 0)
            pens_missed = int(g.get("penalties_missed", 0) or 0)
            goals = int(g.get("goals_scored", 0) or 0)
            pen_scored_est = max(0, round(goals - raw_xg)) if goals > raw_xg + 0.5 else 0
            pens_taken = pens_missed + pen_scored_est
            npxg = max(0, raw_xg - pens_taken * PENALTY_XG)

            total_npxg += npxg * per90 * diff_mult
            total_xa += float(g.get("expected_assists", 0) or 0) * per90 * diff_mult
            total_saves += int(g.get("saves", 0) or 0) * per90 * diff_mult
            total_xgc += float(g.get("expected_goals_conceded", 0) or 0) * per90  # no diff normalization
            total_ict += float(g.get("ict_index", 0) or 0) * per90 * diff_mult
            total_bps += int(g.get("bps", 0) or 0) * per90 * diff_mult
            total_goals += goals * per90 * diff_mult
            total_assists += int(g.get("assists", 0) or 0) * per90 * diff_mult
            total_cs += int(g.get("clean_sheets", 0) or 0) * per90 * diff_mult
            total_bonus += int(g.get("bonus", 0) or 0) * per90 * diff_mult
            total_minutes += mins

            # Defensive contribution (not available in historical CSVs, use 0)
            dc = 0
            for dc_col in ["defensive_contribution", "clearances_blocks_interceptions"]:
                if dc_col in g.index and not pd.isna(g.get(dc_col)):
                    dc = float(g.get(dc_col, 0) or 0)
                    break
            total_def_contrib += dc * per90 * diff_mult

        # Penalty taker detection: was this player the main pen taker in their recent games?
        pen_activity = played.apply(
            lambda g: int(g.get("penalties_missed", 0) or 0)
            + (max(0, round(int(g.get("goals_scored", 0) or 0) - float(g.get("expected_goals", 0) or 0)))
               if int(g.get("goals_scored", 0) or 0) > float(g.get("expected_goals", 0) or 0) + 0.5
               else 0),
            axis=1,
        ).sum()
        is_pen_taker = 1 if pen_activity >= 2 else 0  # took 2+ pens in window

        # Form: avg points over rolling window
        form = played["total_points"].mean()

        # Is home next
        was_home = current.get("was_home", True)
        if isinstance(was_home, str):
            was_home = was_home.lower() in ("true", "1", "yes")
        is_home_next = 1 if was_home else 0

        # Value and ownership
        value = float(current.get("value", 50) or 50) / 10
        selected = float(current.get("selected", 0) or 0)
        # Normalize selected to percentage (rough: divide by total managers ~10M)
        selected_pct = min(selected / 100000, 100) if selected > 1000 else selected

        row = {
            "npxg_per90": total_npxg / n,
            "xa_per90": total_xa / n,
            "saves_per90": total_saves / n,
            "xgc_per90": total_xgc / n,
            "def_contrib_per90": total_def_contrib / n,
            "ict_per90": total_ict / n,
            "minutes_per90": total_minutes / n,
            "form": form,
            "is_penalty_taker": is_pen_taker,
            "avg_fixture_difficulty": current.get("fixture_difficulty", 3),
            "games_played": n,
            "injury_risk": 0,  # not available in historical data
            "is_home_next": is_home_next,
            "value": value,
            "selected_pct": selected_pct,
            "bps_per90": total_bps / n,
            "goals_per90": total_goals / n,
            "assists_per90": total_assists / n,
            "clean_sheets_per90": total_cs / n,
            "bonus_per90": total_bonus / n,
            # Metadata for target construction
            "_element": current.get("element", current.get("name", "")),
            "_round": current["round"],
            "_position": current.get("position", "MID"),
            "_minutes": current["minutes"],
            "_total_points": current["total_points"],
            "_season": current.get("season", ""),
        }
        rows.append(row)

    return pd.DataFrame(rows)


def build_targets(df: pd.DataFrame) -> pd.DataFrame:
    """Add target variables: next-GW minutes and next-N-GW total points."""
    results = []

    for (season, element), group in df.groupby(["_season", "_element"]):
        group = group.sort_values("_round").reset_index(drop=True)
        max_round = group["_round"].max()

        for i in range(len(group)):
            row = group.iloc[i].copy()
            current_round = row["_round"]

            # Future games for this player
            future = group[group["_round"] > current_round]

            # Number of remaining fixtures
            remaining = max_round - current_round
            lookahead = min(MAX_LOOKAHEAD, remaining)

            if lookahead == 0:
                continue

            # Target 1: did they play next GW?
            next_gw = future[future["_round"] == current_round + 1]
            if len(next_gw) > 0:
                row["target_played_next"] = 1 if next_gw.iloc[0]["_minutes"] > 0 else 0
            else:
                row["target_played_next"] = 0

            # Target 2: sum of points over next N GWs
            future_n = future.head(lookahead)
            row["target_points_sum"] = future_n["_total_points"].sum()
            row["_lookahead"] = lookahead

            results.append(row)

    return pd.DataFrame(results)


# ─── Model Training ────────────────────────────────────────────────


def export_model_json(model: xgb.XGBModel, feature_names: list[str]) -> dict:
    """Export XGBoost model to simplified JSON for TypeScript inference."""
    trees_json = model.get_booster().get_dump(dump_format="json")
    trees = [json.loads(t) for t in trees_json]

    objective = model.get_params().get("objective") or "reg:squarederror"

    # XGBoost 2.x auto-estimates base_score from data but get_params() returns None.
    # Extract the actual base_score from the booster's internal config.
    import json as _json
    config = _json.loads(model.get_booster().save_config())
    base_score = float(
        config["learner"]["learner_model_param"]["base_score"]
    )
    print(f"    Extracted base_score: {base_score:.4f}")

    return {
        "feature_names": feature_names,
        "trees": trees,
        "base_score": base_score,
        "objective": objective,
        "n_trees": len(trees),
    }


def train_position_models(
    train_df: pd.DataFrame,
    val_df: pd.DataFrame,
    position: str,
) -> dict:
    """Train Stage 1 (play) and Stage 2 (points) models for a position."""
    print(f"\n{'='*60}")
    print(f"  Training {position} models")
    print(f"{'='*60}")

    # Filter to position (string: GK/DEF/MID/FWD)
    train_pos = train_df[train_df["_position"] == position].copy()
    val_pos = val_df[val_df["_position"] == position].copy()

    print(f"  Training samples: {len(train_pos)}, Validation samples: {len(val_pos)}")

    if len(train_pos) < 100:
        print(f"  SKIPPING: too few samples")
        return {}

    features = FEATURE_NAMES

    # ── Stage 1: P(play) ──
    print(f"\n  Stage 1: Play probability")
    X_train_1 = train_pos[features].fillna(0)
    y_train_1 = train_pos["target_played_next"]
    X_val_1 = val_pos[features].fillna(0)
    y_val_1 = val_pos["target_played_next"]

    model_play = xgb.XGBClassifier(
        objective="binary:logistic",
        max_depth=5,
        learning_rate=0.05,
        n_estimators=200,
        min_child_weight=10,
        subsample=0.8,
        colsample_bytree=0.8,
        reg_alpha=0.1,
        reg_lambda=1.0,
        eval_metric="auc",
        early_stopping_rounds=20,
        verbosity=0,
    )
    model_play.fit(
        X_train_1, y_train_1,
        eval_set=[(X_val_1, y_val_1)],
        verbose=False,
    )

    val_pred_play = model_play.predict_proba(X_val_1)[:, 1]
    auc = roc_auc_score(y_val_1, val_pred_play) if y_val_1.nunique() > 1 else 0
    print(f"  Validation AUC: {auc:.4f}")

    # ── Stage 2: E(points|play) ──
    print(f"\n  Stage 2: Points prediction (conditional on playing)")
    # Train only on rows where player actually played
    train_played = train_pos[train_pos["_minutes"] > 0]
    val_played = val_pos[val_pos["_minutes"] > 0]

    X_train_2 = train_played[features].fillna(0)
    y_train_2 = train_played["target_points_sum"]
    X_val_2 = val_played[features].fillna(0)
    y_val_2 = val_played["target_points_sum"]

    model_points = xgb.XGBRegressor(
        objective="reg:squarederror",
        max_depth=6,
        learning_rate=0.05,
        n_estimators=300,
        min_child_weight=10,
        subsample=0.8,
        colsample_bytree=0.8,
        reg_alpha=0.1,
        reg_lambda=1.0,
        eval_metric="mae",
        early_stopping_rounds=20,
        verbosity=0,
    )
    model_points.fit(
        X_train_2, y_train_2,
        eval_set=[(X_val_2, y_val_2)],
        verbose=False,
    )

    val_pred_points = model_points.predict(X_val_2)
    mae = mean_absolute_error(y_val_2, val_pred_points)
    print(f"  Validation MAE: {mae:.2f} points")

    # Feature importance
    print(f"\n  Top 10 feature importances (points model):")
    importance = model_points.feature_importances_
    feat_imp = sorted(zip(features, importance), key=lambda x: -x[1])
    for feat, imp in feat_imp[:10]:
        print(f"    {feat:25s} {imp:.4f}")

    # Export models
    pos_lower = position.lower()
    play_json = export_model_json(model_play, features)
    points_json = export_model_json(model_points, features)

    play_path = os.path.join(MODELS_DIR, f"{pos_lower}_play.json")
    points_path = os.path.join(MODELS_DIR, f"{pos_lower}_points.json")

    with open(play_path, "w") as f:
        json.dump(play_json, f)
    with open(points_path, "w") as f:
        json.dump(points_json, f)

    print(f"\n  Saved: {play_path}")
    print(f"  Saved: {points_path}")
    play_size = os.path.getsize(play_path) / 1024 / 1024
    points_size = os.path.getsize(points_path) / 1024 / 1024
    print(f"  Sizes: play={play_size:.1f}MB, points={points_size:.1f}MB")

    return {
        "position": position,
        "train_samples": len(train_pos),
        "val_samples": len(val_pos),
        "play_auc": round(auc, 4),
        "points_mae": round(mae, 2),
        "top_features": [f for f, _ in feat_imp[:5]],
    }


# ─── Main ──────────────────────────────────────────────────────────


def main():
    print("=" * 60)
    print("  FPL Recommender — XGBoost Training Pipeline")
    print("=" * 60)

    # Load all season data
    all_gw = []
    all_fixtures = []
    for season in TRAIN_SEASONS + [VAL_SEASON]:
        print(f"\nLoading {season}...")
        gw, fix = load_season(season)
        all_gw.append(gw)
        all_fixtures.append(fix)
        print(f"  {len(gw)} player-gameweek rows, {len(fix)} fixtures")

    # Process each season separately (rolling stats don't cross seasons)
    all_features = []
    for gw_df, fix_df in zip(all_gw, all_fixtures):
        season = gw_df["season"].iloc[0]
        print(f"\nComputing rolling features for {season}...")

        # Determine element column name
        element_col = "element" if "element" in gw_df.columns else "name"

        # Position column should be string (GK/DEF/MID/FWD) — kept as-is

        # Process each player
        player_dfs = []
        players = gw_df[element_col].unique()
        for player_id in players:
            player_games = gw_df[gw_df[element_col] == player_id].copy()
            if "element" not in player_games.columns:
                player_games["element"] = player_id
            feats = compute_rolling_features(player_games, fix_df)
            if len(feats) > 0:
                player_dfs.append(feats)

        if player_dfs:
            season_features = pd.concat(player_dfs, ignore_index=True)
            print(f"  Generated {len(season_features)} feature rows")
            all_features.append(season_features)

    # Combine and build targets
    all_df = pd.concat(all_features, ignore_index=True)
    print(f"\nTotal feature rows: {len(all_df)}")

    print("\nBuilding target variables...")
    all_df = build_targets(all_df)
    print(f"Rows with targets: {len(all_df)}")

    # Split train/val
    train_df = all_df[all_df["_season"].isin(TRAIN_SEASONS)]
    val_df = all_df[all_df["_season"] == VAL_SEASON]
    print(f"\nTrain: {len(train_df)} rows, Val: {len(val_df)} rows")

    # Train per position
    metadata = {
        "feature_names": FEATURE_NAMES,
        "positions": {},
        "train_seasons": TRAIN_SEASONS,
        "val_season": VAL_SEASON,
        "rolling_window": ROLLING_WINDOW,
        "max_lookahead": MAX_LOOKAHEAD,
    }

    for pos_name in POSITIONS.values():
        result = train_position_models(train_df, val_df, pos_name)
        if result:
            metadata["positions"][pos_name] = result

    # Save metadata
    meta_path = os.path.join(MODELS_DIR, "metadata.json")
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2)
    print(f"\nMetadata saved to {meta_path}")

    print("\n" + "=" * 60)
    print("  Training complete!")
    print("=" * 60)
    for pos, info in metadata["positions"].items():
        print(f"  {pos}: AUC={info['play_auc']:.3f}, MAE={info['points_mae']:.1f}pts")
    print(f"\nModels saved to: {MODELS_DIR}")


if __name__ == "__main__":
    main()
