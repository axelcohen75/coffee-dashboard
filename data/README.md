# Data directory

This folder contains only canonical local inputs used by the static dashboard
ETL. Raw downloads should be converted into these stable filenames before being
committed.

## CSV map

| File | Used by | Purpose |
| --- | --- | --- |
| `cot_arabica_disaggregated.csv` | `scripts/fetch_market_data.py` -> `docs/data/market-data.json` -> Positioning tab | Arabica CFTC disaggregated COT history with managed money, commercials, swaps, other reportables and open interest. |
| `cot_robusta_disaggregated.csv` | `scripts/fetch_market_data.py` -> `docs/data/market-data.json` -> Positioning tab | Canonical Robusta COT history. Built by filtering and merging raw yearly CFTC history exports for ICE Robusta Coffee Futures rows only. |
| `robusta_futures_price_history.csv` | `scripts/fetch_market_data.py` | Robusta futures price fallback when Yahoo Finance does not return `RC=F`. French Investing.com exports are supported. |

## Optional canonical files

The ETL will also load these files if added with the documented schema:

- `ice_arabica_stocks.csv` - columns: `Date,Total,<port columns...>`
- `ice_robusta_stocks.csv` - columns: `Date,Total`

Do not commit broad raw CFTC yearly dumps; filter them into the canonical COT files above.
