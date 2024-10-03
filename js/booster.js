// Fake cards data for the demo
const cards = [
    { type: 'Common', name: 'Common Card 1' },
    { type: 'Common', name: 'Common Card 2' },
    { type: 'Common', name: 'Common Card 3' },
    { type: 'Common', name: 'Common Card 4' },
    { type: 'Uncommon', name: 'Uncommon Card 1' },
    { type: 'Uncommon', name: 'Uncommon Card 2' },
    { type: 'Uncommon', name: 'Uncommon Card 3' },
    { type: 'Shiny', name: 'Shiny Card 1' },
    { type: 'Shiny', name: 'Shiny Card 2' },
    { type: 'Energy', name: 'Energy Card' }
];

let currentCardIndex = 0;

// Function to reveal the next card
function revealNextCard() {
    const cardElements = document.querySelectorAll('.card');
    
    if (currentCardIndex < cardElements.length) {
        // Show the next card
        cardElements[currentCardIndex].classList.remove('hidden');
        cardElements[currentCardIndex].classList.add('revealed');
        currentCardIndex++;
    } else {
        // No more cards, so stop listening for clicks
        document.getElementById('card-stack').removeEventListener('click', revealNextCard);
    }
}

// Function to remove the current card
function removeCurrentCard() {
    const cardElements = document.querySelectorAll('.card');
    
    if (currentCardIndex > 0) {
        // Remove the last revealed card
        cardElements[currentCardIndex - 1].classList.add('removed');
    }
}

// Function to generate the card stack
function generateCardStack() {
    const cardStack = document.getElementById('card-stack');
    
    cards.forEach((card, index) => {
        const cardDiv = document.createElement('div');
        cardDiv.classList.add('card', 'hidden');
        cardDiv.innerText = `${card.type}: ${card.name}`;
        cardStack.appendChild(cardDiv);
    });
}

// Event listener for booster click
document.getElementById('booster').addEventListener('click', function () {
    const booster = document.getElementById('booster');
    
    if (booster.classList.contains('opening')) {
        return;
    }

    // Add the class that triggers the animation
    booster.classList.add('opening');

    // After the animation, reveal the first card and allow user to reveal others
    setTimeout(() => {
        revealNextCard();
        document.getElementById('card-stack').addEventListener('click', function () {
            removeCurrentCard();
            revealNextCard();
        });
    }, 2000);  // Wait for the booster animation to complete
});

// Initialize the card stack when the page loads
window.onload = generateCardStack;
