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
            releaseDate: set.releaseDate,
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
    populateCards();
}

async function populateCards() {
    let hasMore = true;
    let page = 1;

    while (hasMore) {
        const response = await fetch(`${config.BASE_URL}/cards?page=${page}`, {
            headers: { 'X-Api-Key': config.API_KEY }
        });
        const data = await response.json();

        if (data.data.length === 0) {
            hasMore = false;
            break;
        }

        const cards = data.data.map(card => ({
            id: card.id,
            name: card.name,
            rarity: card.rarity || null,
            value: card.cardMarket ? card.cardMarket.prices.averageSellPrice : 0,
            imageUrl: card.images.large,
            artist: card.artist || null,
            nationalPokedexNumber: card.nationalPokedexNumbers ? card.nationalPokedexNumbers[0] : null,
            supertype: card.supertype,
            subtypes: card.subtypes ? card.subtypes.join(", ") : null,
            hp: card.hp || null,
            types: card.types ? card.types.join(", ") : null,
            imageSmall: card.images.small,
            setId: card.set.id // Associer la carte à son set
        }));

        const { error } = await supabase.from('cards').insert(cards);
        if (error) {
            console.error("Erreur lors de l'insertion des cartes : ", error.message);
            return;
        }

        page++;
    }
    console.log("Peuplement des cartes terminé.");
}


populateSets();
