// supabase.js

// Configuration Supabase et TGC
const config = {
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1keHFtemZ4YWxwc2t4dmp5bmNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mjc2OTczNzUsImV4cCI6MjA0MzI3MzM3NX0.h38Nvl2wVNZpeE50V-vjxqr6FwOdQMmU-PhJPinPsF8",
    SUPABASE_URL: "https://mdxqmzfxalpskxvjynco.supabase.co",
    API_KEY: "82b1953f-af42-4e3a-9700-16444065f44b",
    BASE_URL: "https://api.pokemontcg.io/v2",
};

// Initialisation de Supabase
const supabase = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
