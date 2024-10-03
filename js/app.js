// app.js

let currentLang = 'en';

// Fonction pour charger la langue
function loadLanguage(lang) {
    const langFilePath = `./${lang}.json`;

    fetch(langFilePath)
        .then(response => response.json())
        .then(data => {
            document.getElementById('welcome-message').textContent = data.welcome;
            document.getElementById('login').textContent = data.login;
            document.getElementById('signup').textContent = data.signup;
        })
        .catch(error => console.error('Erreur de chargement de la langue:', error));
}

// Charger la langue au démarrage
window.onload = () => {
    loadLanguage(currentLang);
};

// Gestion du changement de langue
document.getElementById('language-select').addEventListener('change', (event) => {
    currentLang = event.target.value;
    loadLanguage(currentLang);
});

// Fonction d'inscription
async function signUp(username, password) {
    const { data: existingUser } = await supabase
        .from('users')
        .select('*')
        .eq('username', username)
        .single();

    if (existingUser) {
        alert('Nom d\'utilisateur déjà pris.');
        return;
    }

    const { error } = await supabase
        .from('users')
        .insert([{ username: username, password }]);

    if (error) {
        console.error("Erreur lors de l'inscription : ", error.message);
    } else {
        alert('Inscription réussie !');
    }
}

// Fonction de connexion 
async function signIn(username, password) {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('username', username)
        .eq('password', password);

    if (error) {
        console.error('Erreur lors de la connexion :', error.message);
        return;
    }

    if (data.length > 0) {
        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('username', username);
        window.location.href = 'game.html';
    } else {
        alert('Nom d’utilisateur ou mot de passe incorrect.');
    }
}

// Gestion des boutons
document.getElementById('login').addEventListener('click', () => {
    const username = prompt('Entrez votre nom d\'utilisateur :');
    const password = prompt('Entrez votre mot de passe :');
    signIn(username, password);
});

document.getElementById('signup').addEventListener('click', () => {
    const username = prompt('Entrez votre nom d\'utilisateur :');
    const password = prompt('Entrez votre mot de passe :');
    signUp(username, password);
});
