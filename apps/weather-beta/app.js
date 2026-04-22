// ==========================================
// STATE & CACHE VARIABLES
// ==========================================
let lat = localStorage.getItem('weather_lat') || null; 
let lon = localStorage.getItem('weather_lon') || null;
let currentLocationText = localStorage.getItem('weather_loc_text') || null;

let currentThreatLevel = 1;
let syncTimer = null;
let localAlerts = []; 
let nationalAlerts = [];

// Initialize Application
if (lat && lon) {
    document.getElementById('location-display').innerText = currentLocationText;
    fetchLiveWeather();
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================
function getWindDirection(degrees) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(degrees / 45) % 8];
}

function toggleProMode() {
    const isPro = document.getElementById('pro-toggle').checked;
    const proElements = document.querySelectorAll('.pro-data');
    
    proElements.forEach(el => {
        if (isPro) el.classList.remove('hidden');
        else el.classList.add('hidden');
    });

    if (isPro) fetchNationalScanner();
}

// ==========================================
// SEARCH & AUTOCOMPLETE LOGIC
// ==========================================
let searchTimeout;
const locationInput = document.getElementById('location-input');
const autocompleteList = document.getElementById('autocomplete-list');

function executeSearch() {
    const query = locationInput.value.trim();
    if (/^\d{5}$/.test(query)) {
        processZipCode(query);
    } else if (query.length > 2) {
        fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1`)
            .then(res => res.json())
            .then(data => {
                if(data.results && data.results.length > 0) {
                    const loc = data.results[0];
                    setLocation(loc.latitude, loc.longitude, `${loc.name}, ${loc.admin1}`);
                } else { alert("Location not found."); }
            });
    }
}

locationInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    autocompleteList.innerHTML = '';
    
    if (query.length < 3) return;

    searchTimeout = setTimeout(async () => {
        if (/^\d{5}$/.test(query)) return; 

        try {
            const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5`);
            const data = await res.json();
            if (data.results) {
                const usResults = data.results.filter(loc => loc.country_code === 'US');
                usResults.forEach(loc => {
                    const item = document.createElement('div');
                    item.className = 'autocomplete-item';
                    item.innerText = `${loc.name}, ${loc.admin1}`;
                    item.onclick = () => { setLocation(loc.latitude, loc.longitude, `${loc.name}, ${loc.admin1}`); };
                    autocompleteList.appendChild(item);
                });
            }
        } catch (err) { console.error(err); }
    }, 300);
});

async function processZipCode(zip) {
    try {
        const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
        if (!res.ok) throw new Error("Not found");
        const data = await res.json();
        setLocation(data.places[0].latitude, data.places[0].longitude, `${data.places[0]["place name"]}, ${data.places[0]["state abbreviation"]} (${zip})`);
    } catch (e) { alert("Invalid US ZIP Code."); }
}

function setLocation(newLat, newLon, text) {
    lat = newLat; lon = newLon; currentLocationText = text;
    autocompleteList.innerHTML = ''; locationInput.value = '';
    document.getElementById('location-display').innerText = currentLocationText;
    
    localStorage.setItem('weather_lat', lat);
    localStorage.setItem('weather_lon', lon);
    localStorage.setItem('weather_loc_text', currentLocationText);
    
    fetchLiveWeather();
}

document.addEventListener('click', (e) => { 
    if(!e.target.closest('.search-section')) autocompleteList.innerHTML = ''; 
});

// ==========================================
// CORE DATA FETCHING (Open-Meteo + NWS)
// ==========================================
async function fetchLiveWeather() {
    if (!lat || !lon) return;

    document.getElementById('val-time').innerText = "Syncing...";

    try {
        // 1. Meteo Data
        const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,wind_speed_10m,wind_direction_10m,relative_humidity_2m,dew_point_2m,surface_pressure&temperature_unit=fahrenheit&wind_speed_unit=mph`;
        const meteoRes = await fetch(meteoUrl);
        const meteoData = await meteoRes.json();
        const current = meteoData.current;

        // UI Updates
        document.getElementById('val-temp').innerText = `${Math.round(current.temperature_2m)}°F`;
        document.getElementById('val-feel').innerText = `${Math.round(current.apparent_temperature)}°F`;
        document.getElementById('val-wind').innerText = `${Math.round(current.wind_speed_10m)} mph`;
        document.getElementById('val-wind-dir').innerText = getWindDirection(current.wind_direction_10m);
        
        document.getElementById('val-dew').innerText = `${Math.round(current.dew_point_2m)}°F`;
        document.getElementById('val-humidity').innerText = `${current.relative_humidity_2m}%`;
        document.getElementById('val-pressure').innerText = `${(current.surface_pressure * 0.02953).toFixed(2)} inHg`;

        // Beginner Storm Fuel Indicator (Dew Point > 65)
        const fuelBadge = document.getElementById('fuel-indicator');
        if (current.dew_point_2m >= 65) fuelBadge.classList.remove('hidden');
        else fuelBadge.classList.add('hidden');

        const now = new Date();
        document.getElementById('val-time').innerText = `${now.toLocaleTimeString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`;

        // 2. Local NWS Alerts
        const nwsRes = await fetch(`https://api.weather.gov/alerts/active?point=${lat},${lon}`);
        const nwsData = await nwsRes.json();
        
        localAlerts = nwsData.features || [];
        processThreatLevel(localAlerts);
        renderLocalBulletins();

        // Sync Clock
        syncWithDeviceClock();

    } catch (error) {
        console.error("Fetch Error:", error);
        document.getElementById('val-time').innerText = "Network Error";
    }
}

// ==========================================
// THREAT LEVEL LOGIC & AMBIENT GLOW
// ==========================================
function processThreatLevel(alerts) {
    let maxLevel = 1; 
    
    alerts.forEach(alert => {
        const event = alert.properties.event.toUpperCase();
        const desc = (alert.properties.description || "").toUpperCase();
        
        if (event.includes("TORNADO WARNING") && (desc.includes("OBSERVED") || desc.includes("PARTICULARLY DANGEROUS SITUATION") || event.includes("EMERGENCY"))) {
            maxLevel = Math.max(maxLevel, 5);
        } 
        else if (event.includes("TORNADO WARNING")) { maxLevel = Math.max(maxLevel, 4); } 
        else if (event.includes("SEVERE THUNDERSTORM WARNING") || event.includes("FLASH FLOOD WARNING")) { maxLevel = Math.max(maxLevel, 3); } 
        else if (event.includes("WATCH") || event.includes("ADVISORY") || event.includes("STATEMENT")) { maxLevel = Math.max(maxLevel, 2); }
    });

    currentThreatLevel = maxLevel;

    // AMBIENT GLOW LOGIC
    document.body.classList.remove('theme-blue', 'theme-green', 'theme-red');
    if (currentThreatLevel === 1 || currentThreatLevel === 2) document.body.classList.add('theme-blue');
    else if (currentThreatLevel === 3 || currentThreatLevel === 4) document.body.classList.add('theme-green');
    else if (currentThreatLevel === 5) document.body.classList.add('theme-red');

    // THREAT PILL LOGIC
    const indicator = document.getElementById('threat-indicator');
    const descriptions = [
        "Level 1: Calm", 
        "Level 2: Concerned (Be Aware)", 
        "Level 3: Elevated (Warned)", 
        "Level 4: Take Action (Tornado)", 
        "Level 5: IMMINENT DANGER"
    ];
    
    indicator.className = `threat-pill level-${currentThreatLevel}`;
    indicator.innerText = descriptions[currentThreatLevel - 1];
}

function getAlertColorByLevel(alert) {
    const event = alert.properties.event.toUpperCase();
    const desc = (alert.properties.description || "").toUpperCase();
    
    if (event.includes("TORNADO WARNING") && (desc.includes("OBSERVED") || desc.includes("PARTICULARLY DANGEROUS SITUATION"))) return "var(--level-5)";
    if (event.includes("TORNADO WARNING")) return "var(--level-4)";
    if (event.includes("SEVERE THUNDERSTORM WARNING") || event.includes("FLASH FLOOD WARNING")) return "var(--level-3)";
    if (event.includes("WATCH") || event.includes("ADVISORY")) return "var(--level-2)";
    return "var(--text-main)";
}

// ==========================================
// RENDERERS & MODALS
// ==========================================
function renderLocalBulletins() {
    const box = document.getElementById('local-bulletins');
    const viewAllBtn = document.getElementById('view-all-bulletins-btn');
    box.innerHTML = '';

    if (localAlerts.length === 0) {
        box.innerHTML = '<p class="alert-text-muted">No active bulletins for this location.</p>';
        viewAllBtn.classList.add('hidden');
        return;
    }

    localAlerts.slice(0, 5).forEach((alert, index) => {
        const color = getAlertColorByLevel(alert);
        const summary = alert.properties.headline || alert.properties.event;
        
        box.innerHTML += `
            <div class="bulletin-item" style="border-left-color: ${color}">
                <h4 style="color: ${color}">${alert.properties.event}</h4>
                <p>${summary}</p>
                <span class="read-more-link" onclick="openStatementReader(${index}, 'local')">Read Full Statement</span>
            </div>`;
    });

    if (localAlerts.length > 5) {
        viewAllBtn.classList.remove('hidden');
        viewAllBtn.innerText = `View All ${localAlerts.length} Alerts`;
    } else {
        viewAllBtn.classList.add('hidden');
    }
}

// ==========================================
// PRO MODE: NATIONAL SCANNER
// ==========================================
async function fetchNationalScanner() {
    const resultsBox = document.getElementById('national-scanner-results');
    resultsBox.innerHTML = "Scanning National Weather Service...";

    try {
        const res = await fetch(`https://api.weather.gov/alerts/active?event=Tornado%20Warning,Severe%20Thunderstorm%20Warning`);
        const data = await res.json();
        
        nationalAlerts = data.features || [];

        if (nationalAlerts.length === 0) {
            resultsBox.innerHTML = `<span style="color:var(--level-1)">Nationwide Clear: No Level 3, 4, or 5 events detected.</span>`;
            return;
        }

        nationalAlerts.sort((a, b) => getNumericLevel(b) - getNumericLevel(a));

        let html = "";
        nationalAlerts.forEach((alert, index) => {
            const color = getAlertColorByLevel(alert);
            const level = getNumericLevel(alert);
            const badge = level === 5 ? `<span style="background:var(--level-5); color:#fff; padding:2px 6px; border-radius:4px; font-size:0.8em; margin-left:5px;">OBSERVED / PDS</span>` : "";
            
            html += `
                <div class="bulletin-item" style="border-left-color: ${color};">
                    <h4 style="color: ${color};">${alert.properties.event} ${badge}</h4>
                    <p style="font-size: 0.85em; margin-bottom: 5px;">${alert.properties.areaDesc}</p>
                    <span class="read-more-link" onclick="openStatementReader(${index}, 'national')">Read Data</span>
                </div>`;
        });
        resultsBox.innerHTML = html;

    } catch (error) {
        resultsBox.innerHTML = "Error loading national tracker.";
    }
}

function getNumericLevel(alert) {
    const color = getAlertColorByLevel(alert);
    if(color === "var(--level-5)") return 5;
    if(color === "var(--level-4)") return 4;
    if(color === "var(--level-3)") return 3;
    return 2;
}

// ==========================================
// MODAL CONTROLS
// ==========================================
function openStatementReader(index, source) {
    const alert = source === 'local' ? localAlerts[index] : nationalAlerts[index];
    document.getElementById('modal-alert-title').innerText = alert.properties.event;
    
    let fullText = alert.properties.description || "No detailed description provided.";
    if (alert.properties.instruction) fullText += "\n\nINSTRUCTIONS:\n" + alert.properties.instruction;
    
    document.getElementById('modal-bulletin-list').innerText = fullText;
    document.getElementById('bulletin-modal').classList.remove('hidden');
}

function openAllBulletins() {
    document.getElementById('modal-alert-title').innerText = "All Local Alerts";
    let listHTML = "";
    localAlerts.forEach(alert => {
        listHTML += `[${alert.properties.event}]\n${alert.properties.description || alert.properties.headline}\n\n`;
    });
    document.getElementById('modal-bulletin-list').innerText = listHTML;
    document.getElementById('bulletin-modal').classList.remove('hidden');
}

function closeBulletinModal() { document.getElementById('bulletin-modal').classList.add('hidden'); }

// ==========================================
// AUTO-REFRESH CLOCK SYNC
// ==========================================
function syncWithDeviceClock() {
    if (syncTimer) clearTimeout(syncTimer);

    let refreshIntervalMins = 5; 
    if (currentThreatLevel === 3 || currentThreatLevel === 4) refreshIntervalMins = 3;
    if (currentThreatLevel === 5) refreshIntervalMins = 1;

    const now = new Date();
    const currentMin = now.getMinutes();
    const currentSec = now.getSeconds();
    
    let minsUntilNext = refreshIntervalMins - (currentMin % refreshIntervalMins);
    let msUntilRefresh = (minsUntilNext * 60 * 1000) - (currentSec * 1000);
    if (msUntilRefresh < 10000) msUntilRefresh += (refreshIntervalMins * 60 * 1000);

    syncTimer = setTimeout(() => {
        fetchLiveWeather();
        if(document.getElementById('pro-toggle').checked) fetchNationalScanner();
    }, msUntilRefresh);
}
