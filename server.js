require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

// Le secret des jetons est indispensable : on refuse de demarrer sans lui
if (!process.env.JETON_SECRET || process.env.JETON_SECRET.length < 32) {
    console.error("JETON_SECRET manquant ou trop court (32 caracteres minimum).");
    process.exit(1);
}

// Importer les routes
const routeAuthentification =
    require("./routes/authentification");

const routeAdministration =
    require("./routes/administration");

const routeExamens =
    require("./routes/examens");

const {
    demarrerCloture
} = require("./services/cloture_tentatives");

const {
    creerAdminAuto
} = require("./services/creer_admin_auto");

const application = express();

// Render place l'application derriere un proxy : necessaire pour lire la vraie adresse IP
application.set("trust proxy", 1);

// En-tetes de securite
application.use(helmet());

// Autoriser uniquement le(s) site(s) du frontend.
// FRONTEND_URL peut contenir plusieurs adresses separees par des virgules,
// sans "/" final et sans chemin. Exemple : https://pseudo.github.io
const originesAutorisees = (process.env.FRONTEND_URL || "")
    .split(",")
    .map(origine => origine.trim().replace(/\/+$/, ""))
    .filter(Boolean);

application.use(cors({
    origin(origine, rappel) {
        // Pas d'origine = outil comme curl ou verification de sante
        if (!origine) return rappel(null, true);

        return rappel(null, originesAutorisees.includes(origine));
    }
}));

// Lire les donnees JSON envoyees par le frontend
application.use(express.json({ limit: "1mb" }));

// Route d'accueil pour verifier le fonctionnement du serveur
application.get("/", (req, res) => {
    res.json({
        message: "Bienvenue sur l'API ExamPro."
    });
});

// Connecter les routes a leurs adresses
application.use("/api/auth", routeAuthentification);

application.use("/api/admin", routeAdministration);

application.use("/api/examens", routeExamens);

// Signaler les routes inexistantes
application.use((req, res) => {
    res.status(404).json({
        message: "Route introuvable."
    });
});

// Demarrer le serveur
const port = process.env.PORT || 3000;

application.listen(port, () => {
    console.log(`Serveur ExamPro demarre sur le port ${port}`);

    // Creer l'administrateur initial si les variables sont definies
    creerAdminAuto();

    // Cloturer les tentatives dont le temps est depasse
    demarrerCloture();
});
