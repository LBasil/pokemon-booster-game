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

// Fonction pour récupérer le userId à partir du username
async function getUserIdFromUsername(username) {
    const { data, error } = await supabase
        .from('users')
        .select('id')
        .eq('username', username)
        .single();

    if (error) {
        console.error('Erreur lors de la récupération du userId:', error);
        return null;
    }
    return data.id;
}

// Fonction pour ajouter ou mettre à jour les cartes dans la collection de l'utilisateur
async function addCardsToCollection(cards) {
    const username = localStorage.getItem('username');
    const userId = await getUserIdFromUsername(username);

    if (!userId) {
        console.error('Impossible de récupérer le userId');
        return;
    }

    for (const card of cards) {
        // Vérifier si la carte est déjà dans la collection de l'utilisateur
        const { data: existingCard, error: checkError } = await supabase
            .from('collections')
            .select('quantity')
            .eq('userId', userId)
            .eq('cardId', card.id)
            .maybeSingle();

        if (checkError && checkError.code !== 'PGRST116') { // Code pour "not found"
            console.error('Erreur lors de la vérification de la carte:', checkError);
            continue;
        }

        if (existingCard) {
            // La carte existe déjà, on met à jour la quantité
            const { error: updateError } = await supabase
                .from('collections')
                .update({ quantity: existingCard.quantity + 1 })
                .eq('userId', userId)
                .eq('cardId', card.id);

            if (updateError) {
                console.error('Erreur lors de la mise à jour de la quantité:', updateError);
            }
        } else {
            // La carte n'existe pas encore, on l'ajoute
            const { error: insertError } = await supabase
                .from('collections')
                .insert({
                    userId: userId,
                    cardId: card.id,
                    quantity: 1,
                    acquiredAt: new Date().toISOString() // Enregistre l'heure de l'obtention
                });

            if (insertError) {
                console.error('Erreur lors de l\'insertion de la carte:', insertError);
            }
        }
    }

    console.log('Cartes ajoutées ou mises à jour dans la collection');
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
        addCardsToCollection(cards);
    }, 2000); // Attendre que l'animation d'ouverture du booster soit terminée
});
