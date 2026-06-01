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
| `stocks_arabica_ice_certified_by_port.csv` | `scripts/fetch_market_data.py` -> `docs/data/market-data.json` -> Physical/Inventory tab | ICE certified Arabica Coffee C stocks by port, converted from the old ICE month-end XLS into a readable CSV. |
| `stocks_robusta_ice_certified_by_port.csv` | `scripts/fetch_market_data.py` -> `docs/data/market-data.json` -> Physical/Inventory tab | ICE Europe Robusta certified stocks by port and total tonnes. |

Do not commit broad raw CFTC yearly dumps; filter them into the canonical COT files above.

## Claude compatibility note

The former browser-side `arabica_cot.csv` fallback has been folded into the ETL:
`scripts/fetch_market_data.py` now reads `cot_arabica_disaggregated.csv` and
`cot_robusta_disaggregated.csv` directly, then writes both markets into
`docs/data/market-data.json`. This keeps the dashboard static while avoiding
duplicate CSV copies under `docs/data/`.
