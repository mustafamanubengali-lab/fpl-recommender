# FPL Recommender

AI-powered Fantasy Premier League transfer recommendation engine. Analyzes your FPL team and suggests optimal transfers using XGBoost ML models trained on historical player data.

## How It Works

1. Enter your FPL Team ID
2. **Phase 1 (instant)**: Team overview, rank history, league standings
3. **Phase 2 (10-60s)**: Deep squad analysis with position-specific ML predictions, transfer recommendations cross-referenced with expert scout picks

## Tech Stack

- **Next.js 16** / **React 19** / **TypeScript** - Full-stack web app
- **Tailwind CSS 4** - Styling
- **XGBoost** - Position-specific ML models (play probability + expected points)
- **Python** (pandas, scikit-learn) - Model training pipeline

## Setup

### Prerequisites

- Node.js 18+
- Python 3.10+ (only for retraining models)

### Installation

```bash
npm install
```

No `.env` file needed - the app uses only public FPL APIs.

### Running

```bash
# Development
npm run dev

# Production
npm run build && npm start
```

The app runs at `http://localhost:3000`.

### Retraining Models (Optional)

```bash
cd scripts
pip install -r requirements.txt
python train.py
```

This trains XGBoost models on historical data and outputs JSON model files to `public/models/`.

## Features

### Team Analysis
- Manager info, overall rank, bank balance, team value
- Rank history chart across gameweeks
- Mini-league standings and percentile rankings

### Squad Deep Dive
- Per-player scoring using rolling per-90 stats (last 5 games)
- Position-specific weighting (npxG, xA, saves, xGC, defensive contribution, ICT)
- Fixture difficulty assessment
- Weakness identification (low form, injuries, tough fixtures, limited minutes)

### Transfer Recommendations
- Top 5 player-in/player-out pairs with net cost and reasoning
- Cross-referenced with AllAboutFPL scout picks
- Top 10 alternative targets outside recommendations

### ML Pipeline
- 4 position-specific model sets (GK, DEF, MID, FWD)
- Each position has a **play model** (will they get minutes?) and **points model** (expected points if they play)
- 20 features including rolling per-90 stats, form, fixture difficulty, penalty taker status
- Trained on 2022-23 and 2023-24 seasons, validated on 2024-25

## API Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/quick` | POST | Fast team overview + leagues |
| `/api/analyze` | POST | Full analysis + transfer recommendations |
| `/api/league-strategy` | POST | League-specific strategy |

## Architecture

```
User enters Team ID
    ├─ /api/quick (2-5s) → Team overview, rank chart, leagues
    └─ /api/analyze (10-60s, parallel)
        ├─ Fetch all player summaries from FPL API
        ├─ Compute rolling per-90 stats
        ├─ Run XGBoost predictions (play probability × expected points)
        ├─ Score players with position-specific weights
        ├─ Generate transfer recommendations within budget
        ├─ Cross-reference with expert scout picks
        └─ Return analysis + recommendations
```

## Deployment

Designed for **Vercel** (Next.js native hosting). FPL API responses are cached for 5 minutes to reduce load.
