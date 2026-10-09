// Google Apps Script backend for the tennis results page.
// Bound to a Google Sheet: Extensions → Apps Script → paste this file.
// Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
var SHEET_NAME = 'Results';
var HEADER = ['timestamp', 'matchId', 'g1', 'g2', 'tb1', 'tb2'];
var MATCH_ID = /^[A-D][1-3]$/;

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADER);
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function intIn_(v, lo, hi) {
  var n = Number(v);
  return isFinite(n) && n % 1 === 0 && n >= lo && n <= hi ? n : null;
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = getSheet_();
    if (p.action === 'submit') {
      var g1 = intIn_(p.g1, 0, 4), g2 = intIn_(p.g2, 0, 4);
      if (!MATCH_ID.test(p.matchId || '') || g1 === null || g2 === null ||
          (g1 === 4 && g2 === 4)) {
        return json_({ ok: false, error: 'invalid input' });
      }
      var tb1 = p.tb1 === '' || p.tb1 == null ? '' : intIn_(p.tb1, 0, 99);
      var tb2 = p.tb2 === '' || p.tb2 == null ? '' : intIn_(p.tb2, 0, 99);
      if (tb1 === null || tb2 === null) return json_({ ok: false, error: 'invalid tiebreak' });
      sh.appendRow([new Date(), p.matchId, g1, g2, tb1, tb2]);
      return json_({ ok: true });
    }
    var values = sh.getDataRange().getValues();
    var rows = values.slice(1).map(function (r) {
      return { timestamp: r[0], matchId: r[1], g1: r[2], g2: r[3], tb1: r[4], tb2: r[5] };
    });
    return json_({ ok: true, rows: rows });
  } finally {
    lock.releaseLock();
  }
}
