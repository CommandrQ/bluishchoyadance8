// --- CONFIGURATION ---
const NWS_NATIONAL_BASE_URL = 'https://api.weather.gov/alerts/active?event=Tornado%20Warning,Severe%20Thunderstorm%20Warning,Tornado%20Watch';
window.scannerStatements = [];

// Autofocus search bar immediately after load
window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const searchInput = document.getElementById('location-search');
        if (searchInput) searchInput.focus();
    }, 150);
});

// --- SERVICE WORKER REGISTRATION ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/apps/weather-beta/sw.js').catch(err => console.error(err)));
}

// --- ONLINE/OFFLINE SHIELD LOGIC ---
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

function updateNetworkStatus() {
    const banner = document.getElementById('offline-banner');
    const scanState = document.getElementById('scan-state');
    
    if (navigator.onLine) {
        banner.classList.add('hidden');
        if(localStorage.getItem('last_lat')) {
            scanState.innerText = "ACTIVE";
            scanState.className = "state-active";
            refreshDashboard();
        }
    } else {
        banner.classList.remove('hidden');
        scanState.innerText = "OFFLINE";
        scanState.className = "state-offline";
    }
}

// --- UI EVENT LISTENERS ---
document.getElementById('toggle-advanced-btn').addEventListener('click', (e) => {
    const advSection = document.getElementById('advanced-metrics');
    if (advSection.classList.contains('hidden')) {
        advSection.classList.remove('hidden');
        e.target.innerText = "Hide Advanced Stats";
    } else {
        advSection.classList.add('hidden');
        e.target.innerText = "Show Advanced Stats";
    }
});

document.getElementById('manual-refresh-btn').addEventListener('click', () => {
    // Visual Action Feedback
    const btn = document.getElementById('manual-refresh-btn');
    btn.style.transform = 'rotate(180deg)';
    btn.style.transition = 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
    setTimeout(() => {
        btn.style.transition = 'none';
        btn.style.transform = 'rotate(0deg)';
    }, 400);
    
    refreshDashboard();
});

// --- AUTOCOMPLETE LOGIC ---
const searchInput = document.getElementById('location-search');
const dropdown = document.getElementById('autocomplete-dropdown');
let debounceTimer;

searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    clearTimeout(debounceTimer);
    
    if (query.length < 3) {
        dropdown.classList.add('hidden');
        return;
    }

    debounceTimer = setTimeout(async () => {
        try {
            const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${query}&count=5&language=en&format=json`);
            const data = await res.json();
            
            if (data.results) {
                const usCities = data.results.filter(item => item.country_code === 'US');
                dropdown.innerHTML = usCities.map(city => 
                    `<li onclick="selectLocation(${city.latitude}, ${city.longitude}, '${city.name}, ${city.admin1}')">
                        ${city.name}, ${city.admin1}
                    </li>`
                ).join('');
                dropdown.classList.remove('hidden');
            } else {
                dropdown.classList.add('hidden');
            }
        } catch (err) { console.error("Geocoding failed", err); }
    }, 300);
});

document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.add('hidden');
    }
});

function selectLocation(lat, lon, name) {
    localStorage.setItem('last_lat', lat);
    localStorage.setItem('last_lon', lon);
    localStorage.setItem('last_location_name', name);
    
    searchInput.value = name;
    dropdown.classList.add('hidden');
    document.getElementById('toggle-advanced-btn').classList.remove('hidden');
    
    refreshDashboard();
}

// --- MASTER REFRESH ENGINE ---
async function refreshDashboard() {
    if (!navigator.onLine) return; 

    const lat = localStorage.getItem('last_lat'); 
    const lon = localStorage.getItem('last_lon');
    const locName = localStorage.getItem('last_location_name');

    if (!lat || !lon) return; // Halt if no city searched

    searchInput.value = locName;

    // Set UI to "Scanning" so user physically sees the engine processing
    const scanState = document.getElementById('scan-state');
    scanState.innerText = "SCANNING...";
    scanState.className = "state-idle";

    // Concurrently fetch all data streams
    const [localAlerts, localAtmosphere, nationalAlerts] = await Promise.all([
        fetchLocalWarnings(lat, lon),
        fetchAtmosphere(lat, lon),
        fetchNationalScanner()
    ]);

    const decision = calculateDecisionEngine(localAlerts || 1, localAtmosphere || { dewPoint: 0, cape: 0, windGusts: 0, weatherCode: 0 });
    
    renderUI(decision, localAtmosphere);
    processNationalScanner(nationalAlerts || []);
    
    // Complete the feedback loop
    scanState.innerText = "ACTIVE";
    scanState.className = "state-active";
    document.getElementById('last-scan-time').innerText = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
    document.getElementById('toggle-advanced-btn').classList.remove('hidden');
    
    startHeartbeat(decision.finalThreatLevel);
}

// --- FETCH FUNCTIONS ---
async function fetchLocalWarnings(lat, lon) {
    try {
        // OPTIMIZATION: Cache-Buster appended to force raw, real-time NWS data
        const localUrl = `https://api.weather.gov/alerts/active?point=${lat},${lon}&_cb=${Date.now()}`;
        const res = await fetch(localUrl, { headers: { 'Accept': 'application/geo+json' }});
        if (!res.ok) throw new Error("Local NWS Error");
        const data = await res.json();
        return analyzeLocalThreats(data.features);
    } catch (e) { return null; }
}

async function fetchAtmosphere(lat, lon) {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,dew_point_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure,cape,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`;
        const res = await fetch(url);
        const data = await res.json();
        const cur = data.current;
        return {
            temp: cur.temperature_2m, 
            humidity: cur.relative_humidity_2m,
            dewPoint: cur.dew_point_2m, 
            windSpeed: cur.wind_speed_10m || 0,
            windDir: getCardinalDirection(cur.wind_direction_10m),
            windGusts: cur.wind_gusts_10m || 0,
            cape: cur.cape || 0, 
            weatherCode: cur.weather_code || 0,
            pressureInHg: (cur.surface_pressure * 0.02953).toFixed(2)
        };
    } catch (e) { return null; }
}

async function fetchNationalScanner() {
    try {
        // OPTIMIZATION: Cache-Buster appended here as well
        const nationalUrl = `${NWS_NATIONAL_BASE_URL}&_cb=${Date.now()}`;
        const res = await fetch(nationalUrl, { headers: { 'Accept': 'application/geo+json' }});
        const data = await res.json();
        return data.features;
    } catch (e) { return null; }
}

function getCardinalDirection(angle) {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return directions[Math.round(angle / 45) % 8];
}

// --- DECISION ENGINE LOGIC ---
function analyzeLocalThreats(features) {
    let highestThreat = 1;
    const severeEvents = ["Tornado Warning", "Severe Thunderstorm Warning", "Tornado Watch", "Severe Thunderstorm Watch"];
    
    features.forEach(alert => {
        const p = alert.properties;
        if (severeEvents.includes(p.event)) {
            const text = (p.description + " " + (p.instruction || "")).toUpperCase();
            const isPDS = text.includes("PARTICULARLY DANGEROUS SITUATION");
            const isObserved = text.includes("OBSERVED");

            let weight = 1;
            if (p.event === "Tornado Watch" || p.event === "Severe Thunderstorm Watch") weight = 2;
            if (p.event === "Severe Thunderstorm Warning") weight = isPDS ? 4 : 3;
            if (p.event === "Tornado Warning") weight = (isPDS || isObserved) ? 5 : 4;
            
            if (weight > highestThreat) highestThreat = weight;
        }
    });
    return highestThreat;
}

function calculateDecisionEngine(nwsLevel, atm) {
    let out = { finalThreatLevel: nwsLevel, actionDirective: "CONDITIONS CLEAR", tooltipText: "No active severe warnings for this location." };
    const isHighFuel = atm.dewPoint >= 65 && atm.cape >= 1000;
    
    // Check raw WMO codes for thunderstorms (95, 96, 99)
    const isLocalStorm = atm.weatherCode === 95 || atm.weatherCode === 96 || atm.weatherCode === 99;

    if (nwsLevel === 5) {
        out.actionDirective = "IMMINENT DANGER"; out.tooltipText = "PDS or Observed Tornado on the ground. Seek shelter immediately.";
    } else if (nwsLevel === 4) {
        out.actionDirective = "TAKE COVER"; out.tooltipText = "Radar indicates rotational winds or destructive severe storm.";
    } else if (nwsLevel === 3) {
        out.actionDirective = "STAY INDOORS"; out.tooltipText = "Severe thunderstorm warning active for your area.";
    } else if (nwsLevel === 2) {
        out.actionDirective = "WATCH ISSUED"; out.tooltipText = "Conditions favorable for severe weather. Stay alert.";
    } else if (nwsLevel === 1) {
        if (isLocalStorm) {
            out.finalThreatLevel = 2;
            out.actionDirective = "LOCAL STORM DETECTED"; 
            out.tooltipText = "NWS is clear, but meteorological data detects an active thunderstorm.";
        } else if (isHighFuel) {
            out.finalThreatLevel = 2; 
            out.actionDirective = "STORM FUEL HIGH"; 
            out.tooltipText = `High atmospheric fuel detected locally. Monitor closely.`;
        }
    }
    return out;
}

// --- UI RENDERING ---
function renderUI(decision, atm) {
    document.body.className = `threat-level-${decision.finalThreatLevel}`;
    document.getElementById('threat-badge').innerText = `LEVEL ${decision.finalThreatLevel}`;
    document.getElementById('action-directive').innerText = decision.actionDirective;
    document.getElementById('engine-tooltip').innerText = decision.tooltipText;

    if (atm && atm.temp !== undefined) {
        document.getElementById('current-temp').innerText = Math.round(atm.temp);
        document.getElementById('current-wind').innerText = Math.round(atm.windSpeed);
        document.getElementById('wind-dir').innerText = atm.windDir;
        document.getElementById('pro-gusts').innerText = Math.round(atm.windGusts);
        
        document.getElementById('current-humidity').innerText = Math.round(atm.humidity);
        document.getElementById('pro-pressure').innerText = atm.pressureInHg;
        document.getElementById('pro-dewpoint').innerText = Math.round(atm.dewPoint);
    }
}

// --- NATIONAL SCANNER & MODAL LOGIC ---
function processNationalScanner(features) {
    const feed = document.getElementById('scanner-feed');
    if (!features || features.length === 0) {
        feed.innerHTML = `<p class="empty-state">No active severe warnings or watches nationwide.</p>`;
        return;
    }

    window.scannerStatements = features.map(f => {
        const p = f.properties;
        const text = (p.description + "\n\n" + (p.instruction || "")).toUpperCase();
        return {
            event: p.event,
            area: p.areaDesc,
            isPDS: text.includes("PARTICULARLY DANGEROUS"),
            isObserved: text.includes("OBSERVED") || text.includes("CONFIRMED"),
            rawText: p.description + "\n\n" + (p.instruction || "No specific instructions provided."),
            weight: getSortWeight(p.event, text)
        };
    }).sort((a, b) => b.weight - a.weight);

    feed.innerHTML = window.scannerStatements.map((w, index) => {
        let tag = w.event.toUpperCase();
        if (w.isPDS || w.isObserved) tag = '⚠️ PDS / OBSERVED TORNADO';
        
        let cardClass = 'scanner-card';
        if (w.weight === 5) cardClass += ' pds-card';
        if (w.event === 'Tornado Watch') cardClass += ' watch-card';

        return `
        <div class="${cardClass}">
            <div style="display: flex; justify-content: space-between; align-items: start; text-align: left;">
                <div>
                    <span class="status-tag">${tag}</span>
                    <h4>${w.area}</h4>
                </div>
                <button class="glass-btn-sm" onclick="openStatementModal(${index})" style="padding: 4px 8px; font-size: 0.7rem; flex-shrink: 0; margin-left: 10px;">Read</button>
            </div>
        </div>
        `;
    }).join('');
}

function getSortWeight(event, text) {
    if (event === "Tornado Warning") return (text.includes("PDS") || text.includes("OBSERVED")) ? 5 : 4;
    if (event === "Severe Thunderstorm Warning") return text.includes("PDS") ? 4 : 3;
    if (event === "Tornado Watch") return 2;
    return 1;
}

function openStatementModal(index) {
    const statement = window.scannerStatements[index];
    document.getElementById('modal-title').innerText = statement.event;
    document.getElementById('modal-body').innerText = statement.rawText;
    document.getElementById('statement-modal').classList.remove('hidden');
}

function closeStatementModal() {
    document.getElementById('statement-modal').classList.add('hidden');
}

// --- HEARTBEAT ---
function startHeartbeat(level) {
    let int = 300000; 
    if (level >= 4) int = 60000; 
    if (window.refreshTimer) clearInterval(window.refreshTimer);
    window.refreshTimer = setInterval(refreshDashboard, int);
}

// Kickoff
updateNetworkStatus();
refreshDashboard();
