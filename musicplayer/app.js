let player;
let stationsData = [];
const defaultPlaylist = 'PLwX0pb3GEremC1vfOY7jLfNqdfR2cTVi7'; 

const playBtn = document.getElementById('play-btn');
const pauseBtn = document.getElementById('pause-btn');

// Define the colors for the stations here
const glowColors = [
  'rgba(0, 191, 255, 0.66)', // Index 0: Light Blue (Vi-bration)
  'rgba(255, 45, 45, 0.66)', // Index 1: Red (Ki-netic)
  'rgba(255, 215, 0, 0.66)'  // Index 2: Gold (Chi-rful)
];

function onYouTubeIframeAPIReady() {
  player = new YT.Player('player', {
    height: '100%',
    width: '100%',
    playerVars: {
      'listType': 'playlist',
      'list': defaultPlaylist,
      'autoplay': 0, 
      'controls': 1, 
      'modestbranding': 1,
      'rel': 0,
      'playsinline': 1 
    },
    events: {
      'onReady': onPlayerReady,
      'onStateChange': onPlayerStateChange
    }
  });
}

function onPlayerReady(event) {
  fetchData();
  setupMediaControls();
}

function onPlayerStateChange(event) {
  if (event.data == YT.PlayerState.PLAYING) {
    playBtn.style.display = 'none';
    pauseBtn.style.display = 'inline-block';
  } else {
    playBtn.style.display = 'inline-block';
    pauseBtn.style.display = 'none';
  }
}

function fetchData() {
  const stationSelect = document.getElementById('station-select');

  fetch('data/stations.json')
    .then(response => response.json())
    .then(data => {
      stationsData = data.stations;

      stationsData.forEach((station, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = station.name;
        stationSelect.appendChild(option);
      });

      // Default the glow to the first station on load
      document.documentElement.style.setProperty('--active-glow', glowColors[0]);
      
      // When station changes, update playlists AND change glow color
      stationSelect.addEventListener('change', (e) => {
        const selectedIndex = e.target.value;
        renderPlaylists(selectedIndex);
        
        // Update the CSS variable for the glow based on the array above
        if(glowColors[selectedIndex]) {
            document.documentElement.style.setProperty('--active-glow', glowColors[selectedIndex]);
        }
      });
    })
    .catch(error => console.error("Error loading stations:", error));
}

let loadTimeout;

function renderPlaylists(stationIndex) {
  const container = document.getElementById('playlist-container');
  container.innerHTML = ''; 

  const playlists = stationsData[stationIndex].playlists;

  if (playlists.length === 0) {
    container.innerHTML = '<div class="empty-state">No playlists found.</div>';
    return;
  }

  playlists.forEach((playlist) => {
    const btn = document.createElement('button');
    btn.className = 'playlist-btn';
    btn.innerHTML = `<div>${playlist.title}</div>`;
    
    btn.addEventListener('click', () => {
      document.querySelectorAll('.playlist-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      clearTimeout(loadTimeout);
      
      if (player && player.stopVideo) {
        player.stopVideo();
      }
      
      loadTimeout = setTimeout(() => {
        player.loadPlaylist({
          list: playlist.id,
          listType: 'playlist',
          index: 0,
          startSeconds: 0,
          suggestedQuality: 'default'
        });
      }, 300);
    });

    container.appendChild(btn);
  });
}

function setupMediaControls() {
  playBtn.addEventListener('click', () => player.playVideo());
  pauseBtn.addEventListener('click', () => player.pauseVideo());
  document.getElementById('next-btn').addEventListener('click', () => player.nextVideo());
  document.getElementById('prev-btn').addEventListener('click', () => player.previousVideo());
}
