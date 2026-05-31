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

## Positioning data

### `Arabica_COT.csv` - Arabica CFTC COT history

Used by the Streamlit Positioning page as the primary local source for trader
positioning. Expected columns follow the CFTC disaggregated report style,
including report date, open interest, long/short positions for managed money,
commercials, swap dealers and other reportables, plus net columns when
available.

### `Robusta_COT.csv` - Robusta COT history (optional)

If a Robusta COT file is added with the same schema, the Positioning page will
automatically expose it in the market selector.

