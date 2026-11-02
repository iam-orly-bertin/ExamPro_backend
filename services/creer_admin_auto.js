const bcrypt = require("bcryptjs");
const base = require("../database/connexion");

// Cree un administrateur au demarrage s'il n'y en a aucun.
// Utile sur Render (offre gratuite) ou il n'y a pas de terminal.
// Variables : ADMIN_EMAIL, ADMIN_MOT_DE_PASSE, ADMIN_NOM (facultatif)
function creerAdminAuto() {
    const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    const motDePasse = process.env.ADMIN_MOT_DE_PASSE || "";
    const nom = (process.env.ADMIN_NOM || "Administrateur").trim();

    if (!email || !motDePasse) {
        return;
    }

    if (!email.includes("@") || motDePasse.length < 8) {
        console.log("ADMIN_EMAIL ou ADMIN_MOT_DE_PASSE invalide (8 caracteres minimum).");
        return;
    }

    const adminExistant = base.prepare(
        "SELECT id FROM utilisateurs WHERE role = 'admin' LIMIT 1"
    ).get();

    if (adminExistant) {
        return;
    }

    const emailPris = base.prepare(
        "SELECT id FROM utilisateurs WHERE email = ?"
    ).get(email);

    if (emailPris) {
        console.log("ADMIN_EMAIL est deja utilise par un compte non administrateur.");
        return;
    }

    base.prepare(`
        INSERT INTO utilisateurs (nom, email, mot_de_passe, role)
        VALUES (?, ?, ?, 'admin')
    `).run(nom, email, bcrypt.hashSync(motDePasse, 10));

    console.log(`Administrateur cree automatiquement : ${email}`);
}

module.exports = { creerAdminAuto };
