# Coffee Market Monitor

Coffee Market Monitor is a static dashboard for coffee traders and desk-prep. It
tracks ICE Arabica/Robusta futures, spreads, Brazil parity, weather, CFTC
positioning, news, inventory and options analytics.

The active product surface is the static dashboard in `docs/`, designed for
GitHub Pages. Data is generated into `docs/data/market-data.json` by the ETL
script and then rendered by vanilla JavaScript + Plotly.

## Quick start

```bash
pip install -r requirements.txt
python scripts/fetch_market_data.py
```

Then open `docs/index.html` locally or serve the `docs/` folder.

## Repository map

- `docs/index.html` - dashboard shell and tab layout.
- `docs/dashboard-config.js` - shared constants and formatting helpers.
- `docs/dashboard-app.js` - tab management and Plotly rendering.
- `docs/options-pricer.js` - Black-76 coffee options pricer.
- `docs/data/market-data.json` - generated runtime data consumed by the dashboard.
- `scripts/fetch_market_data.py` - ETL for market data and local CSV fallbacks.
- `data/` - canonical local data inputs documented in `data/README.md`.
- `utils/conversions.py` - shared coffee unit constants used by the ETL.

## Data refresh

The GitHub Action `.github/workflows/update-data.yml` refreshes
`docs/data/market-data.json` on weekdays. Run the same ETL locally when changing
CSV inputs or data transformations.
