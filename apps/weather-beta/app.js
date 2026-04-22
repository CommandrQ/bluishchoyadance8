// --- CONFIGURATION ---
const NWS_LOCAL_URL = 'https://api.weather.gov/alerts/active?event=Tornado%20Warning,Severe%20Thunderstorm%20Warning';
const NWS_NATIONAL_URL = 'https://api.weather.gov/alerts/active?event=Tornado%20Warning';

// --- SERVICE WORKER REGISTRATION (BETA PATH) ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/apps/weather-beta/sw.js')
            .then(reg => console.log('Shields Up: Scope is', reg.scope))
            .catch(err => console.error('Shields Offline:', err));
    });
}

// --- OFFLINE/ONLINE LOGIC ---
window.addEventListener('online', () => {
    document.getElementById('offline-banner').classList.add('hidden-banner');
    refreshDashboard();
});
window.addEventListener('offline', () => {
    document.getElementById('offline-banner').classList.remove('hidden-banner');
});

// --- MASTER REFRESH ENGINE ---
async function refreshDashboard() {
    if (!navigator.onLine) return; // Rely on cached data if offline

    const lat = localStorage.getItem('last_lat') || "37.9887"; // Default to a known area
    const lon = localStorage.getItem('last_lon') || "-85.9589";
    const locName = localStorage.getItem('last_location_name') || "Default Location";
    document.getElementById('location-search').value = locName;

    // Concurrently fetch local warnings, local physics, and national warnings
    const [localAlerts, localAtmosphere, nationalAlerts] = await Promise.all([
        fetchLocalWarnings(lat, lon),
        fetchAtmosphere(lat, lon),
        fetchNationalScanner()
    ]);

    const decision = calculateDecisionEngine(localAlerts || 1, localAtmosphere || { dewPoint: 0, cape: 0, windGusts: 0 });
    
    renderUI(decision, localAtmosphere);
    processNationalScanner(nationalAlerts || []);
    
    // Init Radar if not already running
    if (!window.radarActive) {
        initRadar(lat, lon);
        window.radarActive = true;
    } else if (window.map) {
        window.map.setView([lat, lon], 8);
    }
    
    startHeartbeat(decision.finalThreatLevel);
}

// --- FETCH FUNCTIONS ---
async function fetchLocalWarnings(lat, lon) {
    try {
        // In a real scenario, you'd filter the NWS polygon geometry against the lat/lon.
        // For this logic structure, we fetch the active severe warnings and analyze tags.
        const res = await fetch(NWS_LOCAL_URL, { headers: { 'Accept': 'application/geo+json' }});
        if (!res.ok) throw new Error("Local NWS Error");
        const data = await res.json();
        return analyzeThreatLevels(data.features);
    } catch (e) { console.error(e); return null; }
}

async function fetchAtmosphere(lat, lon) {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,dew_point_2m,wind_gusts_10m,surface_pressure,cape&wind_speed_unit=mph&timezone=auto`;
        const res = await fetch(url);
        const data = await res.json();
        const cur = data.current;
        return {
            temp: cur.temperature_2m, humidity: cur.relative_humidity_2m,
            dewPoint: cur.dew_point_2m, windGusts: cur.wind_gusts_10m || 0,
            cape: cur.cape || 0, pressureInHg: (cur.surface_pressure * 0.02953).toFixed(2)
        };
    } catch (e) { console.error(e); return null; }
}

async function fetchNationalScanner() {
    try {
        const res = await fetch(NWS_NATIONAL_URL, { headers: { 'Accept': 'application/geo+json' }});
        const data = await res.json();
        return data.features;
    } catch (e) { return null; }
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
        out.actionDirective = "IMMINENT DANGER: SEEK SHELTER";
        out.tooltipText = "PDS or Observed Tornado on the ground.";
    } else if (nwsLevel === 4) {
        out.actionDirective = "TAKE COVER";
        out.tooltipText = "Radar indicates rotational winds.";
    } else if (nwsLevel === 3) {
        out.actionDirective = "STAY INDOORS";
        out.tooltipText = "Severe thunderstorm warning active.";
    } else if (nwsLevel <= 2 && isHighFuel) {
        out.finalThreatLevel = 2;
        out.actionDirective = "STORM FUEL HIGH";
        out.tooltipText = `Explosive atmospheric fuel detected (CAPE: ${atm.cape}). Monitor closely.`;
    } else if (nwsLevel === 2) {
        out.actionDirective = "WATCH ISSUED";
        out.tooltipText = "Conditions favorable for severe weather.";
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
        document.getElementById('current-temp').innerText = Math.round(atm.temp);
        document.getElementById('current-wind').innerText = Math.round(atm.windGusts);
        document.getElementById('fuel-badge').className = atm.dewPoint >= 65 ? "badge" : "badge fuel-hidden";
        
        // Pro Metrics
        document.getElementById('pro-cape').innerText = atm.cape;
        document.getElementById('pro-dewpoint').innerText = Math.round(atm.dewPoint);
        document.getElementById('pro-pressure').innerText = atm.pressureInHg;
        document.getElementById('pro-humidity').innerText = atm.humidity;
    }
}

function toggleProMode() {
    const overlay = document.getElementById('pro-mode-overlay');
    overlay.classList.toggle('hidden');
}

// --- NATIONAL SCANNER LOGIC ---
function processNationalScanner(features) {
    const feed = document.getElementById('scanner-feed');
    if (!features || features.length === 0) {
        feed.innerHTML = `<p class="empty-state">No active tornado warnings.</p>`;
        return;
    }

    let sorted = features.map(f => {
        const p = f.properties;
        const text = (p.description + " " + p.instruction).toUpperCase();
        return {
            area: p.areaDesc,
            isPDS: text.includes("PARTICULARLY DANGEROUS"),
            isObserved: text.includes("OBSERVED") || text.includes("CONFIRMED"),
        };
    }).sort((a, b) => (b.isPDS || b.isObserved) - (a.isPDS || a.isObserved));

    feed.innerHTML = sorted.map(w => `
        <div class="scanner-card ${w.isPDS || w.isObserved ? 'pds-card' : ''}">
            <span class="status-tag">${w.isPDS || w.isObserved ? '⚠️ PDS / OBSERVED' : 'RADAR INDICATED'}</span>
            <h4>${w.area}</h4>
        </div>
    `).join('');
}

// --- RADAR LOGIC (LEAFLET & RAINVIEWER) ---
function initRadar(lat, lon) {
    window.map = L.map('radar-map', { zoomControl: false }).setView([lat, lon], 8);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(window.map);

    fetch('https://api.rainviewer.com/public/weather-maps.json')
        .then(res => res.json())
        .then(data => {
            const host = "https://tilecache.rainviewer.com";
            window.radarLayers = data.radar.past.map(frame => 
                L.tileLayer(`${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, { opacity: 0, zIndex: 20 }).addTo(window.map)
            );
            window.currentRadarFrame = 0;
            animateRadar();
        });
}

function animateRadar() {
    if (!window.radarLayers || window.radarLayers.length === 0) return;
    window.radarLayers.forEach(l => l.setOpacity(0));
    window.radarLayers[window.currentRadarFrame].setOpacity(0.6);
    
    const ts = new Date(window.radarLayers[window.currentRadarFrame].options.time * 1000);
    document.getElementById('radar-timestamp').innerText = 'Live Loop Active'; // Simplified timestamp
    
    window.currentRadarFrame = (window.currentRadarFrame + 1) % window.radarLayers.length;
    setTimeout(animateRadar, 800);
}

// --- SEARCH & LOCATION LOGIC ---
document.getElementById('location-search').addEventListener('change', async (e) => {
    const q = e.target.value.trim();
    if (/^\d{5}$/.test(q)) {
        try {
            const res = await fetch(`https://api.zippopotam.us/us/${q}`);
            const data = await res.json();
            const place = data.places[0];
            updateLocation(place.latitude, place.longitude, `${place['place name']}, ${place['state abbreviation']}`);
        } catch (err) { alert("ZIP code not found."); }
    }
});

function updateLocation(lat, lon, name) {
    localStorage.setItem('last_lat', lat);
    localStorage.setItem('last_lon', lon);
    localStorage.setItem('last_location_name', name);
    refreshDashboard();
}

// --- HEARTBEAT ---
function startHeartbeat(level) {
    let int = 300000; // 5 mins
    if (level >= 4) int = 60000; // 1 min for emergencies
    if (window.refreshTimer) clearInterval(window.refreshTimer);
    window.refreshTimer = setInterval(refreshDashboard, int);
}

// Kickoff
refreshDashboard();
