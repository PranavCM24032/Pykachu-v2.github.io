// ==============================
// GAME CONFIGURATION
// ==============================
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyEKrFq9qEqzIajeF7TposZeLWwSArjPO64PbovYkzMxDkdqN2VHlsFE8azgnqCqAvb/exec';

const CONFIG = {
    HINT_SETTINGS: {
        defaultPenalty: 60,
        hintRequestTimeout: 30,
        tabSwitchResetsPenalty: true
    },
    FEATURES: {
        hintSystem: true
    },
    STORAGE_KEYS: {
        hintState: 'pykachuHintState',
        gameState: 'pykachuGameState',
        teamInfo: 'pykachuTeam'
    }
};

let PUZZLES = [];
let TEAMS = [];

// ==============================
// 0. ASSET PRELOADER (FOR SPEED)
// ==============================
const AssetPreloader = {
    cached: new Set(),
    preload(puzzles) {
        console.log("🚀 [Assets] Fast-tracking Pokemon & Badge sprites...");
        puzzles.forEach(p => {
            if (p.pokemonId) {
                const img = new Image();
                img.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${p.pokemonId}.png`;
                // Pre-cache cry URL hint
                fetch(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/cries/latest/${p.pokemonId}.ogg`, { mode: 'no-cors' }).catch(() => { });
            }
            if (p.id) {
                const img = new Image();
                img.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/badges/${p.id}.png`;
            }
        });
    }
};

async function loadPuzzles() {
    try {
        const response = await fetch('puzzle.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        PUZZLES = await response.json();
        console.log(`Loaded ${PUZZLES.length} puzzles from puzzle.json`);

        // Speed up UI by pre-caching all sprites
        AssetPreloader.preload(PUZZLES);

        // Validate puzzles have required fields
        PUZZLES.forEach((puzzle, index) => {
            if (!puzzle.id || (!puzzle.questionPython && !puzzle.questionCpp) || !puzzle.answers) {
                console.error(`Puzzle ${index + 1} is missing required fields`);
            }
        });

        return true;
    } catch (error) {
        console.error('FATAL: Could not load puzzle data:', error);
        showToast('Cannot load puzzle data. Please refresh or contact administrator.', 'error');
        return false;
    }
}
async function loadTeams() {
    try {
        const response = await fetch('teams.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        TEAMS = await response.json();
        console.log(`Loaded ${TEAMS.length} teams from teams.json`);
        console.log('Teams:', TEAMS); // Debug log to verify

        // Validate that we have teams
        if (TEAMS.length === 0) {
            throw new Error('No teams found in teams.json');
        }
        return true;
    } catch (error) {
        console.error('FATAL: Could not load team data:', error);
        showToast('Cannot load team data. Please refresh or contact administrator.', 'error');
        return false;
    }
}

// ==============================
// GAME STATE
// ==============================
let currentPuzzle = null;
let currentTeam = "";
let sessionId = "";
let urlLockedPuzzle = null;
let currentStep = 1;
let currentMissionLevel = "";
let currentLanguage = "PYTHON";
let isPuzzleActive = false;
let tabSwitchCount = 0;

// Tab switching penalty system
let penaltyActive = false;
let penaltyTimer = null;
let penaltySeconds = 15;
let gameStartTime = null;

// 2-second grace period system
let penaltyDelayTimeout = null;
let graceCountdownInterval = null;

// Puzzle Timer System
let puzzleTimerInterval = null;

// QR Scanner State
let qrScannerActive = false;
let videoStream = null;
let flashActive = false;
let qrScanInterval = null;

// Hint System State
let hintPenaltyActive = false;
let hintPenaltySeconds = 0;
let hintPenaltyTimer = null;
let hintRequestConfirmed = false;
let hintRequestTimeout = null;
let hintTabSwitchDuringPenalty = false;
let hintDisplayed = false;
let currentPuzzleHint = null;

// Grace period variables
let blurTimeout = null;

// ==============================
// SOUND SYSTEM
// ==============================
let audioContext = null;
let isMuted = false;
let soundEnabled = true;

function initAudio() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        console.log('Audio system initialized');
    } catch (e) {
        console.warn('Web Audio API not supported:', e);
        soundEnabled = false;
    }
}

// Upgraded playSound to handle synth notes OR external files (cries/music)
function playSound(soundName, volume = 0.3) {
    if (!soundEnabled || isMuted || !audioContext) return;

    // Handle External URL / Pokemon Cries
    if (soundName.startsWith('http') || soundName.endsWith('.mp3') || soundName.endsWith('.ogg')) {
        try {
            const audio = new Audio(soundName);
            audio.volume = volume;
            audio.play();
            return;
        } catch (e) {
            console.warn("External sound failed:", e);
            return;
        }
    }

    try {
        if (audioContext.state === 'suspended') audioContext.resume();

        const createOsc = (freq, type, startTime, duration, gain) => {
            const osc = audioContext.createOscillator();
            const g = audioContext.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, startTime);
            g.gain.setValueAtTime(gain, startTime);
            g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
            osc.connect(g);
            g.connect(audioContext.destination);
            osc.start(startTime);
            osc.stop(startTime + duration);
            return { osc, g };
        };

        const now = audioContext.currentTime;

        switch (soundName) {
            case 'click':
                createOsc(440, 'triangle', now, 0.1, 0.1);
                createOsc(880, 'sine', now, 0.05, 0.05);
                break;

            case 'success':
                createOsc(523.25, 'sine', now, 0.4, 0.1);
                createOsc(659.25, 'sine', now + 0.1, 0.4, 0.08);
                createOsc(783.99, 'sine', now + 0.2, 0.4, 0.05);
                createOsc(1046.50, 'sine', now + 0.3, 0.5, 0.1);
                break;

            case 'error':
                createOsc(110, 'square', now, 0.3, 0.15);
                createOsc(115, 'square', now, 0.3, 0.1);
                // Noise burst for error
                const noiseBuf = audioContext.createBuffer(1, audioContext.sampleRate * 0.2, audioContext.sampleRate);
                const noiseData = noiseBuf.getChannelData(0);
                for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;
                const noiseSrc = audioContext.createBufferSource();
                noiseSrc.buffer = noiseBuf;
                const noiseGain = audioContext.createGain();
                noiseGain.gain.setValueAtTime(0.05, now);
                noiseGain.gain.linearRampToValueAtTime(0, now + 0.2);
                noiseSrc.connect(noiseGain); noiseGain.connect(audioContext.destination);
                noiseSrc.start(now);
                break;

            case 'victory':
                [523.25, 659.25, 783.99, 1046.50, 1318.51].forEach((f, i) => {
                    createOsc(f, 'sine', now + (i * 0.1), 0.6, 0.15 - (i * 0.02));
                });
                break;

            case 'scanStart':
                for (let i = 0; i < 5; i++) {
                    const osc = audioContext.createOscillator();
                    const g = audioContext.createGain();
                    osc.frequency.setValueAtTime(200 + (i * 100), now + (i * 0.1));
                    osc.frequency.exponentialRampToValueAtTime(800 + (i * 100), now + (i * 0.1) + 0.2);
                    g.gain.setValueAtTime(0.05, now + (i * 0.1));
                    g.gain.linearRampToValueAtTime(0, now + (i * 0.1) + 0.2);
                    osc.connect(g); g.connect(audioContext.destination);
                    osc.start(now + (i * 0.1)); osc.stop(now + (i * 0.1) + 0.2);
                }
                break;

            case 'penaltyReset':
                createOsc(80, 'square', now, 0.4, 0.2);
                createOsc(60, 'square', now + 0.1, 0.5, 0.15);
                break;

            case 'hintStart':
                for (let i = 0; i < 8; i++) {
                    createOsc(1000 + (Math.random() * 500), 'sine', now + (i * 0.05), 0.1, 0.03);
                }
                break;

            case 'hintReveal':
                createOsc(880, 'sine', now, 0.2, 0.1);
                createOsc(1760, 'sine', now + 0.1, 0.3, 0.05);
                break;

            case 'submit':
                createOsc(300, 'triangle', now, 0.1, 0.2);
                break;

            case 'powerUp':
                const oscP = audioContext.createOscillator();
                const gP = audioContext.createGain();
                oscP.frequency.setValueAtTime(100, now);
                oscP.frequency.exponentialRampToValueAtTime(1200, now + 1.2);
                gP.gain.setValueAtTime(0, now);
                gP.gain.linearRampToValueAtTime(0.2, now + 0.3);
                gP.gain.linearRampToValueAtTime(0, now + 1.2);
                oscP.connect(gP); gP.connect(audioContext.destination);
                oscP.start(now); oscP.stop(now + 1.2);
                break;

            case 'victoryLong':
                const notes = [523.25, 523.25, 523.25, 523.25, 415.30, 466.16, 523.25, 466.16, 523.25];
                notes.forEach((f, i) => {
                    createOsc(f, 'square', now + (i * 0.15), 0.1, 0.1);
                });
                break;

            case 'hologram':
                createOsc(880, 'sine', now, 0.05, 0.3);
                createOsc(1760, 'sine', now + 0.05, 0.05, 0.2);
                const oscH = audioContext.createOscillator();
                const gH = audioContext.createGain();
                oscH.type = 'sawtooth';
                oscH.frequency.setValueAtTime(440, now);
                oscH.frequency.exponentialRampToValueAtTime(880, now + 0.5);
                gH.gain.setValueAtTime(0.1, now);
                gH.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
                oscH.connect(gH); gH.connect(audioContext.destination);
                oscH.start(now); oscH.stop(now + 0.5);
                break;
        }

        // Add Haptic Feedback
        if ('vibrate' in navigator) {
            if (['success', 'victory', 'powerUp'].includes(soundName)) navigator.vibrate(50);
            if (soundName === 'error') navigator.vibrate([50, 50, 50]);
        }
    } catch (e) {
        console.warn('Sound error:', e);
    }
}

// ==============================
// GAME FLOW FUNCTIONS
// ==============================
function showStep(stepNumber) {
    console.log('Showing step:', stepNumber);

    const steps = document.querySelectorAll('.flow-step');
    const targetStep = document.getElementById(`step${stepNumber}`);

    if (!targetStep) return;

    // Smooth Transition
    steps.forEach(step => {
        if (step.classList.contains('active')) {
            step.style.opacity = '0';
            step.style.transform = 'translateY(-10px)';
            step.style.transition = 'all 0.3s ease';
            setTimeout(() => step.classList.remove('active'), 300);
        }
    });

    setTimeout(() => {
        targetStep.classList.add('active');
        targetStep.style.opacity = '0';
        targetStep.style.transform = 'translateY(10px)';
        targetStep.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';

        // Trigger reflow
        targetStep.offsetHeight;

        targetStep.style.opacity = '1';
        targetStep.style.transform = 'translateY(0)';
    }, 310);

    currentStep = stepNumber;

    // Update team name display across steps
    const teamDisplays = ['teamNameDisplay', 'step4TeamName'];
    teamDisplays.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = currentTeam || 'NO TEAM';
    });

    if (stepNumber === 3) {
        const badgeContainer = document.getElementById('step3BadgeContainer');
        const badgeImg = document.getElementById('gymBadgeImg');
        const nextPuzzleIdDisplay = document.getElementById('nextPuzzleIdDisplay');
        const unlockCodeInput = document.getElementById('unlockCode');

        if (urlLockedPuzzle) {
            // Gym Badge Integration: Fetch from PokeAPI sprites via GitHub
            // Note: github.com blob URLs don't work in <img> src, so we use raw.githubusercontent.com
            const badgeId = urlLockedPuzzle.id;
            const badgeUrl = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/badges/${badgeId}.png`;

            if (badgeImg) {
                badgeImg.src = badgeUrl;
                if (badgeContainer) {
                    badgeContainer.classList.remove('hidden');
                }
            }
            if (nextPuzzleIdDisplay) {
                nextPuzzleIdDisplay.textContent = '';
            }
        } else {
            if (badgeContainer) badgeContainer.classList.add('hidden');
        }

        if (unlockCodeInput) {
            unlockCodeInput.value = '';
            setTimeout(() => {
                unlockCodeInput.focus();
            }, 600);
        }
    }

    if (stepNumber === 4) {
        isPuzzleActive = true;
        startTabMonitoring();

        // Add mild green glow effect to code container (similar to location clue but green)
        const codeTerminal = document.querySelector('.code-terminal');
        if (codeTerminal) {
            codeTerminal.style.boxShadow =
                '0 0 10px rgba(0, 245, 160, 0.2), ' +
                '0 0 20px rgba(0, 245, 160, 0.1), ' +
                '0 0 30px rgba(0, 245, 160, 0.05)';
            codeTerminal.style.borderColor = 'rgba(0, 245, 160, 0.4)';
            codeTerminal.style.transition = 'box-shadow 0.5s ease, border-color 0.5s ease';
        }

        // Update language badge
        const langBadge = document.getElementById('langBadge');
        if (langBadge) {
            langBadge.textContent = currentLanguage === 'CPP' ? 'C++' : 'PYTHON';
        }

        // Focus on answer input
        setTimeout(() => {
            const answerInput = document.getElementById('puzzleAnswer');
            if (answerInput) {
                answerInput.focus();
                answerInput.value = ''; // Clear previous answer
            }
        }, 100);

        // Setup hint system
        setTimeout(() => {
            setupHintSystem();
        }, 100);

        // Start Timer
        if (!gameStartTime) {
            gameStartTime = new Date();
        }
        startPuzzleTimer();

        // Ensure puzzle is displayed
        if (currentPuzzle) {
            const puzzleQuestion = document.getElementById('puzzleQuestion');
            if (puzzleQuestion) {
                puzzleQuestion.textContent = getPuzzleQuestion(currentPuzzle);
            }

            // Show CSS Pokeball
            const pokeball = document.getElementById('step4Pokeball');
            if (pokeball) {
                pokeball.classList.remove('hidden');
            }
        }
    } else {
        isPuzzleActive = false;
        stopTabMonitoring();

        // Remove green glow effect
        const codeTerminal = document.querySelector('.code-terminal');
        if (codeTerminal) {
            codeTerminal.style.boxShadow = '';
            codeTerminal.style.borderColor = '';
            codeTerminal.style.transition = '';
        }

        // Stop Timer
        if (puzzleTimerInterval) {
            clearInterval(puzzleTimerInterval);
            puzzleTimerInterval = null;
        }

        // Clean up hint system
        if (hintPenaltyActive) {
            cleanupHintSystem();
        }
    }

    saveGameState();
}

function updateTeamStatus() {
    const teamDisplays = ['teamNameInput', 'teamNameDisplay', 'step4TeamName'];
    const hasTeam = currentTeam && currentTeam.trim() !== "";
    const displayName = hasTeam ?
        (currentTeam.length > 20 ? currentTeam.substring(0, 20) + '...' : currentTeam) :
        'NO TEAM';

    teamDisplays.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = displayName;
        }
    });

    // Update LVL and TYPE indicators
    const lvlEl = document.getElementById('teamLevelDisplay');
    const typeEl = document.getElementById('teamTypeDisplay');

    // Status Item Wrappers
    const lvlWrapper = document.getElementById('statusLvl');
    const teamWrapper = document.getElementById('statusTeam');
    const typeWrapper = document.getElementById('statusType');

    if (hasTeam && currentMissionLevel) {
        // Parse missionLevel like "L1_GRASS"
        const parts = currentMissionLevel.split('_');
        const lvl = (parts[0] || "L1").replace('L', '').padStart(2, '0');
        const type = parts[1] || "NORMAL";

        if (lvlEl) lvlEl.textContent = lvl;
        if (typeEl) typeEl.textContent = type;

        // Transition to Green (Filled)
        [lvlWrapper, teamWrapper, typeWrapper].forEach(w => {
            if (w) {
                w.classList.remove('is-empty');
                w.classList.add('is-filled');
            }
        });

        // Update Team Icon to active version
        const teamIcon = teamWrapper?.querySelector('.material-symbols-rounded');
        if (teamIcon) teamIcon.textContent = 'verified_user';
    } else {
        if (lvlEl) lvlEl.textContent = "00";
        if (typeEl) typeEl.textContent = "SYSTEM";

        // Revert to Red (Empty)
        [lvlWrapper, teamWrapper, typeWrapper].forEach(w => {
            if (w) {
                w.classList.remove('is-filled');
                w.classList.add('is-empty');
            }
        });

        // Reset Team Icon
        const teamIcon = teamWrapper?.querySelector('.material-symbols-rounded');
        if (teamIcon) teamIcon.textContent = 'shield_person';
    }
}

// ==============================
// 1. PERFORMANCE & SCHEDULING SYSTEM
// ==============================
const Scheduler = {
    timers: new Map(),

    // Smooth Timer using requestAnimationFrame
    startSmoothTimer(id, callback) {
        if (this.timers.has(id)) this.stopTimer(id);
        let lastTime = performance.now();
        const loop = (currentTime) => {
            if (currentTime - lastTime >= 1000) {
                callback();
                lastTime = currentTime;
            }
            this.timers.set(id, requestAnimationFrame(loop));
        };
        this.timers.set(id, requestAnimationFrame(loop));
    },

    stopTimer(id) {
        if (this.timers.has(id)) {
            cancelAnimationFrame(this.timers.get(id));
            this.timers.delete(id);
        }
    }
};

function startPuzzleTimer() {
    Scheduler.startSmoothTimer('puzzleTimer', updatePuzzleTimer);
}

function updatePuzzleTimer() {
    const timerElement = document.getElementById('puzzleTimer');
    if (!timerElement || !gameStartTime) return;

    const diff = Math.floor((new Date() - gameStartTime) / 1000);
    const mins = Math.floor(diff / 60).toString().padStart(2, '0');
    const secs = (diff % 60).toString().padStart(2, '0');
    timerElement.textContent = `${mins}:${secs}`;
}

// ==============================
// 2. CONSOLIDATED SECURITY & PENALTY
// ==============================
function startTabMonitoring() {
    console.log('[Security] Monitoring active');
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
}

function stopTabMonitoring() {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('blur', handleWindowBlur);
    window.removeEventListener('focus', handleWindowFocus);
    if (blurTimeout) clearTimeout(blurTimeout);
    cancelGracePeriodUI();
}

function handleVisibilityChange() {
    if (document.hidden && isPuzzleActive && currentStep === 4) {
        triggerPenalty();
    }
}

function handleWindowBlur() {
    if (!isPuzzleActive || currentStep !== 4) return;
    if (blurTimeout) clearTimeout(blurTimeout);
    blurTimeout = setTimeout(() => {
        if (!document.hasFocus()) triggerPenalty();
    }, 1500);
}

function handleWindowFocus() {
    if (blurTimeout) {
        clearTimeout(blurTimeout);
        blurTimeout = null;
    }
}

function triggerPenalty() {
    if (!isPuzzleActive || currentStep !== 4) return;

    if (penaltyActive) {
        penaltySeconds = 15;
        const timerElement = document.getElementById('penaltyTimer');
        if (timerElement) {
            timerElement.textContent = penaltySeconds;
            timerElement.parentElement?.classList.add('animate-shake');
            setTimeout(() => timerElement.parentElement?.classList.remove('animate-shake'), 400);
        }
        resetTimerRing();
        playSound('penaltyReset');
        return;
    }

    penaltyActive = true;
    tabSwitchCount++;
    playSound('error');

    const overlay = document.getElementById('penaltyOverlay');
    if (overlay) overlay.classList.remove('hidden');

    penaltySeconds = 15;
    const timerElement = document.getElementById('penaltyTimer');
    if (timerElement) timerElement.textContent = penaltySeconds;

    resetTimerRing();

    submitToGoogleSheets('PENALTY_TRIGGERED', {
        puzzleId: currentPuzzle?.id || 0,
        tabSwitches: tabSwitchCount
    });

    if (penaltyTimer) clearInterval(penaltyTimer);
    penaltyTimer = setInterval(() => {
        penaltySeconds--;
        if (timerElement) timerElement.textContent = Math.max(0, penaltySeconds);
        if (penaltySeconds <= 0) clearPenalty();
    }, 1000);
}

function resetTimerRing() {
    const timerRing = document.querySelector('.penalty-timer-ring');
    if (timerRing) {
        timerRing.style.animation = 'none';
        void timerRing.offsetWidth; // Trigger reflow
        timerRing.style.animation = `countdown 15s linear forwards`;
    }
}

function showGracePeriodUI() {
    // Legacy support or placeholder for future grace systems
}

function cancelGracePeriodUI() {
    const graceOverlay = document.getElementById('gracePeriodOverlay');
    if (graceOverlay) graceOverlay.remove();
    if (graceCountdownInterval) {
        clearInterval(graceCountdownInterval);
        graceCountdownInterval = null;
    }
}


function clearPenalty() {
    console.log('Clearing penalty');
    if (penaltyTimer) {
        clearInterval(penaltyTimer);
        penaltyTimer = null;
    }

    // Clear any pending grace period timeouts
    if (penaltyDelayTimeout) {
        clearTimeout(penaltyDelayTimeout);
        penaltyDelayTimeout = null;
    }

    // Clear grace period UI
    cancelGracePeriodUI();

    penaltyActive = false;
    const overlay = document.getElementById('penaltyOverlay');
    if (overlay) overlay.classList.add('hidden');

    playSound('success');
}

// ==============================
// HINT SYSTEM FUNCTIONS
// ==============================
function setupHintSystem() {
    console.log('Setting up hint system...');
    if (!currentPuzzle || !CONFIG.FEATURES.hintSystem) return;

    const hintContainer = document.getElementById('hintContainer');
    const hintRequestBtn = document.getElementById('hintRequestBtn');

    // Attempt to match hint button anywhere in step container if ID is duplicate
    const activeHintBtn = hintRequestBtn || document.querySelector(`#step${currentStep} #hintRequestBtn`);

    if (!hintContainer) return;

    currentPuzzleHint = currentPuzzle.hint;

    // VALIDATION: Handle boolean false specifically
    let isValidHint = false;

    if (typeof currentPuzzleHint === 'boolean') {
        isValidHint = currentPuzzleHint === true; // If strictly true, valid. If false, invalid.
    } else if (typeof currentPuzzleHint === 'string') {
        const lowerHint = currentPuzzleHint.toLowerCase().trim();
        isValidHint = lowerHint !== "none" && lowerHint !== "false" && lowerHint !== "" && lowerHint !== "null";
    }

    // FINAL PROTECTION: If hint is explicitly null or undefined in JSON
    if (currentPuzzleHint === null || currentPuzzleHint === undefined) {
        isValidHint = false;
    }

    if (isValidHint) {
        console.log('Hint detected. Activating UI.');
        hintContainer.classList.remove('hidden');

        // Reset UI Components
        document.getElementById('hintDisplay').classList.add('hidden');
        if (document.getElementById('hintRequestOverlay'))
            document.getElementById('hintRequestOverlay').classList.add('hidden');
        if (document.getElementById('hintPenaltyOverlay'))
            document.getElementById('hintPenaltyOverlay').classList.add('hidden');

        // Show Request Button
        if (activeHintBtn) {
            activeHintBtn.classList.remove('hidden');
            activeHintBtn.style.display = ''; // Clear inline styles
        } else if (hintRequestBtn) {
            hintRequestBtn.classList.remove('hidden');
        }

        // Setup Penalty Display
        const penaltyTime = currentPuzzle.hintPenalty || 60;
        const penaltyTimeEl = document.getElementById('hintPenaltyTime');
        if (penaltyTimeEl) penaltyTimeEl.textContent = `${penaltyTime}`;

        // Load State (Check if already unlocked)
        loadHintState();
    } else {
        console.log('No valid hint available (false/none). Hiding UI.');
        hintContainer.classList.add('hidden');
        if (activeHintBtn) activeHintBtn.classList.add('hidden');
        else if (hintRequestBtn) hintRequestBtn.classList.add('hidden');
    }
}

function loadHintState() {
    const hintState = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.hintState) || '{}');
    const teamKey = `${currentTeam}_${currentPuzzle?.id}`;

    if (currentPuzzle && currentTeam && hintState[teamKey]) {
        currentPuzzle.hintUsed = hintState[teamKey].used || false;
        // Do not auto-show hint on load, user must request it again (no penalty will be charged)
    } else {
        // Reset hint used status for new team
        currentPuzzle.hintUsed = false;
        hintDisplayed = false;
    }
}

function saveHintState() {
    const hintState = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.hintState) || '{}');
    if (currentPuzzle && currentTeam) {
        const teamKey = `${currentTeam}_${currentPuzzle.id}`;
        hintState[teamKey] = {
            used: currentPuzzle.hintUsed || false,
            usedAt: new Date().toISOString(),
            team: currentTeam,
            puzzleId: currentPuzzle.id
        };
        localStorage.setItem(CONFIG.STORAGE_KEYS.hintState, JSON.stringify(hintState));
    }
}

function requestHint() {
    console.log('Hint requested.');
    if (!currentPuzzle) return;

    // Always require confirmation and timer for every request
    const overlay = document.getElementById('hintRequestOverlay');
    const container = document.getElementById('hintContainer');
    if (container) container.classList.remove('hidden'); // Ensure visible
    if (overlay) overlay.classList.remove('hidden');

    // Auto-cancel if ignored
    if (hintRequestTimeout) clearTimeout(hintRequestTimeout);
    hintRequestTimeout = setTimeout(() => {
        cancelHintRequest();
        showToast('Hint request timed out', 'error');
    }, 30000); // 30s timeout
}

function confirmHintRequest() {
    clearTimeout(hintRequestTimeout);

    // Hide confirmation overlay
    document.getElementById('hintRequestOverlay').classList.add('hidden');

    // Start hint penalty
    startHintPenalty();
}

function cancelHintRequest() {
    clearTimeout(hintRequestTimeout);
    document.getElementById('hintRequestOverlay').classList.add('hidden');
    playSound('error');
}

function startHintPenalty() {
    if (hintPenaltyActive) return;

    hintPenaltyActive = true;
    hintTabSwitchDuringPenalty = false;

    // Visibility Check
    const hintContainer = document.getElementById('hintContainer');
    if (hintContainer) hintContainer.classList.remove('hidden');

    // Initialize Timer
    hintPenaltySeconds = (currentPuzzle.hintPenalty && currentPuzzle.hintPenalty > 0) ? currentPuzzle.hintPenalty : 60;

    // Show Overlay
    const penaltyOverlay = document.getElementById('hintPenaltyOverlay');
    const timerDisplay = document.getElementById('hintTimerDisplay');
    const timerRing = document.querySelector('.hint-penalty-timer-ring');
    const warningMsg = document.getElementById('hintWarningMessage');

    if (penaltyOverlay) penaltyOverlay.classList.remove('hidden');
    if (timerDisplay) timerDisplay.textContent = hintPenaltySeconds;
    if (warningMsg) warningMsg.classList.add('hidden');

    // Reset Ring Animation
    if (timerRing) {
        timerRing.style.animation = 'none';
        void timerRing.offsetWidth;
        timerRing.style.animation = `hint-countdown ${hintPenaltySeconds}s linear forwards`;
    }

    // Start Ticking
    if (hintPenaltyTimer) clearInterval(hintPenaltyTimer);
    hintPenaltyTimer = setInterval(updateHintPenaltyTimer, 1000);

    // Start Monitoring
    startHintTabMonitoring();

    submitToGoogleSheets('HINT_REQUESTED', {
        puzzleId: currentPuzzle.id,
        penaltyTime: hintPenaltySeconds
    });

    playSound('hintStart');
}

function updateHintPenaltyTimer() {
    if (!hintPenaltyActive) return;

    hintPenaltySeconds--;

    // Update display
    const timerDisplay = document.getElementById('hintTimerDisplay');
    if (timerDisplay) {
        timerDisplay.textContent = hintPenaltySeconds;
    }

    if (hintPenaltySeconds <= 0) {
        completeHintPenalty();
    }
}

function completeHintPenalty() {
    clearInterval(hintPenaltyTimer);
    hintPenaltyTimer = null;
    hintPenaltyActive = false;

    // Hide penalty overlay
    document.getElementById('hintPenaltyOverlay').classList.add('hidden');

    // Stop tab monitoring
    stopHintTabMonitoring();

    // Show the hint
    showHint();

    // Log hint usage
    submitToGoogleSheets('HINT_USED', {
        puzzleId: currentPuzzle.id,
        hintText: currentPuzzleHint,
        penaltyServed: true,
        tabSwitchesDuringPenalty: hintTabSwitchDuringPenalty
    });

    playSound('hintReveal');
    showToast('Hint unlocked!', 'success');
}

// ==============================
// VISIBILITY MONITORING for HINT
// ==============================
function startHintTabMonitoring() {
    document.addEventListener('visibilitychange', handleHintVisibilityChange);
    window.addEventListener('blur', handleHintWindowBlur);
}

function stopHintTabMonitoring() {
    document.removeEventListener('visibilitychange', handleHintVisibilityChange);
    window.removeEventListener('blur', handleHintWindowBlur);
}

function handleHintVisibilityChange() {
    if (document.hidden && hintPenaltyActive) {
        resetHintPenaltyTimer();
    }
}

function handleHintWindowBlur() {
    if (hintPenaltyActive) {
        // Immediate check or small delay
        setTimeout(() => {
            if (document.hidden || !document.hasFocus()) {
                resetHintPenaltyTimer();
            }
        }, 100);
    }
}

function resetHintPenaltyTimer() {
    if (!hintPenaltyActive) return;

    hintTabSwitchDuringPenalty = true;

    // RESET TIMER to full duration
    hintPenaltySeconds = (currentPuzzle.hintPenalty && currentPuzzle.hintPenalty > 0) ? currentPuzzle.hintPenalty : 60;

    const timerDisplay = document.getElementById('hintTimerDisplay');
    if (timerDisplay) timerDisplay.textContent = hintPenaltySeconds;

    // Show warning message
    const warningMessage = document.getElementById('hintWarningMessage');
    const warningText = document.getElementById('tabSwitchWarning');
    if (warningMessage && warningText) {
        warningText.textContent = 'Tab switch detected! Timer reset.';
        warningMessage.classList.remove('hidden');
    }

    // Reset animation
    const timerRing = document.querySelector('.hint-penalty-timer-ring');
    if (timerRing) {
        timerRing.style.animation = 'none';
        void timerRing.offsetHeight; // Force reflow
        timerRing.style.animation = `hint-countdown ${hintPenaltySeconds}s linear forwards`;
    }

    playSound('penaltyReset');
    console.log('Hint timer reset due to tab switch');
}

function showHint() {
    if (!currentPuzzleHint) return;

    const hintContainer = document.getElementById('hintContainer'); // Ensure parent is visible
    const hintDisplay = document.getElementById('hintDisplay');
    const hintText = document.getElementById('hintText');
    const hintRequestBtn = document.getElementById('hintRequestBtn');

    if (hintContainer) hintContainer.classList.remove('hidden'); // Force visibility

    if (hintDisplay && hintText) {
        hintText.textContent = currentPuzzleHint;
        hintDisplay.classList.remove('hidden');

        // Hide the hint request button
        if (hintRequestBtn) {
            hintRequestBtn.classList.add('hidden');
        }
    }

    hintDisplayed = true;

    // Mark hint as used for this team
    if (currentPuzzle) {
        currentPuzzle.hintUsed = true;
        saveHintState();
    }
}

function closeHintPopup() {
    document.getElementById('hintDisplay').classList.add('hidden');

    // RE-VALIDATE before showing button again
    let isValidHint = false;
    if (currentPuzzle && currentPuzzle.hint) {
        if (typeof currentPuzzle.hint === 'boolean') {
            isValidHint = currentPuzzle.hint === true;
        } else {
            const lower = currentPuzzle.hint.toLowerCase().trim();
            isValidHint = lower !== "none" && lower !== "false" && lower !== "";
        }
    }

    if (isValidHint) {
        const hintRequestBtn = document.getElementById('hintRequestBtn');
        const activeHintBtn = hintRequestBtn || document.querySelector(`#step${currentStep} #hintRequestBtn`);
        if (activeHintBtn) activeHintBtn.classList.remove('hidden');
        else if (hintRequestBtn) hintRequestBtn.classList.remove('hidden');
    }

    hintDisplayed = false;
    // We do NOT reset 'currentPuzzle.hintUsed' here because that tracks SCORING (if they used it at least once).
    // Access is now controlled solely by the button click flow which forces the timer every time.
}

function cleanupHintSystem() {
    if (hintPenaltyTimer) {
        clearInterval(hintPenaltyTimer);
        hintPenaltyTimer = null;
    }

    if (hintRequestTimeout) {
        clearTimeout(hintRequestTimeout);
        hintRequestTimeout = null;
    }

    stopHintTabMonitoring();
    hintPenaltyActive = false;
    hintRequestConfirmed = false;
}

function resetHintForNewTeam() {
    hintDisplayed = false;
    hintPenaltyActive = false;
    hintRequestConfirmed = false;
    hintTabSwitchDuringPenalty = false;

    if (currentPuzzle) {
        currentPuzzle.hintUsed = false;
    }

    // Reset UI elements
    const hintDisplay = document.getElementById('hintDisplay');
    const hintRequestBtn = document.getElementById('hintRequestBtn');
    const hintRequestOverlay = document.getElementById('hintRequestOverlay');
    const hintPenaltyOverlay = document.getElementById('hintPenaltyOverlay');

    if (hintDisplay) hintDisplay.classList.add('hidden');
    if (hintRequestBtn) hintRequestBtn.classList.remove('hidden');
    if (hintRequestOverlay) hintRequestOverlay.classList.add('hidden');
    if (hintPenaltyOverlay) hintPenaltyOverlay.classList.add('hidden');
}

// ==============================
// SAVE & LOAD GAME STATE
// ==============================
function saveGameState() {
    const gameState = {
        currentTeam,
        currentStep,
        currentPuzzleId: currentPuzzle?.id,
        tabSwitchCount,
        urlLockedPuzzleId: urlLockedPuzzle?.id,
        sessionId,
        currentLanguage
    };
    localStorage.setItem(CONFIG.STORAGE_KEYS.gameState, JSON.stringify(gameState));
}

// ==============================
// GOOGLE SHEETS INTEGRATION
// ==============================
let submissionQueue = [];
let isSubmitting = false;

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

async function submitToGoogleSheets(action, data = {}) {
    try {
        const payload = {
            action: action,
            sessionId: sessionId,
            teamName: currentTeam || 'Unknown',
            mission: typeof currentMissionLevel !== 'undefined' ? currentMissionLevel : '',
            language: currentLanguage || 'PYTHON',
            puzzleId: currentPuzzle?.id || 0,
            timestamp: new Date().toISOString(),
            ...data
        };

        // Add hint-specific data detail
        if (action.includes('HINT')) {
            payload.hintType = 'DECRYPTION_BASED';
            payload.hintPenaltyTime = currentPuzzle?.hintPenalty || 60;
            payload.hintDisplayed = typeof hintDisplayed !== 'undefined' ? hintDisplayed : false;
        }

        // Add to queue with retry count
        submissionQueue.push({ payload, retries: 0 });

        processSubmissionQueue();

    } catch (error) {
        console.error('CRITICAL: Error queuing submission:', error);
    }
}

async function processSubmissionQueue() {
    if (isSubmitting || submissionQueue.length === 0) return;

    isSubmitting = true;

    try {
        while (submissionQueue.length > 0) {
            // Peek at the first item
            const currentItem = submissionQueue[0];

            // Check for valid URL before attempting
            if (!GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL.includes("SCRIPT_URL_HERE")) {
                console.warn("Google Script URL is missing or invalid. Data cannot be synced.");
                // Remove to prevent infinite loop
                submissionQueue.shift();
                continue;
            }

            try {
                // Attempt to send
                await fetch(GOOGLE_SCRIPT_URL, {
                    method: 'POST',
                    mode: 'no-cors', // standard for Google Sheets Logging
                    cache: 'no-cache',
                    keepalive: true, // Crucial for data on unload
                    headers: {
                        'Content-Type': 'text/plain;charset=utf-8', // GAS prefers text/plain for no-cors
                    },
                    body: JSON.stringify(currentItem.payload)
                });

                // Assume success if no network error (no-cors is opaque)
                console.log(`[Sync] Data submitted: ${currentItem.payload.action}`);
                submissionQueue.shift(); // Remove on success

            } catch (networkError) {
                console.error('[Sync] Network error:', networkError);

                currentItem.retries++;
                if (currentItem.retries >= MAX_RETRIES) {
                    console.error(`[Sync] Max retries reached for ${currentItem.payload.action}. Dropping.`);
                    submissionQueue.shift(); // Give up
                } else {
                    console.log(`[Sync] Retrying... (${currentItem.retries}/${MAX_RETRIES})`);
                    // Wait before retry
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * currentItem.retries));
                    break; // Break the while loop to retry in next cycle or after delay
                }
            }

            // Small buffer between requests
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    } catch (uncaughtError) {
        console.error('[Sync] Queue processing error:', uncaughtError);
    } finally {
        isSubmitting = false;
        // If queue not empty (e.g. paused due to error), try again slowly
        if (submissionQueue.length > 0) {
            setTimeout(processSubmissionQueue, 2000);
        }
    }
}

function generateSessionId() {
    return 'SESSION_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function standardizeString(str) {
    return (str || '').toString().replace(/\s+/g, '').toUpperCase();
}

function getPuzzleQuestion(puzzle) {
    if (!puzzle) return '';
    if (currentLanguage === 'CPP') return puzzle.questionCpp || puzzle.questionPython || '';
    return puzzle.questionPython || puzzle.questionCpp || '';
}

// ==============================
// STEP 1: REGISTRATION
// ==============================
document.getElementById('registrationForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const teamInput = document.getElementById('teamName').value.trim();
    const passwordInput = document.getElementById('teamPassword').value.trim();
    const missionLevel = document.getElementById('missionLevel').value;
    const codeLanguage = document.getElementById('codeLanguage').value;

    if (!teamInput || !passwordInput) {
        showFeedback('registrationFeedback', 'Team name and password are required!', 'error');
        return;
    }

    // Verify team and password
    const foundTeam = TEAMS.find(t => t.team.toLowerCase() === teamInput.toLowerCase());

    if (!foundTeam) {
        showFeedback('registrationFeedback', 'Trainer not found in database!', 'error');
        triggerShake('teamName');
        playSound('error');
        return;
    }

    if (foundTeam.password !== passwordInput) {
        showFeedback('registrationFeedback', 'Incorrect security key!', 'error');
        triggerShake('teamPassword');
        playSound('error');
        return;
    }

    currentTeam = foundTeam.team;
    currentMissionLevel = missionLevel;
    currentLanguage = codeLanguage;
    resetHintForNewTeam();
    gameStartTime = new Date();

    if (!sessionId) {
        sessionId = generateSessionId();
    }

    localStorage.setItem(CONFIG.STORAGE_KEYS.teamInfo, JSON.stringify({
        name: currentTeam,
        missionLevel,
        language: currentLanguage,
        registeredAt: gameStartTime.toISOString(),
        sessionId: sessionId,
        currentPuzzle: 0
    }));

    submitToGoogleSheets('REGISTRATION', {
        teamName: currentTeam,
        mission: missionLevel,
        language: currentLanguage
    });

    updateTeamStatus();
    playSound('powerUp');
    document.getElementById('screen')?.classList.add('premium-glow');
    showFeedback('registrationFeedback', `✓ Welcome back, ${currentTeam}`, 'success');

    setTimeout(() => {
        document.getElementById('screen')?.classList.remove('premium-glow');
        showStep(2);
    }, 1200);
});

// ==============================
// STEP 2: QR SCANNER
// ==============================
async function startQRScanner() {
    try {
        videoStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment',
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30 }
            }
        });

        playSound('scanStart');

        document.getElementById('qrScannerContainer').classList.remove('hidden');
        const video = document.getElementById('qrVideo');
        video.srcObject = videoStream;

        // Wait for video to be ready to check capabilities
        video.onloadedmetadata = () => {
            video.play();
            setupZoomControl(videoStream.getVideoTracks()[0]);
        };

        qrScannerActive = true;
        startQRCodeDetection();

    } catch (error) {
        console.error('Camera error:', error);
        showToast('Camera access denied. Using manual override.', 'error');
        showManualEntry();
    }
}

let initialPinchDistance = null;
let initialPinchZoom = null;

function setupZoomControl(track) {
    const zoomContainer = document.getElementById('zoomControlContainer');
    const zoomSlider = document.getElementById('qrZoomSlider');
    const scannerOverlay = document.getElementById('qrScannerContainer');

    if (!zoomContainer || !zoomSlider || !track || !scannerOverlay) return;

    // Check if the track supports zoom
    const capabilities = track.getCapabilities();

    if (capabilities.zoom) {
        zoomContainer.classList.remove('hidden');

        // Set slider range based on hardware capabilities
        zoomSlider.min = capabilities.zoom.min;
        zoomSlider.max = capabilities.zoom.max;
        zoomSlider.step = capabilities.zoom.step || 0.1;

        // Get current zoom value
        const settings = track.getSettings();
        zoomSlider.value = settings.zoom || capabilities.zoom.min;

        // Function to apply zoom
        const applyZoom = async (value) => {
            try {
                const zoomValue = Math.min(Math.max(value, capabilities.zoom.min), capabilities.zoom.max);
                await track.applyConstraints({
                    advanced: [{ zoom: zoomValue }]
                });
                zoomSlider.value = zoomValue;
            } catch (err) {
                console.error('Error applying zoom:', err);
            }
        };

        // Slider listener
        zoomSlider.oninput = (e) => applyZoom(parseFloat(e.target.value));

        // PINCH TO ZOOM LOGIC
        scannerOverlay.ontouchstart = (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                initialPinchDistance = Math.hypot(
                    e.touches[0].pageX - e.touches[1].pageX,
                    e.touches[0].pageY - e.touches[1].pageY
                );
                const currentSettings = track.getSettings();
                initialPinchZoom = currentSettings.zoom || 1;
            }
        };

        scannerOverlay.ontouchmove = (e) => {
            if (e.touches.length === 2 && initialPinchDistance !== null) {
                e.preventDefault();
                const currentDistance = Math.hypot(
                    e.touches[0].pageX - e.touches[1].pageX,
                    e.touches[0].pageY - e.touches[1].pageY
                );

                // Sensitivity factor: how much the zoom changes per pixel of pinch
                // We map the distance ratio to the zoom range
                const zoomDelta = (currentDistance - initialPinchDistance) / 100;
                applyZoom(initialPinchZoom + zoomDelta);
            }
        };

        scannerOverlay.ontouchend = () => {
            initialPinchDistance = null;
            initialPinchZoom = null;
        };

    } else {
        zoomContainer.classList.add('hidden');
        console.log('Zoom not supported by this camera');
    }
}

function stopQRScanner() {
    qrScannerActive = false;

    if (qrScanInterval) {
        clearInterval(qrScanInterval);
        qrScanInterval = null;
    }

    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }

    const scannerOverlay = document.getElementById('qrScannerContainer');
    if (scannerOverlay) {
        scannerOverlay.ontouchstart = null;
        scannerOverlay.ontouchmove = null;
        scannerOverlay.ontouchend = null;
    }

    // Cleanup OCR worker
    if (window.cleanupOCR) {
        window.cleanupOCR();
    }

    document.getElementById('qrScannerContainer')?.classList.add('hidden');
    document.getElementById('zoomControlContainer')?.classList.add('hidden');
}

function startQRCodeDetection() {
    const video = document.getElementById('qrVideo');
    const canvas = document.getElementById('qrCanvas');
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });

    let ocrWorker = null;
    let lastOCRTime = 0;
    const OCR_INTERVAL = 2000;

    // Fixed internal resolution for consistent performance
    const SCAN_WIDTH = 640;
    const SCAN_HEIGHT = 480;
    canvas.width = SCAN_WIDTH;
    canvas.height = SCAN_HEIGHT;

    Tesseract.createWorker().then(worker => {
        worker.loadLanguage('eng').then(() => {
            worker.initialize('eng').then(() => {
                ocrWorker = worker;
                console.log('[Scanner] AI OCR online');
            });
        });
    });

    qrScanInterval = setInterval(() => {
        if (!qrScannerActive || video.readyState !== video.HAVE_ENOUGH_DATA) return;

        try {
            // Re-sync aspect ratio only if video stream changes significantly
            if (video.videoWidth > 0 && Math.abs(canvas.width - SCAN_WIDTH) > 10) {
                // Optimization: stay at fixed scan resolution for speed
            }

            context.drawImage(video, 0, 0, SCAN_WIDTH, SCAN_HEIGHT);
            const imageData = context.getImageData(0, 0, SCAN_WIDTH, SCAN_HEIGHT);

            // 1. QR Code Look-up
            const code = jsQR(imageData.data, SCAN_WIDTH, SCAN_HEIGHT);
            if (code && code.data) {
                handleQRScanResult(code.data);
                return;
            }

            // 2. Throttled AI OCR (Google Lens style fallback)
            const now = Date.now();
            if (ocrWorker && (now - lastOCRTime) > OCR_INTERVAL) {
                lastOCRTime = now;
                canvas.toBlob(blob => {
                    if (!blob || !qrScannerActive) return;
                    ocrWorker.recognize(blob).then(({ data: { text } }) => {
                        if (!qrScannerActive) return;
                        const detectedText = text.toUpperCase().replace(/\s+/g, '');
                        const matchedPuzzle = PUZZLES.find(p => {
                            const linkId = p.linkid.toUpperCase().replace(/\s+/g, '');
                            return detectedText.includes(linkId);
                        });
                        if (matchedPuzzle) handleQRScanResult(matchedPuzzle.linkid);
                    }).catch(err => console.warn('[Scanner] OCR skip:', err));
                }, 'image/jpeg', 0.8);
            }
        } catch (error) {
            console.error('[Scanner] Critical Error:', error);
        }
    }, 250);

    window.cleanupOCR = () => {
        if (ocrWorker) ocrWorker.terminate();
        ocrWorker = null;
    };
}

// QR Processing State
let processingQR = false;

function handleQRScanResult(qrData) {
    if (processingQR) return;
    processingQR = true;

    console.log('QR Code detected:', qrData);

    let linkId = qrData;
    try {
        if (qrData.includes('linkid=')) {
            try {
                const url = new URL(qrData);
                linkId = url.searchParams.get('linkid');
            } catch (e) {
                const match = qrData.match(/linkid=([^&]*)/i);
                if (match && match[1]) {
                    linkId = match[1];
                }
            }
        }
    } catch (e) {
        console.warn('QR parse error:', e);
    }

    urlLockedPuzzle = PUZZLES.find(p => standardizeString(p.linkid) === standardizeString(linkId));

    if (urlLockedPuzzle) {
        submitToGoogleSheets('QR_SCANNED', {
            linkId: linkId,
            puzzleId: urlLockedPuzzle.id,
            location: urlLockedPuzzle.locationClue // Informative
        });

        showToast('✓ Signal Acquired - Redirecting...', 'success');
        // Brief pause to let user see success status
        setTimeout(() => {
            stopQRScanner();
            showStep(3);
            processingQR = false;
        }, 1500);
    } else {
        console.warn('QR code not recognized:', qrData);
        showToast('❌ Invalid Signal - Access Denied', 'error');

        // Longer pause for error so they can read it before re-scanning
        setTimeout(() => {
            processingQR = false;
        }, 2500);
    }
}

// ==============================
// STEP 3: UNLOCK VERIFICATION
// ==============================
document.getElementById('unlockForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const code = standardizeString(document.getElementById('unlockCode').value);

    if (!code) {
        showFeedback('unlockFeedback', 'Enter previous answer', 'error');
        return;
    }

    // NEW SYSTEM: Use previousPuzzleId array to link puzzles
    let puzzle = null;

    if (urlLockedPuzzle) {
        // If we have a URL-locked puzzle, validate against its prerequisites
        if (urlLockedPuzzle.previousPuzzleId.includes(0)) {
            // Starting puzzle - check if it has a specific startCode
            if (urlLockedPuzzle.startCode) {
                // Group-specific start code required
                if (standardizeString(urlLockedPuzzle.startCode) === code) {
                    puzzle = urlLockedPuzzle;
                }
            } else {
                // No startCode defined - accept any code (backward compatibility)
                puzzle = urlLockedPuzzle;
            }
        } else {
            // Check if entered code matches ANY of the previous puzzles' answers
            const isValid = urlLockedPuzzle.previousPuzzleId.some(prevId => {
                const prevPuzzle = PUZZLES.find(p => p.id === prevId);
                return prevPuzzle && standardizeString(prevPuzzle.answer) === code;
            });

            if (isValid) {
                puzzle = urlLockedPuzzle;
            }
        }
    } else {
        // No URL lock - search all puzzles
        puzzle = PUZZLES.find(p => {
            if (p.previousPuzzleId.includes(0)) {
                // Starting puzzle - check startCode
                if (p.startCode) {
                    return standardizeString(p.startCode) === code;
                } else {
                    // No startCode - accept any code
                    return true;
                }
            } else {
                // Check if entered code matches ANY of the previous puzzles' answers
                return p.previousPuzzleId.some(prevId => {
                    const prevPuzzle = PUZZLES.find(prev => prev.id === prevId);
                    return prevPuzzle && standardizeString(prevPuzzle.answer) === code;
                });
            }
        });
    }

    if (puzzle) {
        currentPuzzle = puzzle;
        gameStartTime = new Date(); // Reset timer for the specific puzzle 

        const questionEl = document.getElementById('puzzleQuestion');
        if (questionEl) questionEl.textContent = getPuzzleQuestion(puzzle);

        // Safely update clue text (might be in Step 5 or 4)
        const clueEl = document.getElementById('locationClue') || document.getElementById('locationClueText');
        if (clueEl) clueEl.textContent = puzzle.locationClue;

        // Show CSS Pokeball (Mystery State)
        const pokeball = document.getElementById('step4Pokeball');
        if (pokeball) {
            pokeball.classList.remove('hidden');
        }

        // Determine which prerequisite was used
        const unlockedVia = puzzle.previousPuzzleId.includes(0)
            ? 'START'
            : `Puzzle ${puzzle.previousPuzzleId.join(' OR ')}`;

        submitToGoogleSheets('PUZZLE_UNLOCKED', {
            puzzleId: puzzle.id,
            puzzleLink: puzzle.linkid,
            unlockedVia: unlockedVia
        });

        showStep(4);
        playSound('success');
    } else {
        submitToGoogleSheets('UNLOCK_FAILED', {
            wrongCode: code,
            attemptedFor: urlLockedPuzzle ? urlLockedPuzzle.id : 'unknown',
            attemptedLink: urlLockedPuzzle ? urlLockedPuzzle.linkid : 'unknown'
        });
        showFeedback('unlockFeedback', 'Incorrect key', 'error');
        triggerShake('unlockCode');
        playSound('error');
    }
});

// ==============================
// STEP 4: PUZZLE SOLVING - SUBMIT HANDLER
// ==============================
function submitPuzzleAnswer() {
    const answerInput = document.getElementById('puzzleAnswer');
    if (!answerInput) return;

    const answer = answerInput.value.trim().toLowerCase();

    if (!answer) {
        showToast("INPUT REQUIRED", "error");
        return;
    }

    if (!currentPuzzle) {
        showToast("NO PUZZLE LOADED", "error");
        return;
    }

    if (standardizeString(currentPuzzle.answer) === standardizeString(answer)) {
        playSound('victory');
        showToast("SIGNAL DECRYPTED!", "success");

        // Visual flair
        document.getElementById('screen')?.classList.add('premium-glow');
        setTimeout(() => document.getElementById('screen')?.classList.remove('premium-glow'), 2000);

        // Prepare Success Step Data
        const caughtImg = document.getElementById('capturePokemonImg') || document.getElementById('caughtPokemonImg');
        if (caughtImg && currentPuzzle.pokemonId) {
            caughtImg.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${currentPuzzle.pokemonId}.png`;
        }

        const clueText = document.getElementById('locationClue') || document.getElementById('locationClueText');
        const locationCard = document.getElementById('locationCard');
        const nextBtn = document.getElementById('nextSignalBtn');

        if (clueText) {
            clueText.textContent = currentPuzzle.locationClue || "NO SIGNAL SOURCE";
        }

        // Hide location card and next button if clue is null or "END"
        const isEnd = !currentPuzzle.locationClue || currentPuzzle.locationClue.toUpperCase() === 'END';
        const completionMessage = document.getElementById('completionMessage');

        if (isEnd) {
            if (locationCard) locationCard.classList.add('hidden');
            if (nextBtn) nextBtn.classList.add('hidden');
            if (completionMessage) {
                completionMessage.classList.remove('hidden');

                // Dynamic Message based on current level
                const levelNum = (currentMissionLevel || "L1").split('_')[0].replace('L', '');
                const levelTitle = document.getElementById('completionLevelTitle');
                if (levelTitle) levelTitle.textContent = `LEVEL ${levelNum} CHAMPION`;

                const levelSub = document.getElementById('completionLevelSub');
                if (levelSub) levelSub.textContent = `YOU HAVE COMPLETED LEVEL ${levelNum}`;

                const trophyImg = document.getElementById('completionTrophyImg');
                if (trophyImg) trophyImg.src = 'images/poketropy.png';
            }

            // Trigger Grand Celebration
            setTimeout(() => triggerFinalCelebration(), 1500);
        } else {
            if (locationCard) locationCard.classList.remove('hidden');
            if (nextBtn) nextBtn.classList.remove('hidden');
            if (completionMessage) completionMessage.classList.add('hidden');
        }

        // Delay move for satisfaction
        setTimeout(() => {
            showStep(5);
            playSound('hologram');

            // 🔥 Play Pokemon Cry from PokeAPI assets
            if (currentPuzzle.pokemonId) {
                const cryUrl = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/cries/latest/${currentPuzzle.pokemonId}.ogg`;
                setTimeout(() => playSound(cryUrl, 0.4), 600); // Slight delay after hologram sound
            }
        }, 1200);

        submitToGoogleSheets('SOLVED', {
            puzzleId: currentPuzzle.id,
            team: currentTeam,
            answer: answer
        });
    } else {
        playSound('error');
        showToast("DECRYPTION FAILED", "error");

        // Premium Error Effect
        document.getElementById('screen')?.classList.add('glitch-active');
        setTimeout(() => document.getElementById('screen')?.classList.remove('glitch-active'), 400);

        answerInput.value = "";
        triggerShake('puzzleAnswer');

        submitToGoogleSheets('WRONG_ATTEMPT', {
            puzzleId: currentPuzzle.id,
            wrongAnswer: answer
        });
    }
}
// Attach the submit handler
document.getElementById('answerForm').addEventListener('submit', (e) => {
    e.preventDefault(); // Prevent default form submission
    submitPuzzleAnswer();
});

// ==============================
// STEP 5: CONTINUE
// ==============================
function continueToQRScan() {
    // Check if current puzzle is the final one (locationClue is null or "END")
    const isEnd = currentPuzzle && (!currentPuzzle.locationClue || currentPuzzle.locationClue.toUpperCase() === 'END');
    if (isEnd) {
        showToast('🎉 CONGRATULATIONS! You have completed all puzzles!', 'success');
        playSound('victory');

        // Show completion message instead of going to QR scan
        setTimeout(() => {
            showToast('No more puzzles available. Game Complete!', 'success');
        }, 2000);

        return; // Don't proceed to QR scan
    }

    document.getElementById('unlockCode').value = '';
    urlLockedPuzzle = null;
    showStep(2);
}

function backToStep2() {
    showStep(2);
}

// ==============================
// MANUAL ENTRY HANDLERS
// ==============================
function showManualEntry() {
    const container = document.getElementById('manualEntryContainer');
    if (container) {
        container.classList.remove('hidden');
        document.getElementById('manualSignalId')?.focus();
    }
}

function hideManualEntry() {
    const container = document.getElementById('manualEntryContainer');
    if (container) {
        container.classList.add('hidden');
    }
}

function submitManualEntry() {
    const input = document.getElementById('manualSignalId');
    if (!input) return;

    const signalId = input.value.trim().toUpperCase();
    if (!signalId) {
        showToast('Enter a valid Signal ID', 'error');
        return;
    }

    console.log('Manual Signal Entry:', signalId);
    handleQRScanResult(signalId);

    // Reset and close
    input.value = '';
    hideManualEntry();
}

// ==============================
// UTILITY FUNCTIONS
// ==============================
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    const screen = document.querySelector('.crt-screen');
    if (!screen) return;

    // Use specific glass classes for toasts
    const glassClass = type === 'error' ? 'glass-black' :
        type === 'success' ? 'glass-green' : 'glass-blue';

    // absolute positioning, glassmorphism, refined smaller font, and containment width
    toast.className = `absolute top-6 left-1/2 transform -translate-x-1/2 glass-toast ${glassClass} px-3 py-2 rounded-lg border shadow-xl font-pixel text-[8px] text-white z-[9999] transition-all duration-300 pointer-events-none w-[80%] max-w-[200px]`;

    // Use truncate for the message to prevent overflow if it's too long
    toast.innerHTML = `
        <div class="flex items-center gap-2 relative z-10 w-full">
            <span class="material-symbols-rounded text-xs shrink-0">${type === 'error' ? 'warning' : type === 'success' ? 'check_circle' : 'info'}</span>
            <span class="text-[8px] leading-tight break-words">${message}</span>
        </div>
    `;

    screen.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        toast.style.transform = 'translate(-50%, 0)';
        toast.style.opacity = '1';
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translate(-50%, -10px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);

    if (type === 'error') playSound('error');
    if (type === 'success') playSound('success');
}

function triggerShake(elementId) {
    const el = document.getElementById(elementId);
    el.classList.add('animate-shake');
    setTimeout(() => el.classList.remove('animate-shake'), 500);
}

function showFeedback(elementId, message, type) {
    const fb = document.getElementById(elementId);
    fb.textContent = message;

    if (type === 'error') {
        fb.className = 'text-xs p-3 rounded border bg-red-900/30 border-red-700 text-red-200';
    } else if (type === 'success') {
        fb.className = 'text-xs p-3 rounded border bg-green-900/30 border-green-700 text-green-200';
    } else {
        fb.className = 'text-xs p-3 rounded border bg-blue-900/30 border-blue-700 text-blue-200';
    }

    fb.classList.remove('hidden');

    setTimeout(() => {
        fb.classList.add('hidden');
    }, 3000);
}

// ==============================
// ANTI-CHEAT PROTECTION
// ==============================
function removeBlackout() {
    // Managed by security.js
}

function showAntiCopyToast() {
    // Managed by security.js
}

// ==============================
// INITIALIZATION
// ==============================
document.addEventListener('DOMContentLoaded', async () => {
    // Sessions are now persistent for a better user experience
    // localStorage.removeItem(CONFIG.STORAGE_KEYS.gameState); 
    // localStorage.removeItem(CONFIG.STORAGE_KEYS.teamInfo); 

    await loadPuzzles();
    await loadTeams();
    initAudio();

    if (!sessionId) {
        sessionId = generateSessionId();
    }

    // Initialize with empty state for a fresh start
    currentTeam = "";
    tabSwitchCount = 0;
    currentPuzzle = null;
    urlLockedPuzzle = null;
    currentLanguage = "PYTHON";

    // Restore language from saved session
    try {
        const savedTeamInfo = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.teamInfo) || '{}');
        if (savedTeamInfo.language) currentLanguage = savedTeamInfo.language;
    } catch (e) { }

    if (PUZZLES.length > 0) {
        const params = new URLSearchParams(window.location.search);
        const linkId = standardizeString(params.get('linkid'));
        const foundFromUrl = PUZZLES.find(p => standardizeString(p.linkid) === linkId);
        if (foundFromUrl) urlLockedPuzzle = foundFromUrl;
    }

    if (urlLockedPuzzle) {
        if (urlLockedPuzzle.id === 1) {
            const unlockCodeInput = document.getElementById('unlockCode');
            if (unlockCodeInput) unlockCodeInput.value = "START";
        }
    }

    updateTeamStatus();
    showStep(0);

    // Security is now managed by security.js
    // setTimeout(setupAntiCheat, 500); 

    // Log session start once we have a session ID
    submitToGoogleSheets('SESSION_START', {
        userAgent: navigator.userAgent,
        screenSize: `${window.innerWidth}x${window.innerHeight}`
    });

    console.log('Professional Pokédex Initialized - Fresh Session ID:', sessionId);
});

// ==============================
// CLEANUP
// ==============================
window.addEventListener('beforeunload', () => {
    stopQRScanner();
    stopTabMonitoring();
    cleanupHintSystem();

    if (penaltyTimer) {
        clearInterval(penaltyTimer);
    }

    if (penaltyDelayTimeout) {
        clearTimeout(penaltyDelayTimeout);
    }

    if (graceCountdownInterval) {
        clearInterval(graceCountdownInterval);
    }

    cancelGracePeriodUI();

    saveGameState();
});

window.addEventListener('beforeunload', (e) => {
    if (penaltyActive || hintPenaltyActive) {
        e.preventDefault();
        e.returnValue = 'You are currently serving a penalty. Are you sure you want to leave?';
        return e.returnValue;
    }
});

// Ensure global scope access for the close button
window.closeHintPopup = closeHintPopup;

function togglePasswordVisibility() {
    const pwdInput = document.getElementById('teamPassword');
    const icon = document.getElementById('passwordToggleIcon');
    if (pwdInput && icon) {
        const isPassword = pwdInput.type === 'password';
        pwdInput.type = isPassword ? 'text' : 'password';
        icon.textContent = isPassword ? 'visibility' : 'visibility_off';
    }
}
window.togglePasswordVisibility = togglePasswordVisibility;

// ==============================
// AUXILIARY INTERFACE LOGIC
// ==============================
let isPowerOn = true;

function togglePowerMode() {
    isPowerOn = !isPowerOn;
    const indicator = document.getElementById('power-indicator');
    const crtScreen = document.getElementById('screen');

    if (indicator) {
        indicator.className = `w-2 h-2 rounded-full transition-all ${isPowerOn ? 'power-on' : 'bg-red-900 shadow-none'}`;
    }

    if (crtScreen) {
        if (isPowerOn) {
            crtScreen.style.filter = '';
            crtScreen.style.opacity = '1';
            playSound('powerUp');
        } else {
            crtScreen.style.filter = 'brightness(0) contrast(2)';
            crtScreen.style.opacity = '0.1';
            playSound('click');
        }
    }
}

function handleAuxClick(btnId) {
    playSound('click');
    if ('vibrate' in navigator) navigator.vibrate(20);

    console.log(`Auxiliary Button ${btnId} pressed`);

    // Add a quick flash to the corresponding button
    const btn = document.getElementById(`aux-btn-${btnId}`);
    if (btn) {
        const originalBg = btn.style.background;
        btn.style.background = 'white';
        setTimeout(() => btn.style.background = originalBg, 50);
    }

    // Toggle mute if button 1 is pressed
    if (btnId === 1) {
        window.isMuted = !window.isMuted;
        if (window.isMuted && window.bgMusic) {
            window.bgMusic.pause();
        } else if (!window.isMuted && window.bgMusic && !window.bgMusic.paused) {
            // keep playing
        }
        showToast(window.isMuted ? 'Audio Suspended' : 'Audio Active', window.isMuted ? 'error' : 'success');
    }

    // Toggle Music if button 2 is pressed
    if (btnId === 2) {
        if (!window.bgMusic) {
            window.bgMusic = new Audio('https://play.pokemonshowdown.com/audio/music/battle-trainer.mp3');
            window.bgMusic.loop = true;
            window.bgMusic.volume = 0.15;
        }

        if (window.bgMusic.paused) {
            window.bgMusic.play().catch(e => console.warn("Music play block:", e));
            showToast('BGM Active', 'success');
        } else {
            window.bgMusic.pause();
            showToast('BGM Suspended', 'info');
        }
    }
}

// Map globals
window.togglePowerMode = togglePowerMode;
window.handleAuxClick = handleAuxClick;
window.acceptRules = function () {
    playSound('powerUp');
    showStep(1);
};

// ==============================
// DEBUGGING TOOLS
// ==============================
window.testConnection = async function () {
    console.log('Testing connection to Google Sheets...');
    showToast('Testing Uplink...', 'info');

    try {
        const testPayload = {
            action: 'CONNECTION_TEST',
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent
        };

        // Add to queue manually to use the robust sender
        submitToGoogleSheets('CONNECTION_TEST', { note: 'Manual Test Triggered' });

        // Also try a direct ping for console feedback
        if (!GOOGLE_SCRIPT_URL) {
            throw new Error('Google Script URL is not defined');
        }

        console.log('Packet queued. Monitor network tab for "exec" request.');
        setTimeout(() => {
            // We can't know for sure if it worked due to no-cors, but we can assume if no error thrown
            showToast('Uplink Signal Sent', 'success');
        }, 1000);

    } catch (e) {
        console.error('Connection Test Failed:', e);
        showToast('Uplink Failed', 'error');
        alert('Connection Error: ' + e.message + '\nCheck console for details.');
    }
};

// ==============================
// GLOBAL ERROR HANDLING
// ==============================
window.onerror = function (msg, url, lineNo, columnNo, error) {
    const errorData = {
        message: msg,
        script: url,
        line: lineNo,
        column: columnNo,
        stack: error ? error.stack : 'No stack trace'
    };

    console.error('Global Error Caught:', errorData);

    // Attempt to report critical errors to server
    // Use a lightweight fire-and-forget approach
    const payload = {
        action: 'CLIENT_ERROR',
        teamName: typeof currentTeam !== 'undefined' ? currentTeam : 'Unknown',
        errorDetails: JSON.stringify(errorData)
    };

    // Direct robust fetch for errors
    if (typeof GOOGLE_SCRIPT_URL !== 'undefined' && GOOGLE_SCRIPT_URL) {
        fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            keepalive: true,
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
        }).catch(e => console.warn('Failed to report error', e));
    }

    return false; // Let default handler run
};

function triggerFinalCelebration() {
    const canvas = document.getElementById('celebrationCanvas');
    const screen = document.getElementById('screen');
    if (!canvas || !screen) return;

    // Reset and size canvas
    canvas.width = screen.clientWidth;
    canvas.height = screen.clientHeight;

    const myConfetti = confetti.create(canvas, {
        resize: true,
        useWorker: true
    });

    // 1. SCREEN FLASH EFFECT
    screen.style.transition = 'none';
    screen.style.backgroundColor = 'white';
    setTimeout(() => {
        screen.style.transition = 'background-color 2s ease';
        screen.style.backgroundColor = '';
    }, 100);

    // 2. FOUNTAIN EFFECT (Vibrant Multi-color)
    const end = Date.now() + (15 * 1000);
    const colors = [
        '#ff0000', // Pokeball Red
        '#3b82f6', // Greatball Blue
        '#ffd700', // Ultra/Gold Yellow
        '#22c55e', // Grass Green
        '#a855f7', // Masterball Purple
        '#ffffff', // Pure White
        '#f97316'  // Fire Orange
    ];

    (function frame() {
        myConfetti({
            particleCount: 3,
            angle: 60,
            spread: 55,
            origin: { x: 0, y: 1 },
            colors: colors
        });
        myConfetti({
            particleCount: 3,
            angle: 120,
            spread: 55,
            origin: { x: 1, y: 1 },
            colors: colors
        });

        if (Date.now() < end) {
            requestAnimationFrame(frame);
        }
    }());

    // 3. PERIODIC STAR BURSTS
    const starInterval = setInterval(() => {
        if (Date.now() > end) return clearInterval(starInterval);

        myConfetti({
            particleCount: 40,
            spread: 100,
            origin: { x: Math.random(), y: Math.random() - 0.2 },
            shapes: ['star'],
            colors: ['#FFEAB0', '#FFF9E3', '#FACC15']
        });
    }, 1500);

    // 4. INITIAL GRAND EXPLOSIONS
    const burst = (delay, x) => {
        setTimeout(() => {
            myConfetti({
                particleCount: 150,
                startVelocity: 45,
                spread: 90,
                origin: { x: x, y: 0.7 },
                colors: colors,
                gravity: 1.2
            });
            playSound('success'); // Additional success sounds for impact
        }, delay);
    };

    burst(0, 0.5);   // Center
    burst(400, 0.2); // Left
    burst(800, 0.8); // Right
    burst(1200, 0.5); // Center again
}

window.onunhandledrejection = function (event) {
    console.error('Unhandled Promise Rejection:', event.reason);

    // Optional: Log promise rejections if they differ significantly from errors
    if (typeof submitToGoogleSheets === 'function') {
        submitToGoogleSheets('PROMISE_REJECTION', {
            reason: event.reason ? event.reason.toString() : 'Unknown Reason'
        });
    }
};