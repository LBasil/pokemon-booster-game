// Configuration Supabase
const config = {
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1keHFtemZ4YWxwc2t4dmp5bmNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mjc2OTczNzUsImV4cCI6MjA0MzI3MzM3NX0.h38Nvl2wVNZpeE50V-vjxqr6FwOdQMmU-PhJPinPsF8",
    SUPABASE_URL: "https://mdxqmzfxalpskxvjynco.supabase.co",
};

// Langue par défaut
let currentLang = 'en';

// Fonction pour charger le fichier de langue
function loadLanguage(lang) {
    // Construit le chemin vers le fichier de langue en local ou sur Vercel
    const langFilePath = `./localisation/${lang}.json`;

    fetch(langFilePath)
        .then(response => {
            if (!response.ok) {
                throw new Error(`Fichier de langue introuvable: ${langFilePath}`);
            }
            return response.json();
        })
        .then(data => {
            document.getElementById('welcome-message').textContent = data.welcome;
            document.getElementById('login').textContent = data.login;
            document.getElementById('signup').textContent = data.signup;
        })
        .catch(error => console.error('Erreur de chargement de la langue:', error));
}

// Charger la langue par défaut au chargement de la page
window.onload = () => {
    loadLanguage(currentLang);
};

// Mettre à jour la langue lorsque l'utilisateur en sélectionne une nouvelle
document.getElementById('language-select').addEventListener('change', (event) => {
    currentLang = event.target.value;
    loadLanguage(currentLang);
});

// INITIALISATION SUPABASE

const SUPABASE_URL = config.SUPABASE_URL;
const SUPABASE_ANON_KEY = config.SUPABASE_ANON_KEY;

// Initialisation de Supabase
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Fonction pour gérer l'inscription
async function signUp(email, password) {
    const { user, error } = await supabase.auth.signUp({
        email: email,
        password: password
    });

    if (error) {
        console.error("Erreur d'inscription : ", error.message);
    } else {
        console.log("Inscription réussie pour : ", user.email);
        alert('Inscription réussie ! Vérifiez votre boîte mail.');
    }
}

// Fonction pour gérer la connexion
async function signIn(email, password) {
    const { user, error } = await supabase.auth.signIn({
        email: email,
        password: password
    });

    if (error) {
        console.error("Erreur de connexion : ", error.message);
    } else {
        console.log("Connexion réussie pour : ", user.email);
        alert('Connexion réussie !');
    }
}

// Gestion des boutons de login et signup
document.getElementById('login').addEventListener('click', () => {
    const email = prompt('Entrez votre email :');
    const password = prompt('Entrez votre mot de passe :');
    signIn(email, password);
});

document.getElementById('signup').addEventListener('click', () => {
    const email = prompt('Entrez votre email :');
    const password = prompt('Entrez votre mot de passe :');
    signUp(email, password);
});
