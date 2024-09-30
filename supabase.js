// supabase.js

// Configuration Supabase
const config = {
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1keHFtemZ4YWxwc2t4dmp5bmNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mjc2OTczNzUsImV4cCI6MjA0MzI3MzM3NX0.h38Nvl2wVNZpeE50V-vjxqr6FwOdQMmU-PhJPinPsF8",
    SUPABASE_URL: "https://mdxqmzfxalpskxvjynco.supabase.co",
};

// Initialisation de Supabase
const supabase = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
