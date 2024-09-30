// Default language
let currentLang = 'en';

// Load translation file
function loadLanguage(lang) {
    fetch(`${lang}.json`)
        .then(response => response.json())
        .then(data => {
            console.log('WIP -- data', data);
            document.getElementById('welcome-message').textContent = data.welcome;
            document.getElementById('login').textContent = data.login;
            document.getElementById('signup').textContent = data.signup;
        });
}

// Load the default language on page load
window.onload = () => {
    loadLanguage(currentLang);
};

// Update language when the user selects a new one
document.getElementById('language-select').addEventListener('change', (event) => {
    currentLang = event.target.value;
    loadLanguage(currentLang);
});

// SUPABASE

// Remplace par tes propres clés Supabase

const SUPABASE_URL = process.env.SUPABASE_URL ||'https://mdxqmzfxalpskxvjynco.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1keHFtemZ4YWxwc2t4dmp5bmNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mjc2OTczNzUsImV4cCI6MjA0MzI3MzM3NX0.h38Nvl2wVNZpeE50V-vjxqr6FwOdQMmU-PhJPinPsF8';

// Initialisation de Supabase
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

// Boutons de login et signup
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

