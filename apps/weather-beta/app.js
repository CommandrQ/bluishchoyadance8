// --- CONFIGURATION ---
const NWS_NATIONAL_URL = 'https://api.weather.gov/alerts/active?event=Tornado%20Warning,Severe%20Thunderstorm%20Warning,Tornado%20Watch,Blizzard%20Warning,Hurricane%20Warning';
window.scannerStatements = [];

window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const searchInput = document.getElementById('location-search');
        if (searchInput) searchInput.focus();
    }, 150);
});

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/apps/weather-beta/sw.js').catch(e => console.error(e)));
}

window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

function updateNetworkStatus() {
    const banner = document.getElementById('offline-banner');
    const scanState = document.getElementById('scan-state');
    if (navigator.onLine) {
        banner.classList.add('hidden');
        if(localStorage.getItem('last_lat')) {
            scanState.innerText = "ACTIVE"; scanState.className = "state-active";
            refreshDashboard();
        }
    } else {
        banner.classList.remove('hidden');
        scanState.innerText = "OFFLINE"; scanState.className = "state-offline";
    }
}

// --- UI EVENT LISTENERS ---
document.getElementById('toggle-advanced-btn').addEventListener('click', (e) => {
    const advSection = document.getElementById('advanced-metrics');
    if (advSection.classList.contains('hidden')) {
        advSection.classList.remove('hidden');
        e.target.innerText = "Hide Advanced Metrics";
    } else {
        advSection.classList.add('hidden');
        e.target.innerText = "Show Advanced Metrics";
    }
});

document.getElementById('manual-refresh-btn').addEventListener('click', () => {
    const btn = document.getElementById('manual-refresh-btn');
    btn.style.transform = 'rotate(180deg)';
    btn.style.transition = 'transform 0.4s ease';
    setTimeout(() => { btn.style.transition = 'none'; btn.style.transform = 'rotate(0deg)'; }, 400);
    refreshDashboard();
});

// --- AUTOCOMPLETE LOGIC ---
const searchInput = document.getElementById('location-search');
const dropdown = document.getElementById('autocomplete-dropdown');
let debounceTimer;

searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    clearTimeout(debounceTimer);
    if (query.length < 3) { dropdown.classList.add('hidden'); return; }

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
            } else { dropdown.classList.add('hidden'); }
        } catch (err) {}
    }, 300);
});

document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) dropdown.classList.add('hidden');
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
    if (!lat || !lon) return; 

    searchInput.value = locName;
    document.getElementById('scan-state').innerText = "SCANNING...";
    document.getElementById('scan-state').className = "state-idle";

    const [localAlerts, localAtmosphere, nationalAlerts] = await Promise.all([
        fetchLocalWarnings(lat, lon),
        fetchAtmosphere(lat, lon),
        fetchNationalScanner()
    ]);

    const decision = calculateDecisionEngine(localAlerts || [], localAtmosphere);
    
    renderUI(decision, localAtmosphere);
    processNationalScanner(nationalAlerts || []);
    
    document.getElementById('scan-state').innerText = "ACTIVE";
    document.getElementById('scan-state').className = "state-active";
    document.getElementById('last-scan-time').innerText = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
    document.getElementById('toggle-advanced-btn').classList.remove('hidden');
    
    startHeartbeat(decision.level);
}

// --- FETCH FUNCTIONS ---
async function fetchLocalWarnings(lat, lon) {
    try {
        const localUrl = `https://api.weather.gov/alerts/active?point=${lat},${lon}&_cb=${Date.now()}`;
        const res = await fetch(localUrl, { headers: { 'Accept': 'application/geo+json' }});
        const data = await res.json();
        return data.features || [];
    } catch (e) { return []; }
}

async function fetchAtmosphere(lat, lon) {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,dew_point_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure,cape,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`;
        const res = await fetch(url);
        const data = await res.json();
        const cur = data.current;
        return {
            temp: cur.temperature_2m, humidity: cur.relative_humidity_2m,
            dewPoint: cur.dew_point_2m, windSpeed: cur.wind_speed_10m,
            windDir: getCardinalDirection(cur.wind_direction_10m),
            cape: cur.cape || 0, weatherCode: cur.weather_code || 0,
            statusText: decodeWeatherCode(cur.weather_code || 0),
            pressureInHg: (cur.surface_pressure * 0.02953).toFixed(2)
        };
    } catch (e) { return null; }
}

async function fetchNationalScanner() {
    try {
        const res = await fetch(`${NWS_NATIONAL_URL}&_cb=${Date.now()}`, { headers: { 'Accept': 'application/geo+json' }});
        const data = await res.json();
        return data.features || [];
    } catch (e) { return []; }
}

function getCardinalDirection(angle) {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return directions[Math.round(angle / 45) % 8];
}

function decodeWeatherCode(code) {
    // WMO Weather interpretation codes
    if (code === 0) return "Clear Sky";
    if (code <= 3) return "Partly Cloudy";
    if (code <= 49) return "Fog / Overcast";
    if (code <= 69) return "Rain";
    if (code <= 79) return "Snow";
    if (code <= 82) return "Heavy Rain Showers";
    if (code <= 86) return "Heavy Snow Showers";
    if (code >= 95) return "Thunderstorm";
    return "Unknown";
}

// --- MODULAR EXPANDABLE DECISION ENGINE ---
// Pure Logic: We build an array of potential threats. The highest severity wins.
function calculateDecisionEngine(nwsAlerts, atm) {
    let activeThreats = [];

    // 1. Evaluate Atmospheric Physics (Base Triggers)
    if (atm) {
        if (atm.weatherCode >= 95) {
            activeThreats.push({ level: 2, directive: "LOCAL STORM DETECTED", tooltip: "Thunderstorm active in your area. Monitor conditions." });
        } else if (atm.dewPoint >= 65 && atm.cape >= 1000) {
            activeThreats.push({ level: 2, directive: "STORM FUEL HIGH", tooltip: "High atmospheric fuel detected locally. Stay alert." });
        }
    }

    // 2. Evaluate NWS Polygons
    nwsAlerts.forEach(alert => {
        const event = alert.properties.event;
        const text = (alert.properties.description + " " + (alert.properties.instruction || "")).toUpperCase();
        const isPDS = text.includes("PARTICULARLY DANGEROUS SITUATION");
        const isObserved = text.includes("OBSERVED");

        // Easily expandable logic block
        if (event === "Tornado Warning") {
            if (isPDS || isObserved) activeThreats.push({ level: 5, directive: "IMMINENT DANGER", tooltip: "Observed Tornado. Seek underground shelter immediately!" });
            else activeThreats.push({ level: 4, directive: "TAKE COVER", tooltip: "Radar indicated Tornado Warning. Move to an interior room." });
        }
        else if (event === "Severe Thunderstorm Warning") {
            if (isPDS) activeThreats.push({ level: 4, directive: "DESTRUCTIVE STORM", tooltip: "PDS Severe Thunderstorm. Destructive winds/hail imminent." });
            else activeThreats.push({ level: 3, directive: "STAY INDOORS", tooltip: "Severe thunderstorm warning active for your area." });
        }
        else if (event.includes("Watch")) {
            activeThreats.push({ level: 2, directive: "WATCH ISSUED", tooltip: `${event} in effect. Conditions are favorable for severe weather.` });
        }
        // Expandability Example: Hurricanes/Blizzards
        else if (event === "Hurricane Warning" || event === "Blizzard Warning") {
            activeThreats.push({ level: 4, directive: "PREPARE FOR IMPACT", tooltip: `${event} active. Extreme conditions expected.` });
        }
    });

    // 3. Resolve the highest threat
    if (activeThreats.length === 0) {
        return { level: 1, directive: "CONDITIONS CLEAR", tooltip: "No severe weather indicators active." };
    }

    // Sort by level descending and return the top threat
    activeThreats.sort((a, b) => b.level - a.level);
    return activeThreats[0];
}

// --- UI RENDERING ---
function renderUI(decision, atm) {
    // Set Body and Pulse classes
    document.body.className = `threat-level-${decision.level}`;
    document.getElementById('threat-badge').innerText = `LEVEL ${decision.level}`;
    document.getElementById('action-directive').innerText = decision.directive;
    document.getElementById('engine-tooltip').innerText = decision.tooltip;

    if (atm) {
        document.getElementById('current-temp').innerText = Math.round(atm.temp);
        document.getElementById('current-wind').innerText = Math.round(atm.windSpeed);
        document.getElementById('wind-dir').innerText = atm.windDir;
        document.getElementById('weather-status').innerText = atm.statusText;
        
        document.getElementById('current-humidity').innerText = Math.round(atm.humidity);
        document.getElementById('pro-pressure').innerText = atm.pressureInHg;
        document.getElementById('pro-dewpoint').innerText = Math.round(atm.dewPoint);
    }
}

// --- NATIONAL SCANNER LOGIC ---
function processNationalScanner(features) {
    const feed = document.getElementById('scanner-feed');
    if (!features || features.length === 0) {
        feed.innerHTML = `<p class="empty-state">No active severe warnings nationwide.</p>`;
        return;
    }

    window.scannerStatements = features.map(f => {
        const p = f.properties;
        const text = (p.description + "\n\n" + (p.instruction || "")).toUpperCase();
        return {
            event: p.event, area: p.areaDesc,
            isPDS: text.includes("PARTICULARLY DANGEROUS"),
            isObserved: text.includes("OBSERVED") || text.includes("CONFIRMED"),
            rawText: p.description + "\n\n" + (p.instruction || "No specific instructions provided."),
            weight: getSortWeight(p.event, text)
        };
    }).sort((a, b) => b.weight - a.weight);

    feed.innerHTML = window.scannerStatements.map((w, index) => {
        let tag = w.event.toUpperCase();
        if (w.isPDS || w.isObserved) tag = '⚠️ PDS / OBSERVED';
        
        let cardClass = 'scanner-card';
        if (w.weight === 5) cardClass += ' pds-card';
        if (w.event.includes('Watch')) cardClass += ' watch-card';

        return `
        <div class="${cardClass}">
            <div style="display: flex; justify-content: space-between; align-items: start; text-align: left;">
                <div>
                    <span class="status-tag">${tag}</span>
                    <h4 style="font-size: 0.9rem; margin-top: 5px;">${w.area}</h4>
                </div>
                <button class="glass-btn-sm" onclick="openStatementModal(${index})" style="padding: 4px 8px; font-size: 0.7rem; flex-shrink: 0; margin-left: 10px;">Read</button>
            </div>
        </div>`;
    }).join('');
}

function getSortWeight(event, text) {
    if (event.includes("Tornado Warning")) return (text.includes("PDS") || text.includes("OBSERVED")) ? 5 : 4;
    if (event.includes("Severe Thunderstorm Warning")) return text.includes("PDS") ? 4 : 3;
    if (event.includes("Watch")) return 2;
    return 1; // Default for Blizzards/Hurricanes in the national feed until expanded
}

function openStatementModal(index) {
    const statement = window.scannerStatements[index];
    document.getElementById('modal-title').innerText = statement.event;
    document.getElementById('modal-body').innerText = statement.rawText;
    document.getElementById('statement-modal').classList.remove('hidden');
}

function closeStatementModal() { document.getElementById('statement-modal').classList.add('hidden'); }

// --- HEARTBEAT ---
function startHeartbeat(level) {
    let int = 300000; 
    if (level >= 4) int = 60000; 
    if (window.refreshTimer) clearInterval(window.refreshTimer);
    window.refreshTimer = setInterval(refreshDashboard, int);
}

updateNetworkStatus();
