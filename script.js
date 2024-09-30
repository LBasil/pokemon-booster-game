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
    const langFilePath = `${lang}.json`;

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

// Fonction d'inscription avec username et password
async function signUp(username, password) {
    // Vérifier si le nom d'utilisateur existe déjà
    const { data: existingUser, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('username', username)
        .single();

    if (existingUser) {
        alert('Nom d\'utilisateur déjà pris.');
        return;
    }

    // Hasher le mot de passe avant de l'enregistrer
    /* const hashedPassword = await bcrypt.hash(password, 10);*/
    let hashedPassword = password;

    // Insérer le nouvel utilisateur dans la table
    const { data, error } = await supabase
        .from('users')
        .insert([{ username: username, password: hashedPassword }]);

    if (error) {
        console.error("Erreur lors de l'inscription : ", error.message);
    } else {
        console.log("Inscription réussie pour : ", username);
        alert('Inscription réussie !');
    }
}


// Fonction de connexion avec username et password
async function signIn(username, password) {
    // Récupérer l'utilisateur par nom d'utilisateur
    const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('username', username)
        .single();

    if (!user) {
        alert('Nom d\'utilisateur non trouvé.');
        return;
    }

    // Vérifier le mot de passe hashé
    /*const isPasswordValid = await bcrypt.compare(password, user.password);*/
    let isPasswordValid = password === user.password;
    if (!isPasswordValid) {
        alert('Mot de passe incorrect.');
    } else {
        alert('Connexion réussie !');
        console.log('Utilisateur connecté : ', username);
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
