// ==========================================
// 🛠️ TESTING MODULE
// ==========================================
const TEST_MODULE = {
    forceThreatLevel: null, // "GREEN", "YELLOW", "RED", or null
    forcePopupAlert: false,
    mockAlertText: "TORNADO WARNING IN EFFECT UNTIL 4:00 PM CDT."
};

// ==========================================
// STATE & CACHE VARIABLES
// ==========================================
let lat = localStorage.getItem('weather_lat') || null; 
let lon = localStorage.getItem('weather_lon') || null;
let currentCity = localStorage.getItem('weather_city') || null;

let currentThreatLevel = "GREEN";
let autoRefreshTimer = null;
let popupDismissed = false; 

// ==========================================
// UTILITY FUNCTIONS
// ==========================================
function getWindDirection(degrees) {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return directions[Math.round(degrees / 45) % 8];
}

function toggleAdvanced() {
    document.getElementById('advanced-data').classList.toggle('hidden');
}

function closeModal() {
    document.getElementById('alert-modal').classList.add('hidden');
    popupDismissed = true; 
}

function triggerModal(text) {
    if (!popupDismissed) {
        document.getElementById('modal-text').innerText = text;
        document.getElementById('alert-modal').classList.remove('hidden');
    }
}

// Map WMO Weather Codes to Plain English
function getWeatherCondition(code) {
    if (code === 0) return "Clear Skies";
    if (code === 1 || code === 2 || code === 3) return "Partly Cloudy / Overcast";
    if (code === 45 || code === 48) return "Foggy";
    if (code >= 51 && code <= 55) return "Drizzle";
    if (code >= 61 && code <= 65) return "Rain";
    if (code === 71 || code === 73 || code === 75) return "Snow";
    if (code >= 80 && code <= 82) return "Rain Showers";
    if (code === 95) return "Thunderstorms";
    if (code === 96 || code === 99) return "Severe Thunderstorms (Hail)";
    return "Unknown Conditions";
}

// ==========================================
// MANUAL LOOKUP LOGIC
// ==========================================
async function manualSearch() {
    const input = document.getElementById('manual-location-input').value.trim();
    if (!input) return alert("Please enter a ZIP code or City.");

    document.getElementById('city-name').innerText = "Locating...";
    
    try {
        // Check if it's a 5-digit US ZIP Code
        if (/^\d{5}$/.test(input)) {
            const res = await fetch(`https://api.zippopotam.us/us/${input}`);
            if (!res.ok) throw new Error("ZIP not found");
            const data = await res.json();
            
            lat = data.places[0].latitude;
            lon = data.places[0].longitude;
            currentCity = `${data.places[0]["place name"]}, ${data.places[0]["state abbreviation"]} (${input})`;
        } 
        // Otherwise, assume it's a city string and use Open-Meteo Geocoder
        else {
            const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(input)}&count=1`);
            const data = await res.json();
            if (!data.results) throw new Error("City not found");
            
            const loc = data.results[0];
            lat = loc.latitude;
            lon = loc.longitude;
            currentCity = `${loc.name}, ${loc.admin1 || loc.country}`;
        }

        // SAVE TO CACHE
        localStorage.setItem('weather_lat', lat);
        localStorage.setItem('weather_lon', lon);
        localStorage.setItem('weather_city', currentCity);

        // Reset popup dismissal for new location
        popupDismissed = false;

        // Fetch data for new location
        fetchLiveWeather();

    } catch (error) {
        document.getElementById('city-name').innerText = "Location Error";
        alert("Could not find that location. Please try a valid US ZIP or City, State.");
    }
}

// ==========================================
// CORE DATA FETCHING
// ==========================================
async function fetchLiveWeather() {
    if (!lat || !lon) return; // Do nothing if no location is set

    document.getElementById('city-name').innerText = currentCity;

    try {
        // Fetch Open-Meteo (Now including weather_code)
        const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph`;
        const meteoRes = await fetch(meteoUrl);
        const meteoData = await meteoRes.json();
        const current = meteoData.current;

        // Update UI Core Data
        document.getElementById('val-condition').innerText = getWeatherCondition(current.weather_code);
        document.getElementById('val-temp').innerText = `${Math.round(current.temperature_2m)}°F`;
        document.getElementById('val-humidity').innerText = `${current.relative_humidity_2m}%`;
        document.getElementById('val-wind').innerHTML = `${Math.round(current.wind_speed_10m)} mph <span style="font-size:0.6em; color:var(--text-muted)">${getWindDirection(current.wind_direction_10m)}</span>`;
        document.getElementById('val-gusts').innerText = `${Math.round(current.wind_gusts_10m)} mph`;
        
        document.getElementById('val-time').innerText = new Date().toLocaleTimeString();

        // Fetch Local NWS Alerts
        const nwsRes = await fetch(`https://api.weather.gov/alerts/active?point=${lat},${lon}`);
        const nwsData = await nwsRes.json();
        
        let alertHeadline = "No active local NWS warnings.";
        currentThreatLevel = "GREEN"; 
        
        if (nwsData.features && nwsData.features.length > 0) {
            alertHeadline = nwsData.features[0].properties.headline;
            if (alertHeadline.toUpperCase().includes("WARNING")) {
                currentThreatLevel = "RED";
            } else {
                currentThreatLevel = "YELLOW";
            }
        }

        // TESTING OVERRIDE
        if (TEST_MODULE.forceThreatLevel) currentThreatLevel = TEST_MODULE.forceThreatLevel;
        if (TEST_MODULE.forcePopupAlert) {
            currentThreatLevel = "RED";
            alertHeadline = TEST_MODULE.mockAlertText;
        }

        // Apply Threat Level UI
        const indicator = document.getElementById('threat-indicator');
        const localAlertText = document.getElementById('local-alert-text');
        
        if (currentThreatLevel === "GREEN") {
            indicator.innerText = "Status: CLEAR";
            indicator.style.background = "var(--threat-green)";
            indicator.style.color = "#fff";
            localAlertText.innerText = alertHeadline;
            localAlertText.style.color = "var(--text-muted)";
        } 
        else if (currentThreatLevel === "YELLOW") {
            indicator.innerText = "Status: ELEVATED THREAT";
            indicator.style.background = "var(--threat-yellow)";
            indicator.style.color = "#000";
            localAlertText.innerText = alertHeadline;
            localAlertText.style.color = "var(--threat-yellow)";
        } 
        else if (currentThreatLevel === "RED") {
            indicator.innerText = "Status: IMMINENT DANGER";
            indicator.style.background = "var(--threat-red)";
            indicator.style.color = "#fff";
            localAlertText.innerText = alertHeadline;
            localAlertText.style.color = "#ff6961";
            
            triggerModal(alertHeadline);
        }

        scheduleNextRefresh();

    } catch (error) {
        console.error("API Fetch Error", error);
        document.getElementById('threat-indicator').innerText = "Network Error - Offline Cache";
    }
}

// ==========================================
// DYNAMIC REFRESH LOGIC
// ==========================================
function scheduleNextRefresh() {
    if (autoRefreshTimer) clearTimeout(autoRefreshTimer);

    let refreshMinutes = 5; 
    if (currentThreatLevel === "YELLOW") refreshMinutes = 3;
    if (currentThreatLevel === "RED") refreshMinutes = 1;

    document.getElementById('val-refresh').innerText = `Every ${refreshMinutes} minute(s)`;

    autoRefreshTimer = setTimeout(fetchLiveWeather, refreshMinutes * 60 * 1000);
}

// ==========================================
// STATE ALERTS LOGIC (Dropdown)
// ==========================================
async function fetchStateAlerts() {
    const stateCode = document.getElementById('state-select').value;
    const resultsBox = document.getElementById('state-alerts-results');
    
    if (!stateCode) return resultsBox.innerHTML = "Please select a state.";

    resultsBox.innerHTML = "Fetching alerts from NWS...";

    try {
        const res = await fetch(`https://api.weather.gov/alerts/active?area=${stateCode}`);
        const data = await res.json();
        
        if (!data.features || data.features.length === 0) {
            return resultsBox.innerHTML = `<span style="color:var(--threat-green)">No active alerts in ${stateCode}.</span>`;
        }

        let html = "";
        data.features.slice(0, 10).forEach(alert => {
            const severityColor = alert.properties.severity === "Severe" || alert.properties.severity === "Extreme" ? "#ff6961" : "var(--threat-yellow)";
            html += `<p><strong style="color:${severityColor}">${alert.properties.event}:</strong> ${alert.properties.areaDesc}</p>`;
        });

        if (data.features.length > 10) html += `<p style="text-align:center; font-size:0.8em;">+ ${data.features.length - 10} more active alerts...</p>`;
        resultsBox.innerHTML = html;

    } catch (error) {
        resultsBox.innerHTML = "Error loading state alerts.";
    }
}

// ==========================================
// INITIALIZE
// ==========================================
if (TEST_MODULE.forcePopupAlert) triggerModal(TEST_MODULE.mockAlertText);

// If the user has a saved location from a previous session, load it automatically.
// If not, the app stays in "System Standby" waiting for them to use the search bar.
if (lat && lon) {
    fetchLiveWeather();
}
