
require("dotenv").config();

const bcrypt = require("bcryptjs");
const base = require("./database/connexion");
const readline = require("readline");

// Demander les informations dans le terminal
const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function demander(texte) {
    return new Promise((resoudre) => {
        terminal.question(texte, resoudre);
    });
}

async function creerAdministrateur() {
    try {
        const nom = await demander("Nom de l'administrateur : ");
        const email = (
            await demander("Email : ")
        ).trim().toLowerCase();
        const motDePasse = await demander("Mot de passe (8 caracteres minimum) : ");

        if (!nom.trim() || !email.includes("@") ||
            motDePasse.length < 8) {
            console.log("Informations invalides.");
            return;
        }

        const existant = base.prepare(
            "SELECT id FROM utilisateurs WHERE email = ?"
        ).get(email);

        if (existant) {
            console.log("Cet email existe deja.");
            return;
        }

        const motDePasseSecurise =
            await bcrypt.hash(motDePasse, 10);

        base.prepare(`
            INSERT INTO utilisateurs
            (nom, email, mot_de_passe, role)
            VALUES (?, ?, ?, 'admin')
        `).run(nom.trim(), email, motDePasseSecurise);

        console.log("Administrateur cree avec succes.");
    } catch (erreur) {
        console.error("Erreur :", erreur.message);
    } finally {
        terminal.close();
    }
}

creerAdministrateur();
