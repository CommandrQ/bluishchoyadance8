document.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('start-btn');
    const uiWindow = document.getElementById('ui-window');
    const footerText = document.getElementById('footer-text');
    const fadeOverlay = document.getElementById('fade-overlay');

    // 1. FOOTER LOGIC: Wipe & Pulse
    let isMissionStatement = false;
    setInterval(() => {
        footerText.style.opacity = 0;
        
        setTimeout(() => {
            if (!isMissionStatement) {
                footerText.innerText = "Empower.Educate.Elevate";
            } else {
                footerText.innerText = "Built by Commander Q 2026";
            }
            footerText.style.opacity = 1;
            isMissionStatement = !isMissionStatement;
        }, 500);
    }, 3000);

    // 2. INTERACTION LOGIC: Slice & Shake
    startBtn.addEventListener('click', () => {
        // Physical Action
        startBtn.classList.add('slicing');
        uiWindow.classList.add('window-shake');

        // Transition Logic
        setTimeout(() => {
            fadeOverlay.classList.add('active');
        }, 400);

        setTimeout(() => {
            window.location.href = 'menu.html';
        }, 1500);
    });
});
