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

## Interface and code

The application uses one navigation rail: **Market**, **Network**, and **Demand**, with **Methods** and **About** below. Market filters sit above the charts; on phones, **Filters & dates** opens the same controls. All quantities retain their original units, signed values, interval boundaries and missing observations.

- `index.html`: page structure and saved notebook results.
- `styles.css`: layout, typography, colors and responsive breakpoints.
- `interface.js`: navigation, filter presentation and pointer/keyboard chart inspection.
- `app.js`: existing market calculations, maps, notebook views, definitions, calculator and CSV exports.
- `hosted-source.js`: deployed snapshot loading, refresh and cached fallback.
- `sync_sheets.py`: public Sheets validation and static build, including all interface assets.

To change the appearance, edit `styles.css`; to change page structure or behavior, edit the relevant HTML/JavaScript file. Push to `main` to run the existing validation, Sheets sync and Pages deployment. No front-end build tool or package installation is required.

Serve the checked-in snapshot for interface work with `python -m http.server 8770`, then visit `http://localhost:8770/`. Avoid opening the HTML directly because the browser must fetch the market snapshot.

## Validation

Run `python -m unittest test_sync.py` and `node tests/test-analytics.cjs`. Syntax checks are `node --check app.js`, `node --check interface.js`, and `node --check hosted-source.js`.

The analytical regression suite covers Philippine-time interval boundaries, gaps/null values, signed schedules, price units, complete paired load-shift windows, negative prices, notebook outputs and both CSV export types. The interface refactor was also compared against the original code across 258 full-snapshot aggregations; results and the embedded notebook data matched. Browser checks cover navigation, all node/variable selectors, date presets, resolutions, map selection, chart readouts, definitions, calculator controls and exports at desktop, tablet and phone sizes.

Charts support pointer inspection, tap-to-pin, arrow keys, Home/End and Escape. Definitions open only on click or Enter/Space. Demand projections remain the saved notebook outputs; this interface change does not add or retrain forecasting models.
