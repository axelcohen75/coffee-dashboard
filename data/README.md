# Data Directory

Place your data files here. The fetch script will auto-detect formats.

## Required files

### `rc_history.csv` — Robusta Coffee Futures (ICE London)
Download from Investing.com → [Robusta Coffee Futures Historical Data](https://www.investing.com/commodities/london-coffee-historical-data)
- Click "Download Data" (CSV)
- The French format (columns `Dernier`, dates `DD/MM/YYYY`, numbers like `3.476,00`) is auto-detected
- Or standard format with `Date,Close` columns

### `cepea_arabica.csv` (optional, V2)
Download xlsx from [CEPEA](https://cepea.esalq.usp.br/br/indicador/cafe-arabica.aspx)
- Convert to CSV with columns: `Date,Close` (R$/saca)

### `ico_prices.csv` (optional, V2)
Download from [ICO](https://ico.org/prices) → Daily Indicator Prices
- CSV with columns for Colombian Milds, Other Milds, Brazilian Naturals, Robustas
