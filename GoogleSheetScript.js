// ==========================================
// PIKACHU CONSOLIDATED SHEET (v4.0)
// ==========================================
/**
 * One row per team+puzzle. All events stored in a JSON array.
 * On GET, events are expanded so the dashboard aggregation still works.
 *
 * Level headers:
 *   TeamName | Level | Type | Language | PuzzleID | Events | LastUpdated
 *
 * Registration headers:
 *   Time | TeamName | Level | Type | Language | UnixTS | RawData
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

            var missionStr = data.mission || "";
            var language = data.language || "N/A";

            if (data.action === 'REGISTRATION') {
                handleRegistration(ss, data, serverTime, unixTs, missionStr, language);
                return ok("Registration");
            }

            var sheetName = "General_Logs";
            if (missionStr.indexOf('L1') === 0) sheetName = "Level_1";
            else if (missionStr.indexOf('L2') === 0) sheetName = "Level_2";
            else if (missionStr.indexOf('L3') === 0) sheetName = "Level_3";

            handleLevelEvent(ss, data, serverTime, unixTs, sheetName, missionStr, language);
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

// --- REGISTRATION: one row per team ---

function handleRegistration(ss, data, serverTime, unixTs, missionStr, language) {
    var parts = missionStr.split('_');
    var level = parts[0] || "N/A";
    var type = parts[1] || "N/A";

    var s = ensureSheet(ss, "Registration", REG_COLS, "#4361ee");
    var rows = s.getDataRange().getValues();
    var teamName = data.teamName || "Unknown";

    var rowIdx = -1;
    for (var i = 1; i < rows.length; i++) {
        if (rows[i][1] === teamName) {
            rowIdx = i + 1;
            break;
        }
    }

    var rowData = [serverTime, teamName, level, type, language, unixTs, JSON.stringify(data)];

    if (rowIdx > 0) {
        s.getRange(rowIdx, 1, 1, rowData.length).setValues([rowData]);
    } else {
        s.appendRow(rowData);
    }
}

// --- LEVEL: one row per team+puzzle, events stored in array ---

function handleLevelEvent(ss, data, serverTime, unixTs, sheetName, missionStr, language) {
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

    // Add server timestamp to the event
    data._serverTime = serverTime;
    data._unixTs = unixTs;

    if (rowIdx > 0) {
        // Append event to existing array
        var existingEvents = rows[rowIdx - 1][5] || "[]";
        var events;
        try {
            events = JSON.parse(existingEvents);
        } catch (e) {
            events = [];
        }
        events.push(data);

        s.getRange(rowIdx, 6, 1, 1).setValue(JSON.stringify(events));
        s.getRange(rowIdx, 7, 1, 1).setValue(serverTime);
    } else {
        // New row with first event
        var events = [data];
        var rowData = [teamName, level, type, language, puzzleId, JSON.stringify(events), serverTime];
        s.appendRow(rowData);
    }
}

// --- READ: expand events array into individual log objects ---

function readAll(ss) {
    var result = [];

    // Registration rows -> individual REGISTRATION logs
    var regSheet = ss.getSheetByName("Registration");
    if (regSheet) {
        var regRows = regSheet.getDataRange().getValues();
        for (var i = 1; i < regRows.length; i++) {
            try {
                var log = JSON.parse(regRows[i][6]);
                log.serverTimestamp = regRows[i][0];
                result.push(log);
            } catch (e) { }
        }
    }

    // Level sheets -> expand Events array into individual logs
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

var REG_COLS = ['Time', 'TeamName', 'Level', 'Type', 'Language', 'UnixTS', 'RawData'];
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
    var sheetNames = ["Registration", "Level_1", "Level_2", "Level_3", "General_Logs"];
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
        { name: "Registration", cols: REG_COLS, bg: "#4361ee" },
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
