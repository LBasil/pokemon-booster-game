let currentCardIndex = 0;
let cards = [];

// Fonction pour récupérer 10 cartes aléatoires depuis la base de données
async function fetchRandomCards() {
    try {
        // Appel de la fonction RPC pour tirer 10 cartes aléatoires
        const { data, error } = await supabase.rpc('random_cards', { num_cards: 10 });
        
        if (error) {
            console.error('Erreur lors de la récupération des cartes:', error);
            return [];
        }

        return data; // Retourne les cartes récupérées
    } catch (err) {
        console.error("Erreur lors de l'appel de l'API Supabase : ", err);
        return [];
    }
}

// Fonction pour afficher les cartes sur la pile
function displayCards(cards) {
    const cardStack = document.getElementById('card-stack');
    cardStack.style.marginTop = '-350px';

    // Vider le stack de cartes précédent
    cardStack.innerHTML = '';

    cards.forEach((card, index) => {
        const cardDiv = document.createElement('div');
        cardDiv.classList.add('card', 'hidden');
        cardDiv.innerHTML = `<img src="${card.imageUrl}" alt="${card.name}" class="card-img">`; // Affiche l'image de la carte
        cardStack.appendChild(cardDiv);
    });
}

// Fonction pour révéler la prochaine carte
function revealNextCard() {
    const cardElements = document.querySelectorAll('.card');
    
    if (currentCardIndex < cardElements.length) {
        // Montrer la carte suivante
        cardElements[currentCardIndex].classList.remove('hidden');
        cardElements[currentCardIndex].classList.add('revealed');
        currentCardIndex++;
    } else {
        // Plus de cartes à révéler
        document.getElementById('card-stack').removeEventListener('click', revealNextCard);
    }
}

// Fonction pour retirer la carte actuelle
function removeCurrentCard() {
    const cardElements = document.querySelectorAll('.card');
    
    if (currentCardIndex > 0) {
        // Retirer la dernière carte révélée
        cardElements[currentCardIndex - 1].classList.add('removed');
    }
}

// Fonction pour ouvrir le booster et révéler les cartes
document.getElementById('booster').addEventListener('click', async function () {
    const booster = document.getElementById('booster');
    
    // Ajouter la classe d'animation d'ouverture du booster
    booster.classList.add('opening');

    // Récupérer les 10 cartes depuis la base de données
    cards = await fetchRandomCards();

    // Après l'animation d'ouverture, afficher les cartes
    setTimeout(() => {
        displayCards(cards); // Afficher les cartes dans le stack
        revealNextCard(); // Révéler la première carte
        document.getElementById('card-stack').addEventListener('click', function () {
            removeCurrentCard(); // Retirer la carte actuelle
            revealNextCard(); // Révéler la suivante
        });
    }, 2000); // Attendre que l'animation d'ouverture du booster soit terminée
});
