# Panay Energy Grid

An interactive dashboard for candidate Panay WESM bus prices, Visayas regional context, and the supplied ENGG 184 annual ILECO I demand study.

**Members:** Francesca Jeanne Revariz and Vivienne Marthine Manalo.

## Data and refresh

The source is [this public Google Sheet](https://docs.google.com/spreadsheets/d/19k2xYy2pafhwmhX6kRGb7DP-0098qlL-vcyviyLeOW8/edit). Preserve these tab names and column headers when appending observations:

- `08STBAR_SS1`, `08STBAR_SS2`, `08STBAR_SS3`, `08STBAR_T1L1`, `08STBAR_T2L2`, `08ILO_SS1`
- `Regional_Energy`

`sheet-config.json` owns the Sheet ID and tab names. The Python standard-library sync reads Google's public typed table endpoint; no Google password, API key or access token is stored. It does not collect new IEMOP files. Append or update the observations in Sheets to supply new market data.

The GitHub workflow at `.github/workflows/sync-sheets.yml` runs on pushes, on a manual **Run workflow**, and hourly at minute 17 UTC. GitHub schedules can be delayed. Each successful run validates every source tab and deploys a fresh static site. A failed sync prevents deployment and leaves the prior live site intact; check the Actions tab for failures. The browser checks the deployed data every five minutes. **Refresh data** checks the latest deployed snapshot; it does not trigger a new workflow run.

For local validation/build: `python sync_sheets.py`. Then serve `dist/` using `python -m http.server 8767 --directory dist`.

## Interpretation

Prices are historical RTD observations, not retail tariffs. The six codes are candidate buses; ILECO I settlement mapping remains unverified. Map pins mark approximate station areas. Regional quantities cover all Visayas.

Hourly/daily charts use arithmetic averages; missing observations are not filled. All interval ends use Philippine time; midnight belongs to the previous trading date. The calculator compares complete paired historical windows, preserves negative prices and estimates energy-only spot exposure. It does not predict future bills.

Annual ILECO I history (2000–2024), forecasts (2025–2034) and validation are fixed saved notebook outputs, not retrained by the market-data sync. Weather seasonality is illustrative. Forecasts fitted through 2024 remain projections even for elapsed years.

The Panay silhouette uses Natural Earth public-domain geometry. Other provenance is listed within **Sources & methods**.
