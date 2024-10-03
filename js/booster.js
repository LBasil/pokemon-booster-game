document.getElementById('booster').addEventListener('click', function () {
    const booster = document.getElementById('booster');
    
    if (booster.classList.contains('opening')) {
        return;
    }
     // Add the class that triggers the animation
    booster.classList.add('opening');

    // Optional: Handle what happens after the booster is "opened"
    setTimeout(() => {
        alert("Booster Opened! Time to reveal the cards.");
        // Here you can trigger the card reveal process.
    }, 2500);  // Wait for the animations to complete before triggering card reveal
});

