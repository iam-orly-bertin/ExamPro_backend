const bcrypt = require("bcryptjs");
const base = require("../database/connexion");

// Garantit qu'un administrateur existe, d'apres les variables d'environnement.
// Variables : ADMIN_EMAIL, ADMIN_MOT_DE_PASSE, ADMIN_NOM (facultatif)
function creerAdminAuto() {
    const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    const motDePasse = (process.env.ADMIN_MOT_DE_PASSE || "").trim();
    const nom = (process.env.ADMIN_NOM || "Administrateur").trim();

    if (!email || !motDePasse) {
        console.log("ADMIN_EMAIL ou ADMIN_MOT_DE_PASSE absent : aucun admin cree.");
        return;
    }

    if (!email.includes("@") || motDePasse.length < 8) {
        console.log("ADMIN_EMAIL ou ADMIN_MOT_DE_PASSE invalide (8 caracteres minimum).");
        return;
    }

    const empreinte = bcrypt.hashSync(motDePasse, 10);

    const existant = base.prepare(
        "SELECT id, role FROM utilisateurs WHERE email = ?"
    ).get(email);

    if (existant && existant.role !== "admin") {
        console.log("ADMIN_EMAIL est deja utilise par un compte non administrateur.");
        return;
    }

    if (existant) {
        base.prepare(
            "UPDATE utilisateurs SET mot_de_passe = ? WHERE id = ?"
        ).run(empreinte, existant.id);

        console.log(`Mot de passe admin aligne sur ADMIN_MOT_DE_PASSE : ${email}`);
        return;
    }

    base.prepare(`
        INSERT INTO utilisateurs (nom, email, mot_de_passe, role)
        VALUES (?, ?, ?, 'admin')
    `).run(nom, email, empreinte);

    console.log(`Administrateur cree automatiquement : ${email}`);
}

module.exports = { creerAdminAuto };