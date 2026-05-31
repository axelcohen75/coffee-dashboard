# Data directory

Keep this folder limited to data files that are actually consumed by the app or
documented fallback paths. Timestamped raw downloads and one-off analysis files
should stay outside the repository unless they are wired into a loader.

## Active fallback data

### `ice_robusta_futures_history.csv` - Robusta Coffee Futures (ICE London)

Used by `utils/futures.py` and `scripts/fetch_market_data.py` when Yahoo Finance
does not return RC data.

Download from Investing.com: [Robusta Coffee Futures Historical Data](https://www.investing.com/commodities/london-coffee-historical-data)

- Click "Download Data" (CSV).
- French Investing.com exports are auto-detected (`Dernier`, `DD/MM/YYYY`, values
  such as `3.476,00`).
- Standard `Date,Close` CSVs are also supported.

## Optional canonical files

The static-data ETL will load these files if they are added with the documented
schema:

- `ice_arabica_stocks.csv` - columns: `Date,Total,<port columns...>`
- `ice_robusta_stocks.csv` - columns: `Date,Total`

These files are intentionally absent until a clean, repeatable source/export is
available.
