// --- CONFIGURATION ---
const NWS_LOCAL_URL = 'https://api.weather.gov/alerts/active?event=Tornado%20Warning,Severe%20Thunderstorm%20Warning,Tornado%20Watch';
const NWS_NATIONAL_URL = 'https://api.weather.gov/alerts/active?event=Tornado%20Warning,Severe%20Thunderstorm%20Warning,Tornado%20Watch';

// --- SERVICE WORKER ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/apps/weather-beta/sw.js').catch(err => console.error(err)));
}

// --- UI TOGGLE LOGIC ---
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

// --- AUTOCOMPLETE SEARCH LOGIC ---
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
                // Filter for US locations and build the list
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
    }, 300); // 300ms delay to prevent API spam
});

// Close dropdown if clicking outside
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
    refreshDashboard();
}

// --- MASTER REFRESH ENGINE ---
async function refreshDashboard() {
    const lat = localStorage.getItem('last_lat') || "37.9887"; 
    const lon = localStorage.getItem('last_lon') || "-85.9589";
    const locName = localStorage.getItem('last_location_name') || "Default Location";
    searchInput.value = locName;

    const [localAlerts, localAtmosphere, nationalAlerts] = await Promise.all([
        fetchLocalWarnings(lat, lon),
        fetchAtmosphere(lat, lon),
        fetchNationalScanner()
    ]);

    const decision = calculateDecisionEngine(localAlerts || 1, localAtmosphere || { dewPoint: 0, cape: 0, windGusts: 0 });
    
    renderUI(decision, localAtmosphere);
    processNationalScanner(nationalAlerts || []);
    
    startHeartbeat(decision.finalThreatLevel);
}

// --- FETCH FUNCTIONS ---
async function fetchLocalWarnings(lat, lon) {
    try {
        const res = await fetch(NWS_LOCAL_URL, { headers: { 'Accept': 'application/geo+json' }});
        if (!res.ok) throw new Error("Local NWS Error");
        const data = await res.json();
        return analyzeThreatLevels(data.features);
    } catch (e) { return null; }
}

async function fetchAtmosphere(lat, lon) {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,dew_point_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure,cape&wind_speed_unit=mph&timezone=auto`;
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
            pressureInHg: (cur.surface_pressure * 0.02953).toFixed(2)
        };
    } catch (e) { return null; }
}

async function fetchNationalScanner() {
    try {
        const res = await fetch(NWS_NATIONAL_URL, { headers: { 'Accept': 'application/geo+json' }});
        const data = await res.json();
        return data.features;
    } catch (e) { return null; }
}

// Helper: Convert degrees to compass direction
function getCardinalDirection(angle) {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return directions[Math.round(angle / 45) % 8];
}

// --- DECISION ENGINE LOGIC ---
function analyzeThreatLevels(features) {
    let highestThreat = 1;
    features.forEach(alert => {
        const p = alert.properties;
        const text = (p.description + " " + p.instruction).toUpperCase();
        const isPDS = text.includes("PARTICULARLY DANGEROUS SITUATION");
        const isObserved = text.includes("OBSERVED");

        let weight = 1;
        if (p.event === "Tornado Watch") weight = 2;
        if (p.event === "Severe Thunderstorm Warning") weight = isPDS ? 4 : 3;
        if (p.event === "Tornado Warning") weight = (isPDS || isObserved) ? 5 : 4;
        
        if (weight > highestThreat) highestThreat = weight;
    });
    return highestThreat;
}

function calculateDecisionEngine(nwsLevel, atm) {
    let out = { finalThreatLevel: nwsLevel, actionDirective: "CONDITIONS CLEAR", tooltipText: "No active warnings." };
    const isHighFuel = atm.dewPoint >= 65 && atm.cape >= 1000;

    if (nwsLevel === 5) {
        out.actionDirective = "IMMINENT DANGER"; out.tooltipText = "PDS or Observed Tornado on the ground. Seek shelter immediately.";
    } else if (nwsLevel === 4) {
        out.actionDirective = "TAKE COVER"; out.tooltipText = "Radar indicates rotational winds or destructive severe storm.";
    } else if (nwsLevel === 3) {
        out.actionDirective = "STAY INDOORS"; out.tooltipText = "Severe thunderstorm warning active.";
    } else if (nwsLevel <= 2 && isHighFuel) {
        out.finalThreatLevel = 2; out.actionDirective = "STORM FUEL HIGH"; out.tooltipText = `High atmospheric fuel detected. Monitor closely.`;
    } else if (nwsLevel === 2) {
        out.actionDirective = "WATCH ISSUED"; out.tooltipText = "Conditions favorable for severe weather. Stay alert.";
    }
    return out;
}

// --- UI RENDERING ---
function renderUI(decision, atm) {
    document.body.className = `threat-level-${decision.finalThreatLevel}`;
    document.getElementById('threat-badge').innerText = `LEVEL ${decision.finalThreatLevel}`;
    document.getElementById('action-directive').innerText = decision.actionDirective;
    document.getElementById('engine-tooltip').innerText = decision.tooltipText;

    if (atm) {
        // Basic Stats
        document.getElementById('current-temp').innerText = Math.round(atm.temp);
        document.getElementById('current-wind').innerText = Math.round(atm.windSpeed);
        document.getElementById('wind-dir').innerText = atm.windDir;
        document.getElementById('current-humidity').innerText = Math.round(atm.humidity);
        
        // Advanced Stats
        document.getElementById('pro-gusts').innerText = Math.round(atm.windGusts);
        document.getElementById('pro-pressure').innerText = atm.pressureInHg;
        document.getElementById('pro-dewpoint').innerText = Math.round(atm.dewPoint);
    }
}

// --- NATIONAL SCANNER LOGIC ---
function processNationalScanner(features) {
    const feed = document.getElementById('scanner-feed');
    if (!features || features.length === 0) {
        feed.innerHTML = `<p class="empty-state">No active severe warnings or watches.</p>`;
        return;
    }

    let sorted = features.map(f => {
        const p = f.properties;
        const text = (p.description + " " + p.instruction || "").toUpperCase();
        return {
            event: p.event,
            area: p.areaDesc,
            isPDS: text.includes("PARTICULARLY DANGEROUS"),
            isObserved: text.includes("OBSERVED") || text.includes("CONFIRMED"),
            weight: getSortWeight(p.event, text)
        };
    }).sort((a, b) => b.weight - a.weight);

    feed.innerHTML = sorted.map(w => {
        let tag = w.event.toUpperCase();
        if (w.isPDS || w.isObserved) tag = '⚠️ PDS / OBSERVED TORNADO';
        
        let cardClass = 'scanner-card';
        if (w.weight === 5) cardClass += ' pds-card';
        if (w.event === 'Tornado Watch') cardClass += ' watch-card';

        return `
        <div class="${cardClass}">
            <span class="status-tag">${tag}</span>
            <h4>${w.area}</h4>
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

// --- HEARTBEAT ---
function startHeartbeat(level) {
    let int = 300000; 
    if (level >= 4) int = 60000; 
    if (window.refreshTimer) clearInterval(window.refreshTimer);
    window.refreshTimer = setInterval(refreshDashboard, int);
}

// Kickoff
refreshDashboard();
