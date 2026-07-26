// ==========================================
// PIKACHU MULTI-SHEET ARCHITECTURE (v3.2)
// ==========================================
/**
 * Routing logic:
 * 1. REGISTRATION -> "Registration" (Fields: Time, Team, Level, Type, Language, UnixTS)
 * 2. Mission L1_* -> "Level_1"
 * 3. Mission L2_* -> "Level_2"
 * 4. Mission L3_* -> "Level_3"
 * 
 * Includes Language, Seconds in Display and Unix Timestamp for precision.
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
            var rawContent = e.postData.contents;
            var data = JSON.parse(rawContent);

            var now = new Date();
            var serverTime = Utilities.formatDate(now, "GMT+5:30", "yyyy-MM-dd HH:mm:ss");
            var unixTs = Math.floor(now.getTime() / 1000);

            var targetSheetName = "General_Logs";

            var missionStr = data.mission || "";
            var level = "N/A";
            var type = "N/A";

            if (missionStr.includes('_')) {
                var parts = missionStr.split('_');
                level = parts[0];
                type = parts[1];
            }

            var language = data.language || "N/A";

            if (data.action === 'REGISTRATION') {
                targetSheetName = "Registration";
                var regSheet = ss.getSheetByName(targetSheetName);
                if (!regSheet) {
                    regSheet = ss.insertSheet(targetSheetName);
                    regSheet.appendRow(['Time', 'Team Name', 'Level', 'Type', 'Language', 'UnixTS', 'Raw Data']);
                    regSheet.getRange(1, 1, 1, 7).setFontWeight("bold").setBackground("#4361ee").setFontColor("white");
                }
                regSheet.appendRow([serverTime, data.teamName, level, type, language, unixTs, JSON.stringify(data)]);
            } else {
                if (missionStr.indexOf('L1') === 0) targetSheetName = "Level_1";
                else if (missionStr.indexOf('L2') === 0) targetSheetName = "Level_2";
                else if (missionStr.indexOf('L3') === 0) targetSheetName = "Level_3";

                var sheet = ss.getSheetByName(targetSheetName);
                if (!sheet) {
                    sheet = ss.insertSheet(targetSheetName);
                    sheet.appendRow(['ServerTime', 'Action', 'TeamName', 'PuzzleID', 'Language', 'UnixTS', 'FullDataJSON']);
                    sheet.getRange(1, 1, 1, 7).setFontWeight("bold").setBackground("#333333").setFontColor("white");
                }
                sheet.appendRow([serverTime, data.action, data.teamName, data.puzzleId || '', language, unixTs, JSON.stringify(data)]);
            }

            return ContentService.createTextOutput(JSON.stringify({ status: 'success', sheet: targetSheetName }))
                .setMimeType(ContentService.MimeType.JSON);
        }

        else {
            var sheetNames = ["Registration", "Level_1", "Level_2", "Level_3", "General_Logs"];
            var consolidatedData = [];

            sheetNames.forEach(function (name) {
                var s = ss.getSheetByName(name);
                if (!s) return;
                var rows = s.getDataRange().getValues();
                if (rows.length <= 1) return;

                var startIdx = Math.max(1, rows.length - 200);
                for (var i = startIdx; i < rows.length; i++) {
                    try {
                        var log = JSON.parse(rows[i][rows[i].length - 1]);
                        log.serverTimestamp = rows[i][0];
                        consolidatedData.push(log);
                    } catch (err) { }
                }
            });

            consolidatedData.sort(function (a, b) {
                return new Date(b.serverTimestamp.replace(/-/g, "/")) - new Date(a.serverTimestamp.replace(/-/g, "/"));
            });

            return ContentService.createTextOutput(JSON.stringify(consolidatedData))
                .setMimeType(ContentService.MimeType.JSON);
        }

    } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
            .setMimeType(ContentService.MimeType.JSON);
    } finally {
        lock.releaseLock();
    }
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
        { name: "Registration", cols: ['Time', 'Team Name', 'Level', 'Type', 'Language', 'UnixTS', 'Raw Data'] },
        { name: "Level_1", cols: ['ServerTime', 'Action', 'TeamName', 'PuzzleID', 'Language', 'UnixTS', 'FullDataJSON'] },
        { name: "Level_2", cols: ['ServerTime', 'Action', 'TeamName', 'PuzzleID', 'Language', 'UnixTS', 'FullDataJSON'] },
        { name: "Level_3", cols: ['ServerTime', 'Action', 'TeamName', 'PuzzleID', 'Language', 'UnixTS', 'FullDataJSON'] },
        { name: "General_Logs", cols: ['ServerTime', 'Action', 'TeamName', 'PuzzleID', 'Language', 'UnixTS', 'FullDataJSON'] }
    ];

    sheets.forEach(function (sh) {
        var s = ss.getSheetByName(sh.name);
        if (!s) s = ss.insertSheet(sh.name);
        s.clear();
        s.appendRow(sh.cols);
        s.getRange(1, 1, 1, sh.cols.length).setFontWeight("bold").setBackground("#333333").setFontColor("white");
    });
}
