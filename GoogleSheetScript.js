// ==========================================
// PIKACHU CONSOLIDATED SHEET (v4.1)
// ==========================================
/**
 * One row per team+puzzle. ALL events (including registration) go to the Level sheet.
 * No separate Registration sheet — keeps row count minimal.
 *
 * Level headers:
 *   TeamName | Level | Type | Language | PuzzleID | Events | LastUpdated
 */

function doGet(e) {
    return handleRequest(e);
}

function doPost(e) {
    return handleRequest(e);
}

function handleRequest(e) {
    var lock = LockService.getScriptLock();
    lock.tryLock(15000);

    try {
        var ss = SpreadsheetApp.getActiveSpreadsheet();

        if (e.postData) {
            var data = JSON.parse(e.postData.contents);
            var now = new Date();
            var serverTime = Utilities.formatDate(now, "GMT+5:30", "yyyy-MM-dd HH:mm:ss");
            var unixTs = Math.floor(now.getTime() / 1000);

            var teamName = data.teamName || "";
            if (!teamName || teamName === "Unknown") return ok("skipped");

            var action = data.action || "";
            if (action === "SESSION_START" || action === "PROMISE_REJECTION") return ok("skipped");

            var missionStr = data.mission || "";
            var language = data.language || "N/A";

            var sheetName = "General_Logs";
            if (missionStr.indexOf('L1') === 0) sheetName = "Level_1";
            else if (missionStr.indexOf('L2') === 0) sheetName = "Level_2";
            else if (missionStr.indexOf('L3') === 0) sheetName = "Level_3";

            handleEvent(ss, data, serverTime, unixTs, sheetName, missionStr, language);
            return ok(sheetName);
        }

        return ContentService.createTextOutput(JSON.stringify(readAll(ss)))
            .setMimeType(ContentService.MimeType.JSON);

    } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
            .setMimeType(ContentService.MimeType.JSON);
    } finally {
        lock.releaseLock();
    }
}

function ok(sheet) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'success', sheet: sheet }))
        .setMimeType(ContentService.MimeType.JSON);
}

// --- ALL events go to Level sheets, one row per team+puzzle ---

function handleEvent(ss, data, serverTime, unixTs, sheetName, missionStr, language) {
    var parts = missionStr.split('_');
    var level = parts[0] || "";
    var type = parts[1] || "";

    var s = ensureSheet(ss, sheetName, LEVEL_COLS, "#333333");

    var teamName = data.teamName || "Unknown";
    var puzzleId = data.puzzleId || 0;

    var rows = s.getDataRange().getValues();
    var rowIdx = -1;
    for (var i = 1; i < rows.length; i++) {
        if (rows[i][0] === teamName && rows[i][4] == puzzleId) {
            rowIdx = i + 1;
            break;
        }
    }

    data._serverTime = serverTime;
    data._unixTs = unixTs;

    if (rowIdx > 0) {
        var existingEvents = rows[rowIdx - 1][5] || "[]";
        var events;
        try { events = JSON.parse(existingEvents); } catch (e) { events = []; }
        events.push(data);

        s.getRange(rowIdx, 6, 1, 1).setValue(JSON.stringify(events));
        s.getRange(rowIdx, 7, 1, 1).setValue(serverTime);
    } else {
        var events = [data];
        var rowData = [teamName, level, type, language, puzzleId, JSON.stringify(events), serverTime];
        s.appendRow(rowData);
    }
}

// --- READ: expand events into individual log objects ---

function readAll(ss) {
    var result = [];
    var levelSheets = ["Level_1", "Level_2", "Level_3", "General_Logs"];

    for (var s = 0; s < levelSheets.length; s++) {
        var sheet = ss.getSheetByName(levelSheets[s]);
        if (!sheet) continue;
        var rows = sheet.getDataRange().getValues();
        for (var i = 1; i < rows.length; i++) {
            try {
                var events = JSON.parse(rows[i][5] || "[]");
                for (var j = 0; j < events.length; j++) {
                    result.push(events[j]);
                }
            } catch (e) { }
        }
    }

    result.sort(function (a, b) {
        return new Date((b.timestamp || b._serverTime || "").replace(/-/g, "/")) -
               new Date((a.timestamp || a._serverTime || "").replace(/-/g, "/"));
    });

    return result;
}

// --- HELPERS ---

var LEVEL_COLS = ['TeamName', 'Level', 'Type', 'Language', 'PuzzleID', 'Events', 'LastUpdated'];

function ensureSheet(ss, name, cols, bgColor) {
    var s = ss.getSheetByName(name);
    if (!s) {
        s = ss.insertSheet(name);
        s.appendRow(cols);
        s.getRange(1, 1, 1, cols.length).setFontWeight("bold").setBackground(bgColor).setFontColor("white");
        s.setFrozenRows(1);
    }
    return s;
}

function resetSheet() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetNames = ["Level_1", "Level_2", "Level_3", "General_Logs"];
    sheetNames.forEach(function (name) {
        var s = ss.getSheetByName(name);
        if (s && s.getLastRow() > 1) {
            s.deleteRows(2, s.getLastRow() - 1);
        }
    });
}

function setup() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheets = [
        { name: "Level_1", cols: LEVEL_COLS, bg: "#333333" },
        { name: "Level_2", cols: LEVEL_COLS, bg: "#333333" },
        { name: "Level_3", cols: LEVEL_COLS, bg: "#333333" }
    ];

    sheets.forEach(function (sh) {
        var s = ss.getSheetByName(sh.name);
        if (!s) s = ss.insertSheet(sh.name);
        s.clear();
        s.appendRow(sh.cols);
        s.getRange(1, 1, 1, sh.cols.length).setFontWeight("bold").setBackground(sh.bg).setFontColor("white");
        s.setFrozenRows(1);
    });
}
