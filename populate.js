async function populateSets() {
    let hasMore = true;
    let page = 1;

    while (hasMore) {
        const response = await fetch(`${config.BASE_URL}/sets?page=${page}`, {
            headers: { 'X-Api-Key': config.API_KEY }
        });
        const data = await response.json();

        if (data.data.length === 0) {
            hasMore = false;
            break;
        }

        const sets = data.data.map(set => ({
            id: set.id,
            name: set.name,
            releaseDate: convertToTimestamp(set.releaseDate),
            printedTotal: set.printedTotal,
            total: set.total
        }));

        const { error } = await supabase.from('sets').insert(sets);
        if (error) {
            console.error("Erreur lors de l'insertion des sets : ", error.message);
            return;
        }

        page++;
    }
    console.log("Peuplement des sets terminé.");
}

async function populateCards() {
    let hasMore = true;
    let page = 1;

    while (hasMore) {
        try {
            // Requête à l'API avec la pagination
            const response = await fetch(`${config.BASE_URL}/cards?page=${page}`, {
                headers: { 'X-Api-Key': config.API_KEY }
            });

            const data = await response.json();

            // Si la réponse est vide, on arrête
            if (!data.data || data.data.length === 0) {
                hasMore = false;
                break;
            }

            // Extraction des cartes
            const cards = data.data.flatMap(card => ({
                id: card.id,
                name: card.name,
                rarity: card.rarity || null,
                value: card.cardMarket ? card.cardMarket.prices.averageSellPrice : 0,
                imageUrl: card.images.large,
                artist: card.artist || null,
                nationalPokedexNumber: card.nationalPokedexNumbers ? card.nationalPokedexNumbers[0] : null,
                supertype: card.supertype,
                type: card.subtypes ? card.subtypes.join(", ") : null,
                hp: card.hp || null,
                types: card.types ? card.types.join(", ") : null,
                imageSmall: card.images.small,
                setId: card.set.id // Associer la carte à son set
            }));

            // Insertion des cartes dans la base de données
            const { error } = await supabase.from('cards').insert(cards);
            if (error) {
                console.error("Erreur lors de l'insertion des cartes : ", error.message);
                return;
            }

            console.log(`Page ${page} traitée avec succès.`);
            page++;

            // Délai pour éviter de surcharger l'API
            await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
            console.error("Erreur lors de la récupération des cartes : ", error);
            hasMore = false;
        }
    }
    console.log("Peuplement des cartes terminé.");
}



populateCards();

function convertToTimestamp(dateString) {
    const date = new Date(dateString);
    return Math.floor(date.getTime() / 1000);  // Convertir en secondes

}
