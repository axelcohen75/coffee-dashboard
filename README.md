# Coffee Market Monitor

Coffee Market Monitor is a dashboard for following coffee futures, spreads,
Brazil parity, weather, CFTC positioning, news, and options analytics.

The primary product surface is the **Streamlit dashboard** in `app.py` and
`pages/`. It provides the interactive analyst workflow with live API calls and
Streamlit multipage navigation.

A secondary static dashboard still lives in `docs/` for GitHub Pages. The
scheduled workflow runs `python scripts/fetch_market_data.py` and writes
`docs/data/market-data.json`, which is consumed by `docs/index.html`.

## Quick start

```bash
pip install -r requirements.txt
streamlit run app.py
```

To refresh the static dashboard data locally:

```bash
python scripts/fetch_market_data.py
```

To generate a manual weekly note:

```bash
python scripts/generate_weekly_market_note.py
```

Generated notes are written to `notes/YYYY-Www-market-note.md` and displayed on
the Streamlit positioning page.

## Repository map

- `app.py` - Streamlit overview page.
- `pages/` - Streamlit sub-pages for inventory, Brazil parity, differentials,
  weather, and positioning.
- `utils/` - shared fetchers and coffee-market calculations for Streamlit.
- `scripts/fetch_market_data.py` - ETL for the static dashboard JSON.
- `scripts/generate_weekly_market_note.py` - creates a weekly market-note draft.
- `docs/` - static dashboard assets:
  - `dashboard-config.js` - shared constants and formatting helpers.
  - `dashboard-app.js` - tab management and Plotly rendering.
  - `options-pricer.js` - Black-76 coffee options pricer.
- `data/` - committed data needed as runtime fallback or schema documentation.
