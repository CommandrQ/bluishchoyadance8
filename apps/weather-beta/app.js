// ==========================================
// 1. INITIALIZATION & CACHE LOADING
// ==========================================

// Check if we have saved location data; if not, default to Radcliff, KY
let lat = localStorage.getItem('weather_lat') || 37.83; 
let lon = localStorage.getItem('weather_lon') || -85.94;
let currentCity = localStorage.getItem('weather_city') || "Radcliff, KY";

// Load mock database from cache if it exists, otherwise start empty
let mockDatabase = JSON.parse(localStorage.getItem('weather_feed')) || [];

// Immediately show cached weather data if we have it (Stale-While-Revalidate)
const cachedWeather = localStorage.getItem('weather_html');
if (cachedWeather) {
    document.getElementById('auto-data').innerHTML = cachedWeather;
}

// ==========================================
// 2. LIVE WEATHER FETCH
// ==========================================
async function fetchLiveWeather() {
    try {
        // Fetch Open-Meteo Data
        const meteoRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
        const meteoData = await meteoRes.json();
        const tempF = (meteoData.current_weather.temperature * 9/5) + 32; 
        const windSpeedMph = (meteoData.current_weather.windspeed * 0.621371).toFixed(1);

        // Fetch NWS Alerts
        const nwsRes = await fetch(`https://api.weather.gov/alerts/active?point=${lat},${lon}`);
        const nwsData = await nwsRes.json();
        
        let alertText = "<span class='threat-green'>No active NWS alerts.</span>";
        if (nwsData.features && nwsData.features.length > 0) {
            alertText = `<span class='threat-red'>ALERT: ${nwsData.features[0].properties.headline}</span>`;
        }

        // Build the HTML payload
        const weatherHTML = `
            <h4 style="margin-top:0; color: #fff;">Scanning: ${currentCity} <small style="color:#666; font-size:0.7em;">(Live)</small></h4>
            <p><span class="tooltip">Temperature: ${tempF.toFixed(1)}°F
                <span class="tooltiptext">Baseline surface temp. Rapid drops often indicate cold outflow from an approaching storm.</span>
            </span></p>
            <p><span class="tooltip">Wind Speed: ${windSpeedMph} mph
                <span class="tooltiptext">Surface wind speed. High sustained winds can feed storm structure and cause isolated damage.</span>
            </span></p>
            <p>${alertText}</p>
        `;

        // Update the screen with fresh data
        document.getElementById('auto-data').innerHTML = weatherHTML;

        // SAVE the fresh HTML to local cache for the next time they open the app
        localStorage.setItem('weather_html', weatherHTML);

    } catch (error) {
        // If the API fails (e.g., they have zero internet), the cached data stays on screen!
        console.error("API Fetch Error", error);
    }
}

// ==========================================
// 3. AUTOCOMPLETE & AUTOCORRECT (US ONLY)
// ==========================================
let searchTimeout;
const locationInput = document.getElementById('location-input');
const autocompleteList = document.getElementById('autocomplete-list');

locationInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout); // Reset timer on every keystroke
    const query = e.target.value;
    autocompleteList.innerHTML = ''; // Clear old results

    // Wait until they type at least 3 letters
    if (query.length < 3) return;

    // Wait 300ms after they stop typing before hitting the API
    searchTimeout = setTimeout(async () => {
        try {
            const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=10`);
            const data = await res.json();
            
            if (data.results) {
                // STRICT FILTER: Only keep results inside the US
                const usResults = data.results.filter(loc => loc.country_code === 'US');
                
                usResults.forEach(loc => {
                    const item = document.createElement('div');
                    item.className = 'autocomplete-item';
                    item.innerText = `${loc.name}, ${loc.admin1}`; 
                    
                    // When user clicks a city from the list:
                    item.onclick = () => {
                        locationInput.value = `${loc.name}, ${loc.admin1}`;
                        autocompleteList.innerHTML = '';
                        
                        // Update global variables
                        lat = loc.latitude;
                        lon = loc.longitude;
                        currentCity = `${loc.name}, ${loc.admin1}`;
                        
                        // CACHE the new location so it remembers them next time
                        localStorage.setItem('weather_lat', lat);
                        localStorage.setItem('weather_lon', lon);
                        localStorage.setItem('weather_city', currentCity);
                        
                        // Fetch weather for new city and update cache
                        document.getElementById('auto-data').innerHTML = `<h4 style="margin-top:0; color: #fff;">Scanning: ${currentCity}...</h4>`;
                        fetchLiveWeather();
                    };
                    autocompleteList.appendChild(item);
                });

                if (usResults.length === 0) {
                    autocompleteList.innerHTML = '<div class="autocomplete-item" style="color:#666;">No US cities found.</div>';
                }
            }
        } catch (err) {
            console.error("Geocoding error", err);
        }
    }, 300); 
});

// Hide autocomplete list if user clicks anywhere outside of it
document.addEventListener('click', function(e) {
    if (e.target !== locationInput) {
        autocompleteList.innerHTML = '';
    }
});

// ==========================================
// 4. MOCK REPORTING SYSTEM
// ==========================================
function postMockUpdate() {
    const city = document.getElementById('location-input').value || currentCity;
    const threat = document.getElementById('threat').value;
    const chatter = document.getElementById('chatter').value;

    if (!chatter) {
        alert("Please enter a ground observation before broadcasting.");
        return;
    }

    // Prepend the new report to the array
    mockDatabase.unshift({
        time: new Date().toLocaleTimeString(),
        location: city,
        threat: threat,
        text: chatter
    });

    // CACHE the updated feed so it survives a page refresh
    localStorage.setItem('weather_feed', JSON.stringify(mockDatabase));

    // Clear input and refresh UI
    document.getElementById('chatter').value = ''; 
    renderFeed(); 
}

// ==========================================
// 5. RENDER THE CHATTER FEED
// ==========================================
function renderFeed() {
    let html = "";
    mockDatabase.forEach(report => {
        let colorClass = "threat-" + report.threat.toLowerCase();
        html += `
            <div style="border-bottom: 1px dashed #333; padding-bottom: 10px; margin-bottom: 10px;">
                <small style="color: #666;">[${report.time}]</small><br>
                <strong><span class="${colorClass}">[${report.threat}]</span> ${report.location}</strong>
                <p style="margin: 5px 0 0 0;">${report.text}</p>
            </div>`;
    });
    
    document.getElementById('feed-data').innerHTML = html || "<p style='color:#666;'>No local chatter yet. Be the first to report.</p>";
}

// ==========================================
// 6. START THE APP
// ==========================================
renderFeed();
fetchLiveWeather();
