// Telegram Web App — force DARK native chrome on ALL versions
const tg = window.Telegram?.WebApp;
if (tg) {
    try { tg.ready(); } catch(e) {}
    try { tg.expand(); } catch(e) {}

    const DARK = '#0f0f1a';
    const ver = parseFloat(tg.version || '6.0');

    // Telegram v6.0 does NOT support hex for setHeaderColor/setBackgroundColor —
    // it only accepts the keyword 'bg_color' or 'secondary_bg_color' (which follow
    // the user's Telegram theme = WHITE for light-mode users). So on v6.0 the
    // native chrome cannot be forced dark from JS; we must at least NOT let the
    // SDK default to white. On v6.1+ hex works. On v6.9+ setBottomBarColor works.
    // Strategy: force themeParams to dark BEFORE the SDK broadcasts defaults,
    // then call every setter in try/catch so failures don't abort.
    try {
        if (tg.themeParams) {
            tg.themeParams.bg_color = DARK;
            tg.themeParams.secondary_bg_color = DARK;
            tg.themeParams.text_color = '#ffffff';
        }
    } catch(e) {}

    // Try hex first (v6.1+), fall back to keyword (v6.0)
    try { tg.setHeaderColor(DARK); } catch(e) {
        try { tg.setHeaderColor('bg_color'); } catch(e2) {}
    }
    try { tg.setBackgroundColor(DARK); } catch(e) {
        try { tg.setBackgroundColor('bg_color'); } catch(e2) {}
    }
    try { tg.setBottomBarColor && tg.setBottomBarColor(DARK); } catch(e) {
        try { tg.setBottomBarColor && tg.setBottomBarColor('bg_color'); } catch(e2) {}
    }

    // Directly postEvent bypasses the SDK's version check — some Telegram
    // clients accept the event even if the JS SDK thinks they don't.
    try {
        const post = (event, data) => {
            const payload = JSON.stringify(data);
            if (window.TelegramWebviewProxy && window.TelegramWebviewProxy.postEvent) {
                window.TelegramWebviewProxy.postEvent(event, payload);
            } else if (window.external && 'notify' in window.external) {
                window.external.notify(JSON.stringify({ eventType: event, eventData: data }));
            } else if (window.parent !== window) {
                window.parent.postMessage(JSON.stringify({ eventType: event, eventData: data }), 'https://web.telegram.org');
            }
        };
        post('web_app_set_header_color', { color: DARK });
        post('web_app_set_background_color', { color: DARK });
        post('web_app_set_bottom_bar_color', { color: DARK });
    } catch(e) {}

    // DO NOT add 'tg-theme' class — it pulls in Telegram's light-mode theme vars
    // document.body.classList.add('tg-theme');
}

// State
let state = {
    playerCount: 3, liarCount: 1, category: null,
    players: [], card: null, currentReveal: 0,
    currentRound: 0, currentPlayer: 0, votes: {},
    currentVoter: 0, selectedSuspect: null
};

// Safe HTML escape
function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// Safe localStorage wrapper
function lsGet(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch { return fallback; }
}
function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// Custom content
let customChars = lsGet('vrushka_chars', []);
let customPlaces = lsGet('vrushka_places', []);

// Fix iOS keyboard viewport jump
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
        document.body.style.height = window.visualViewport.height + 'px';
    });
    window.visualViewport.addEventListener('scroll', () => {
        document.body.style.height = window.visualViewport.height + 'px';
    });
}

// Prevent iOS scroll bounce when keyboard opens
document.addEventListener('focusin', (e) => {
    if (e.target.tagName === 'INPUT') {
        setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
    }
});

// Init
document.addEventListener('DOMContentLoaded', () => {
    initSetup();
    renderCustomLists();
    initCategories();
});

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-' + id).classList.add('active');
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// === SETUP ===
function initSetup() { setPlayerCount(3); updateLiarButtons(); }

function setPlayerCount(n) {
    // Save existing names before rebuilding
    const oldInputs = document.querySelectorAll('.player-input');
    const savedNames = [];
    oldInputs.forEach(inp => savedNames.push(inp.value));

    state.playerCount = n;
    document.querySelectorAll('.count-btn:not(.liar)').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.count-btn:not(.liar)').forEach(b => { if (b.textContent == n) b.classList.add('active'); });
    const container = document.getElementById('player-names');
    container.innerHTML = '';
    for (let i = 0; i < n; i++) {
        const saved = savedNames[i] || '';
        container.innerHTML += `<div class="input-row"><input type="text" class="input player-input" placeholder="Игрок ${i+1}" data-idx="${i}" value="${esc(saved)}"></div>`;
    }
    // Clamp liars if too many for new player count
    const maxLiars = Math.max(1, n - 2);
    if (state.liarCount > maxLiars) setLiarCount(maxLiars);
    updateLiarButtons();
}

function setLiarCount(n) {
    const maxLiars = Math.max(1, state.playerCount - 2);
    state.liarCount = Math.min(n, maxLiars);
    updateLiarButtons();
}

function updateLiarButtons() {
    const maxLiars = Math.max(1, state.playerCount - 2);
    document.querySelectorAll('.count-btn.liar').forEach(b => {
        b.classList.remove('active');
        const val = parseInt(b.textContent);
        if (val === state.liarCount) b.classList.add('active');
        // Disable buttons that exceed max
        if (val > maxLiars) {
            b.style.opacity = '0.3';
            b.style.pointerEvents = 'none';
        } else {
            b.style.opacity = '1';
            b.style.pointerEvents = 'auto';
        }
    });
}

function initCategories() {
    const row = document.getElementById('category-row');
    row.innerHTML = `<button class="cat-btn active" onclick="setCategory(null,this)">🎲 Все</button>`;
    Object.keys(CHARACTERS).forEach(cat => {
        row.innerHTML += `<button class="cat-btn" onclick="setCategory('${cat}',this)">${cat}</button>`;
    });
}

function setCategory(cat, btn) {
    state.category = cat;
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
}

// === START GAME ===
function startGame() {
    const inputs = document.querySelectorAll('.player-input');
    state.players = [];
    inputs.forEach((inp, i) => {
        state.players.push({
            name: inp.value.trim() || `Игрок ${i+1}`,
            role: 'detective', condition: null, votedFor: null
        });
    });

    // Pick card
    let chars;
    if (state.category) { chars = [...CHARACTERS[state.category]]; }
    else { chars = Object.values(CHARACTERS).flat(); }
    // Add custom chars
    customChars.forEach(c => chars.push(c));
    let places = [...PLACES, ...customPlaces];

    state.card = { character: pick(chars), place: pick(places) };

    // Assign roles
    let indices = state.players.map((_, i) => i);
    indices.sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(state.liarCount, state.players.length - 1); i++) {
        state.players[indices[i]].role = 'liar';
    }

    // Assign conditions (~50%)
    state.players.forEach(p => { p.condition = Math.random() > 0.5 ? pick(CONDITIONS) : null; });

    state.currentReveal = 0;
    state.currentRound = 0;
    showScreen('card');
    renderCardReveal();
}

// === CARD REVEAL ===
function renderCardReveal() {
    const prog = document.getElementById('card-progress');
    prog.innerHTML = state.players.map((_, i) =>
        `<div class="card-pip ${i <= state.currentReveal ? 'done' : ''}"></div>`
    ).join('');

    const p = state.players[state.currentReveal];
    const cont = document.getElementById('card-content');

    cont.innerHTML = `
        <div class="card-pass" id="card-pass">
            <div class="phone-emoji">📱</div>
            <h2>Передай телефон</h2>
            <div class="player-name">${esc(p.name)}</div>
            <p style="color:var(--text-dim);margin-top:12px">Нажми чтобы увидеть карточку</p>
            <button class="btn btn-primary" style="margin-top:20px" onclick="revealCard()">ПОКАЗАТЬ КАРТОЧКУ</button>
        </div>
        <div class="card-revealed" id="card-revealed" style="display:none"></div>
    `;
}

function revealCard() {
    const p = state.players[state.currentReveal];
    document.getElementById('card-pass').style.display = 'none';
    const el = document.getElementById('card-revealed');
    el.style.display = 'block';

    if (p.role === 'liar') {
        el.innerHTML = `
            <div class="role-emoji">🤥</div>
            <div class="role-text role-liar">Ты — Врушка!</div>
            <div class="card-info liar">
                <div class="card-emoji">🤫</div>
                <div class="card-value">Ты не знаешь персонажа!</div>
                <p style="color:var(--text-dim);font-size:14px;margin-top:8px">Притворяйся что знаешь. Не дай себя раскрыть!</p>
            </div>
            ${p.condition ? `<div class="condition-badge"><span>${p.condition.emoji} ${p.condition.text}</span></div>` : ''}
            <button class="btn btn-primary" style="margin-top:20px;width:100%" onclick="nextCard()">${state.currentReveal < state.players.length - 1 ? 'ПЕРЕДАТЬ ДАЛЬШЕ →' : 'НАЧАТЬ ИГРУ! 🎮'}</button>
        `;
    } else {
        el.innerHTML = `
            <div class="role-emoji">🕵️</div>
            <div class="role-text role-detective">Ты — Сыщик!</div>
            <div class="card-info detective">
                <div class="card-label">Персонаж</div>
                <div class="card-emoji">${state.card.character.emoji}</div>
                <div class="card-value">${state.card.character.name}</div>
                <div class="card-divider"></div>
                <div class="card-label">Место</div>
                <div class="card-emoji">${state.card.place.emoji}</div>
                <div class="card-value">${state.card.place.name}</div>
            </div>
            ${p.condition ? `<div class="condition-badge"><span>${p.condition.emoji} ${p.condition.text}</span></div>` : ''}
            <button class="btn btn-primary" style="margin-top:20px;width:100%" onclick="nextCard()">${state.currentReveal < state.players.length - 1 ? 'ПЕРЕДАТЬ ДАЛЬШЕ →' : 'НАЧАТЬ ИГРУ! 🎮'}</button>
        `;
    }
}

function nextCard() {
    if (state.currentReveal < state.players.length - 1) {
        state.currentReveal++;
        renderCardReveal();
    } else {
        state.currentRound = 0;
        startRound();
    }
}

// === ROUNDS ===
function startRound() {
    state.currentPlayer = 0;
    showScreen('round');
    renderRound();
}

function renderRound() {
    const r = ROUNDS[state.currentRound];
    document.getElementById('round-header').innerHTML = `
        <div class="round-num">Раунд ${r.num}</div>
        <div class="round-title">${r.emoji} ${r.title}</div>
        <div class="round-subtitle">${r.subtitle}</div>
    `;

    let html = '';
    state.players.forEach((p, i) => {
        const isActive = i === state.currentPlayer;
        html += `<div class="player-card ${isActive ? 'active' : ''}" onclick="state.currentPlayer=${i};renderRound()">
            <div>
                <div class="name">${esc(p.name)}</div>
                ${(state.currentRound === 0 && p.condition) ? `<div class="condition-text">${p.condition.emoji} ${p.condition.text}</div>` : ''}
            </div>
            ${isActive ? '<span class="badge">говорит</span>' : ''}
        </div>`;
    });

    if (state.currentRound === 4) {
        const q = pick(PROVOCATION_QS);
        html += `<div style="background:rgba(255,68,68,0.08);border:1px solid rgba(255,68,68,0.2);border-radius:14px;padding:16px;margin-top:12px;text-align:center">
            <div style="font-size:13px;color:var(--text-dim)">Вопрос:</div>
            <div style="font-size:18px;font-weight:800;margin-top:6px">${q}</div>
        </div>`;
    }

    document.getElementById('round-content').innerHTML = html;
}

function nextRound() {
    if (state.currentRound < ROUNDS.length - 1) {
        state.currentRound++;
        startRound();
    } else {
        goToVoting();
    }
}

// === VOTING ===
function goToVoting() {
    state.votes = {};
    state.currentVoter = 0;
    state.selectedSuspect = null;
    // Skip liars
    while (state.currentVoter < state.players.length && state.players[state.currentVoter].role === 'liar') state.currentVoter++;
    showScreen('voting');
    renderVoting();
}

function renderVoting() {
    const cont = document.getElementById('voting-content');
    if (state.currentVoter >= state.players.length) { resolveGame(); return; }

    const voter = state.players[state.currentVoter];
    cont.innerHTML = `
        <div style="font-size:50px;text-align:center;margin:20px 0">📱</div>
        <div class="voting-title">Передай телефон</div>
        <div class="voting-subtitle">${esc(voter.name)}</div>
        <button class="btn btn-primary" style="width:80%;margin:20px auto;display:block" onclick="showVoteOptions()">Я ГОТОВ ГОЛОСОВАТЬ</button>
    `;
}

function showVoteOptions() {
    const cont = document.getElementById('voting-content');
    const voter = state.players[state.currentVoter];
    let html = `
        <div style="font-size:40px;text-align:center">🗳️</div>
        <div class="voting-title">${esc(voter.name)}, кого подозреваешь?</div>
        <div style="margin-top:16px">
    `;
    state.players.forEach((p, i) => {
        if (i !== state.currentVoter) {
            html += `<div class="vote-btn ${state.selectedSuspect === i ? 'selected' : ''}" onclick="selectSuspect(${i})">
                <span class="name">${esc(p.name)}</span>
                <span class="check">${state.selectedSuspect === i ? '✅' : '⭕'}</span>
            </div>`;
        }
    });
    html += `</div>`;
    if (state.selectedSuspect !== null) {
        html += `<button class="btn-vote-confirm" onclick="confirmVote()">👎 Голосую против: ${esc(state.players[state.selectedSuspect].name)}</button>`;
    }
    cont.innerHTML = html;
}

function selectSuspect(i) { state.selectedSuspect = i; showVoteOptions(); }

function confirmVote() {
    const suspectName = state.players[state.selectedSuspect].name;
    state.votes[suspectName] = (state.votes[suspectName] || 0) + 1;
    state.selectedSuspect = null;
    state.currentVoter++;
    while (state.currentVoter < state.players.length && state.players[state.currentVoter].role === 'liar') state.currentVoter++;
    if (state.currentVoter >= state.players.length) { resolveGame(); }
    else { renderVoting(); }
}

// === RESULT ===
function resolveGame() {
    let maxVotes = 0;
    let suspects = [];
    Object.entries(state.votes).forEach(([name, count]) => {
        if (count > maxVotes) { maxVotes = count; suspects = [name]; }
        else if (count === maxVotes) suspects.push(name);
    });

    const liars = state.players.filter(p => p.role === 'liar');
    const caught = liars.filter(l => suspects.includes(l.name));
    const detectivesWon = caught.length > 0;

    showScreen('result');
    const cont = document.getElementById('result-content');

    const meme = detectivesWon ? pick(LOSER_MEMES_LIAR) : pick(LOSER_MEMES_DETECTIVES);
    const punishment = pick(PUNISHMENTS);

    let html = `
        <div class="result-emoji">${detectivesWon ? '🎉' : '😈'}</div>
        <div class="result-title ${detectivesWon ? 'result-win' : 'result-lose'}">
            ${detectivesWon ? 'СЫЩИКИ ПОБЕДИЛИ!' : 'ВРУШКА ПОБЕДИЛ!'}
        </div>
    `;

    // Meme card
    html += `<div class="meme-card">
        <div class="meme-emoji">${meme.emoji}</div>
        <div class="meme-text">${meme.text}</div>
        <div class="meme-subtext">${meme.sub}</div>
    </div>`;

    // Card reveal
    html += `<div class="result-card-reveal">
        <div style="font-size:13px;color:var(--text-dim)">Карточка была:</div>
        <div style="margin-top:8px">
            <span style="font-size:28px">${state.card.character.emoji}</span>
            <span style="font-weight:700;font-size:16px"> ${state.card.character.name}</span>
            <span style="color:var(--text-dim)"> в </span>
            <span style="font-size:28px">${state.card.place.emoji}</span>
            <span style="font-weight:700;font-size:16px"> ${state.card.place.name}</span>
        </div>
    </div>`;

    // Vote results
    html += `<div class="result-votes">
        <div style="font-size:13px;color:var(--text-dim);margin-bottom:8px">Голосование:</div>`;
    state.players.forEach(p => {
        const vc = state.votes[p.name] || 0;
        const badgeClass = p.role === 'liar' ? 'role-badge-liar' : 'role-badge-detective';
        const roleName = p.role === 'liar' ? 'Врушка' : 'Сыщик';
        html += `<div class="result-vote-row">
            <span>${p.role === 'liar' ? '🤥' : '🕵️'}</span>
            <span class="name">${esc(p.name)}</span>
            <span class="role-badge ${badgeClass}">${roleName}</span>
            <span style="color:${vc > 0 ? 'var(--red)' : 'var(--text-dim)'};font-weight:700">✋${vc}</span>
        </div>`;
    });
    html += `</div>`;

    // Punishment
    html += `<div style="background:rgba(255,153,51,0.08);border-radius:14px;padding:16px;width:100%;text-align:center">
        <div style="font-size:13px;color:var(--orange)">🎡 Наказание:</div>
        <div style="font-size:28px;margin:6px 0">${punishment.emoji}</div>
        <div style="font-weight:700">${punishment.text}</div>
    </div>`;

    // Buttons
    html += `
        <button class="btn btn-primary btn-large" onclick="showScreen('setup')" style="margin-top:8px">🔄 ИГРАТЬ ЕЩЁ</button>
        <button class="btn-back" onclick="showScreen('menu')" style="margin-top:4px">В меню</button>
    `;

    cont.innerHTML = html;
}

// === CUSTOM CONTENT ===
function addCustomCharacter() {
    const input = document.getElementById('custom-char-name');
    const name = input.value.trim();
    if (!name) return;
    customChars.push({ name, emoji: '🎭' });
    lsSet('vrushka_chars', customChars);
    input.value = '';
    renderCustomLists();
}

function addCustomPlace() {
    const input = document.getElementById('custom-place-name');
    const name = input.value.trim();
    if (!name) return;
    customPlaces.push({ name, emoji: '📍' });
    lsSet('vrushka_places', customPlaces);
    input.value = '';
    renderCustomLists();
}

function removeCustomChar(i) {
    customChars.splice(i, 1);
    lsSet('vrushka_chars', customChars);
    renderCustomLists();
}

function removeCustomPlace(i) {
    customPlaces.splice(i, 1);
    lsSet('vrushka_places', customPlaces);
    renderCustomLists();
}

function renderCustomLists() {
    const charList = document.getElementById('custom-chars-list');
    const placeList = document.getElementById('custom-places-list');
    if (charList) {
        charList.innerHTML = customChars.length === 0
            ? '<div style="text-align:center;color:var(--text-dim);padding:16px;font-size:14px">Пока пусто — добавь персонажей!</div>'
            : customChars.map((c, i) => `<div class="custom-item"><span>${c.emoji}</span><span class="name">${esc(c.name)}</span><button class="del" onclick="removeCustomChar(${i})">✕</button></div>`).join('');
    }
    if (placeList) {
        placeList.innerHTML = customPlaces.length === 0
            ? '<div style="text-align:center;color:var(--text-dim);padding:16px;font-size:14px">Пока пусто — добавь места!</div>'
            : customPlaces.map((p, i) => `<div class="custom-item"><span>${p.emoji}</span><span class="name">${esc(p.name)}</span><button class="del" onclick="removeCustomPlace(${i})">✕</button></div>`).join('');
    }
}
