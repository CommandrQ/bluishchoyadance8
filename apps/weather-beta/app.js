// ==========================================
// STATE & CACHE VARIABLES
// ==========================================
let lat = localStorage.getItem('weather_lat') || null; 
let lon = localStorage.getItem('weather_lon') || null;
let currentLocationText = localStorage.getItem('weather_loc_text') || null;

let currentThreatLevel = 1;
let syncTimer = null;
let allActiveAlerts = []; 

// Initialize
if (lat && lon) {
    document.getElementById('location-display').innerText = currentLocationText;
    fetchLiveWeather();
}
fetchNationalTornadoes(); // Runs independently on load

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
// SEARCH LOGIC & AUTOCOMPLETE
// ==========================================
let searchTimeout;
const locationInput = document.getElementById('location-input');
const autocompleteList = document.getElementById('autocomplete-list');

// Triggers when user clicks the 🔍 icon
function executeSearch() {
    const query = locationInput.value.trim();
    if (/^\d{5}$/.test(query)) {
        processZipCode(query);
    } else if (query.length > 2) {
        // Trigger manual API search if they typed a city but didn't pick from dropdown
        fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1`)
            .then(res => res.json())
            .then(data => {
                if(data.results && data.results.length > 0) {
                    const loc = data.results[0];
                    lat = loc.latitude; lon = loc.longitude;
                    currentLocationText = `${loc.name}, ${loc.admin1}`;
                    saveAndFetch();
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
        if (/^\d{5}$/.test(query)) return; // Let manual search handle exact zips

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
        } catch (err) { console.error(err); }
    }, 400);
});

async function processZipCode(zip) {
    try {
        const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
        if (!res.ok) throw new Error("ZIP not found");
        const data = await res.json();
        lat = data.places[0].latitude; lon = data.places[0].longitude;
        currentLocationText = `${data.places[0]["place name"]}, ${data.places[0]["state abbreviation"]} (${zip})`;
        saveAndFetch();
    } catch (e) { alert("Invalid ZIP Code."); }
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

document.addEventListener('click', (e) => { if(e.target !== locationInput) autocompleteList.innerHTML = ''; });

// ==========================================
// CORE DATA FETCHING (Only updates values)
// ==========================================
async function fetchLiveWeather() {
    if (!lat || !lon) return;

    // Visual queue that refresh is happening
    document.getElementById('val-time').innerText = "Scanning...";

    try {
        // 1. Fetch Weather Data
        const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,wind_speed_10m,wind_direction_10m,relative_humidity_2m,dew_point_2m,surface_pressure&temperature_unit=fahrenheit&wind_speed_unit=mph`;
        const meteoRes = await fetch(meteoUrl);
        const meteoData = await meteoRes.json();
        const current = meteoData.current;

        // Convert hPa to inHg for Barometric Pressure
        const pressureInHg = (current.surface_pressure * 0.02953).toFixed(2);

        // Update DOM cleanly
        document.getElementById('val-temp').innerText = `${Math.round(current.temperature_2m)}°F`;
        document.getElementById('val-feel').innerText = `${Math.round(current.apparent_temperature)}°F`;
        document.getElementById('val-wind').innerText = `${Math.round(current.wind_speed_10m)} mph`;
        document.getElementById('val-wind-dir').innerText = getWindDirection(current.wind_direction_10m);
        document.getElementById('val-dew').innerText = `${Math.round(current.dew_point_2m)}°F`;
        document.getElementById('val-humidity').innerText = `${current.relative_humidity_2m}%`;
        document.getElementById('val-pressure').innerText = `${pressureInHg} inHg`;

        const now = new Date();
        const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone;
        document.getElementById('val-time').innerText = `${now.toLocaleTimeString()} (${tzName})`;

        // 2. Fetch NWS Bulletins
        const nwsRes = await fetch(`https://api.weather.gov/alerts/active?point=${lat},${lon}`);
        const nwsData = await nwsRes.json();
        
        allActiveAlerts = nwsData.features || [];
        processThreatLevel(allActiveAlerts);
        renderBulletins();

        syncWithDeviceClock();

    } catch (error) {
        console.error("Fetch Error:", error);
        document.getElementById('val-time').innerText = "Network Error";
    }
}

// Evaluates NWS data into the 1-5 Scale
function processThreatLevel(alerts) {
    let maxLevel = 1; 
    alerts.forEach(alert => {
        const event = alert.properties.event.toUpperCase();
        if (event.includes("TORNADO WARNING") || event.includes("EXTREME WIND") || event.includes("FLASH FLOOD EMERGENCY")) {
            maxLevel = Math.max(maxLevel, 5);
        } else if (event.includes("WARNING")) { maxLevel = Math.max(maxLevel, 4); } 
        else if (event.includes("WATCH")) { maxLevel = Math.max(maxLevel, 3); } 
        else if (event.includes("ADVISORY") || event.includes("STATEMENT")) { maxLevel = Math.max(maxLevel, 2); }
    });

    currentThreatLevel = maxLevel;
    const indicator = document.getElementById('threat-indicator');
    indicator.className = `threat-pill level-${currentThreatLevel}`;
    const descriptions = ["1 (Clear)", "2 (Advisory)", "3 (Watch)", "4 (Warning)", "5 (Extreme Danger)"];
    indicator.innerText = `Threat Level: ${descriptions[currentThreatLevel - 1]}`;
}

// ==========================================
// NWS BULLETINS & MODAL READER
// ==========================================
function renderBulletins() {
    const box = document.getElementById('local-bulletins');
    const viewAllBtn = document.getElementById('view-all-bulletins-btn');
    box.innerHTML = '';

    if (allActiveAlerts.length === 0) {
        box.innerHTML = '<p class="alert-text-muted">No active bulletins for this location.</p>';
        viewAllBtn.classList.add('hidden');
        return;
    }

    // Render summary on dashboard
    allActiveAlerts.slice(0, 5).forEach((alert, index) => {
        const event = alert.properties.event;
        const color = getAlertColor(event);
        // Use headline for jargon-free summary
        const summary = alert.properties.headline || "Active weather alert in your area.";
        
        box.innerHTML += `
            <div class="bulletin-item" style="border-left-color: ${color}">
                <h4 style="color: ${color}">${event}</h4>
                <p>${summary}</p>
                <span class="read-more-link" onclick="openStatementReader(${index})">Read Full Statement</span>
            </div>`;
    });

    if (allActiveAlerts.length > 5) {
        viewAllBtn.classList.remove('hidden');
        viewAllBtn.innerText = `View All ${allActiveAlerts.length} Alerts`;
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

function openStatementReader(index) {
    const alert = allActiveAlerts[index];
    document.getElementById('modal-alert-title').innerText = alert.properties.event;
    
    // Combine description and instructions for full reading
    let fullText = alert.properties.description || "No detailed description provided.";
    if (alert.properties.instruction) {
        fullText += "\n\nINSTRUCTIONS:\n" + alert.properties.instruction;
    }
    
    document.getElementById('modal-bulletin-list').innerText = fullText;
    document.getElementById('bulletin-modal').classList.remove('hidden');
}

function openAllBulletins() {
    document.getElementById('modal-alert-title').innerText = "All Active Alerts";
    let listHTML = "";
    allActiveAlerts.forEach(alert => {
        listHTML += `<strong>${alert.properties.event}</strong>\n${alert.properties.description}\n\n`;
    });
    document.getElementById('modal-bulletin-list').innerText = listHTML;
    document.getElementById('bulletin-modal').classList.remove('hidden');
}

function closeBulletinModal() { document.getElementById('bulletin-modal').classList.add('hidden'); }

// ==========================================
// NATIONAL TORNADO TRACKER
// ==========================================
async function fetchNationalTornadoes() {
    const resultsBox = document.getElementById('national-tornado-results');
    try {
        const res = await fetch(`https://api.weather.gov/alerts/active?event=Tornado%20Warning`);
        const data = await res.json();
        
        if (!data.features || data.features.length === 0) {
            resultsBox.innerHTML = `<span style="color:var(--level-1)">No active Tornado Warnings nationally.</span>`;
            return;
        }

        let html = "";
        data.features.forEach(alert => {
            const desc = alert.properties.description || "";
            const isPDS = desc.toUpperCase().includes("PARTICULARLY DANGEROUS SITUATION");
            
            const badge = isPDS ? `<span style="background:var(--level-5); color:#fff; padding:2px 6px; border-radius:4px; font-size:0.8em; margin-left:5px;">PDS / EMERGENCY</span>` : "";
            
            html += `
                <div class="bulletin-item" style="border-left-color: var(--level-5);">
                    <h4 style="color: var(--level-5); margin-bottom: 2px;">${alert.properties.areaDesc} ${badge}</h4>
                    <p style="font-size: 0.8em;">Expires: ${new Date(alert.properties.expires).toLocaleTimeString()}</p>
                </div>`;
        });
        resultsBox.innerHTML = html;

    } catch (error) {
        resultsBox.innerHTML = "Error loading national tracker.";
    }
}

// ==========================================
// CLOCK SYNC AUTO-REFRESH LOGIC
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
        fetchNationalTornadoes(); // Refresh national tracker too
    }, msUntilRefresh);
}
