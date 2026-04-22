// ==========================================
// STATE & CACHE VARIABLES
// ==========================================
let lat = localStorage.getItem('weather_lat') || null; 
let lon = localStorage.getItem('weather_lon') || null;
let currentLocationText = localStorage.getItem('weather_loc_text') || null;

let currentThreatLevel = 1;
let syncTimer = null;
let allActiveAlerts = []; 

// Initialize on Load
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
    const proElements = document.querySelectorAll('.pro-data');
    const btn = document.querySelector('.toggle-pro');
    let isHidden = false;
    
    proElements.forEach(el => {
        el.classList.toggle('hidden');
        if (el.classList.contains('hidden')) isHidden = true;
    });
    
    btn.innerText = isHidden ? "Enable Pro Mode" : "Disable Pro Mode";
}

// ==========================================
// AUTOCOMPLETE & SEARCH (City or ZIP)
// ==========================================
let searchTimeout;
const locationInput = document.getElementById('location-input');
const autocompleteList = document.getElementById('autocomplete-list');

locationInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    autocompleteList.innerHTML = '';
    
    if (query.length < 3) return;

    searchTimeout = setTimeout(async () => {
        // If it's a 5-digit ZIP, handle instantly without dropdown
        if (/^\d{5}$/.test(query)) {
            processZipCode(query);
            return;
        }

        // Otherwise, Autocomplete City search
        try {
            const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5`);
            const data = await res.json();
            if (data.results) {
                const usResults = data.results.filter(loc => loc.country_code === 'US');
                usResults.forEach(loc => {
                    const item = document.createElement('div');
                    item.className = 'autocomplete-item';
                    item.innerText = `${loc.name}, ${loc.admin1}`;
                    item.onclick = () => {
                        lat = loc.latitude; lon = loc.longitude;
                        currentLocationText = `${loc.name}, ${loc.admin1}`;
                        saveAndFetch();
                    };
                    autocompleteList.appendChild(item);
                });
            }
        } catch (err) { console.error("Geocoding Error", err); }
    }, 400);
});

async function processZipCode(zip) {
    try {
        const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
        if (!res.ok) throw new Error("ZIP not found");
        const data = await res.json();
        lat = data.places[0].latitude;
        lon = data.places[0].longitude;
        currentLocationText = `${data.places[0]["place name"]}, ${data.places[0]["state abbreviation"]} (${zip})`;
        saveAndFetch();
    } catch (e) {
        alert("Invalid ZIP Code.");
    }
}

function saveAndFetch() {
    autocompleteList.innerHTML = '';
    locationInput.value = '';
    document.getElementById('location-display').innerText = currentLocationText;
    localStorage.setItem('weather_lat', lat);
    localStorage.setItem('weather_lon', lon);
    localStorage.setItem('weather_loc_text', currentLocationText);
    fetchLiveWeather();
}

// Hide autocomplete on click outside
document.addEventListener('click', (e) => { if(e.target !== locationInput) autocompleteList.innerHTML = ''; });

// ==========================================
// CORE DATA & THREAT LOGIC
// ==========================================
async function fetchLiveWeather() {
    if (!lat || !lon) return;

    try {
        // 1. Fetch Weather Data
        const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,wind_speed_10m,wind_direction_10m,relative_humidity_2m,dew_point_2m,surface_pressure&temperature_unit=fahrenheit&wind_speed_unit=mph`;
        const meteoRes = await fetch(meteoUrl);
        const meteoData = await meteoRes.json();
        const current = meteoData.current;

        // Render Data
        document.getElementById('val-temp').innerText = `${Math.round(current.temperature_2m)}°F`;
        document.getElementById('val-feel').innerText = `${Math.round(current.apparent_temperature)}°F`;
        document.getElementById('val-wind').innerText = `${Math.round(current.wind_speed_10m)} mph`;
        document.getElementById('val-wind-dir').innerText = getWindDirection(current.wind_direction_10m);
        
        // Pro Data
        document.getElementById('val-dew').innerText = `${Math.round(current.dew_point_2m)}°F`;
        document.getElementById('val-humidity').innerText = `${current.relative_humidity_2m}%`;
        document.getElementById('val-pressure').innerText = `${Math.round(current.surface_pressure)} hPa`;

        // Update Timestamp with local timezone info
        const now = new Date();
        const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone;
        document.getElementById('val-time').innerText = `${now.toLocaleTimeString()} (${tzName})`;

        // 2. Fetch NWS Bulletins
        const nwsRes = await fetch(`https://api.weather.gov/alerts/active?point=${lat},${lon}`);
        const nwsData = await nwsRes.json();
        
        allActiveAlerts = nwsData.features || [];
        processThreatLevel(allActiveAlerts);
        renderBulletins();

        // 3. Sync Clock for Auto-Refresh
        syncWithDeviceClock();

    } catch (error) {
        console.error("Fetch Error:", error);
    }
}

// Evaluates NWS data into the 1-5 Scale
function processThreatLevel(alerts) {
    let maxLevel = 1; // Default Green/Clear
    
    alerts.forEach(alert => {
        const event = alert.properties.event.toUpperCase();
        
        if (event.includes("TORNADO WARNING") || event.includes("EXTREME WIND") || event.includes("FLASH FLOOD EMERGENCY")) {
            maxLevel = Math.max(maxLevel, 5);
        } else if (event.includes("WARNING")) {
            maxLevel = Math.max(maxLevel, 4);
        } else if (event.includes("WATCH")) {
            maxLevel = Math.max(maxLevel, 3);
        } else if (event.includes("ADVISORY") || event.includes("STATEMENT")) {
            maxLevel = Math.max(maxLevel, 2);
        }
    });

    currentThreatLevel = maxLevel;
    
    // Update UI Pill
    const indicator = document.getElementById('threat-indicator');
    indicator.className = `threat-pill level-${currentThreatLevel}`;
    
    const descriptions = ["1 (Clear)", "2 (Advisory)", "3 (Watch)", "4 (Warning)", "5 (Extreme Danger)"];
    indicator.innerText = `Threat Level: ${descriptions[currentThreatLevel - 1]}`;
}

// Renders the first 5 alerts, pushes the rest to the Modal
function renderBulletins() {
    const box = document.getElementById('local-bulletins');
    const modalList = document.getElementById('modal-bulletin-list');
    const viewAllBtn = document.getElementById('view-all-bulletins-btn');
    
    box.innerHTML = '';
    modalList.innerHTML = '';

    if (allActiveAlerts.length === 0) {
        box.innerHTML = '<p class="alert-text-muted">No active bulletins for this location.</p>';
        viewAllBtn.classList.add('hidden');
        return;
    }

    // Render up to 5 on the dashboard
    allActiveAlerts.slice(0, 5).forEach(alert => {
        const event = alert.properties.event;
        const color = getAlertColor(event);
        box.innerHTML += `
            <div class="bulletin-item" style="border-left-color: ${color}">
                <h4 style="color: ${color}">${event}</h4>
                <p>${alert.properties.headline || "Check NWS for details."}</p>
            </div>`;
    });

    // Handle overflow
    if (allActiveAlerts.length > 5) {
        viewAllBtn.classList.remove('hidden');
        viewAllBtn.innerText = `View All ${allActiveAlerts.length} Alerts`;
        
        allActiveAlerts.forEach(alert => {
            const event = alert.properties.event;
            modalList.innerHTML += `
                <div class="bulletin-item" style="border-left-color: ${getAlertColor(event)}">
                    <h4 style="color: ${getAlertColor(event)}">${event}</h4>
                    <p>${alert.properties.description || alert.properties.headline}</p>
                </div>`;
        });
    } else {
        viewAllBtn.classList.add('hidden');
    }
}

function getAlertColor(eventName) {
    const e = eventName.toUpperCase();
    if (e.includes("TORNADO") && e.includes("WARNING")) return "var(--level-5)";
    if (e.includes("WARNING")) return "var(--level-4)";
    if (e.includes("WATCH")) return "var(--level-3)";
    if (e.includes("ADVISORY")) return "var(--level-2)";
    return "var(--text-main)";
}

// Bulletins Modal Controls
function openBulletinModal() { document.getElementById('bulletin-modal').classList.remove('hidden'); }
function closeBulletinModal() { document.getElementById('bulletin-modal').classList.add('hidden'); }

// ==========================================
// CLOCK SYNC AUTO-REFRESH LOGIC
// ==========================================
function syncWithDeviceClock() {
    if (syncTimer) clearTimeout(syncTimer);

    let refreshIntervalMins = 5; // Default Level 1 & 2
    if (currentThreatLevel === 3 || currentThreatLevel === 4) refreshIntervalMins = 3;
    if (currentThreatLevel === 5) refreshIntervalMins = 1;

    const now = new Date();
    const currentMin = now.getMinutes();
    const currentSec = now.getSeconds();
    
    // Calculate minutes until the next target interval (e.g., next 5-minute mark)
    let minsUntilNext = refreshIntervalMins - (currentMin % refreshIntervalMins);
    
    // If we are exactly on the minute, wait the full interval
    let msUntilRefresh = (minsUntilNext * 60 * 1000) - (currentSec * 1000);

    // Failsafe: Ensure we don't spam requests if math resolves to < 10 seconds
    if (msUntilRefresh < 10000) msUntilRefresh += (refreshIntervalMins * 60 * 1000);

    syncTimer = setTimeout(fetchLiveWeather, msUntilRefresh);
}

// ==========================================
// STATE WIDE ALERTS LOGIC
// ==========================================
async function fetchStateAlerts() {
    const stateCode = document.getElementById('state-select').value;
    const resultsBox = document.getElementById('state-alerts-results');
    
    if (!stateCode) return resultsBox.innerHTML = "Please select a state.";

    resultsBox.innerHTML = "Fetching alerts...";

    try {
        const res = await fetch(`https://api.weather.gov/alerts/active?area=${stateCode}`);
        const data = await res.json();
        
        if (!data.features || data.features.length === 0) {
            return resultsBox.innerHTML = `<span style="color:var(--level-1)">No active alerts in ${stateCode}.</span>`;
        }

        let html = "";
        data.features.slice(0, 10).forEach(alert => {
            const event = alert.properties.event;
            const color = getAlertColor(event);
            html += `<p><strong style="color:${color}">${event}:</strong> ${alert.properties.areaDesc}</p>`;
        });

        if (data.features.length > 10) html += `<p style="color:var(--text-muted); font-size:0.8em;">+ ${data.features.length - 10} more alerts...</p>`;
        resultsBox.innerHTML = html;

    } catch (error) {
        resultsBox.innerHTML = "Error loading alerts.";
    }
}
