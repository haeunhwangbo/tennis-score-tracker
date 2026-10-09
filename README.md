# Tennis scorekeeper + group results

Static page on GitHub Pages. `index.html` has the scorekeeper and the **결과표** (results) tab.

## Shared results setup (Google Sheets, ~5 min)

1. Create a new Google Sheet.
2. Extensions → Apps Script → replace the code with `apps-script/Code.gs`.
3. Deploy → New deployment → type **Web app** → Execute as **Me**, Who has access **Anyone** → Deploy (authorize when asked).
4. Copy the web app URL (ends in `/exec`) into `API_URL` at the top of `results.js`, commit and push.

Every submitted score is appended as a row in the `Results` sheet (latest row per match wins), so you can fix or audit scores in the sheet.
Until `API_URL` is set, results are saved only in the visitor's own browser.

## Editing players / schedule

Players and groups are the `GROUPS` array at the top of `results.js`.
