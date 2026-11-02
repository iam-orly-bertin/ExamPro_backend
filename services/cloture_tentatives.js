const base = require("../database/connexion");

// Marge accordee apres la fin du temps (reseau, horloge, soumission automatique)
const TOLERANCE_MS = 30 * 1000;

// Terminer une tentative restee ouverte.
// Si aucune reponse n'a ete soumise, la note est 0.
const cloturerTentative = base.transaction((utilisateurId, examenId) => {
    const tentative = base.prepare(`
        SELECT statut
        FROM tentatives_examens
        WHERE utilisateur_id = ? AND examen_id = ?
    `).get(utilisateurId, examenId);

    if (!tentative || tentative.statut !== "en_cours") {
        return false;
    }

    const resultatExistant = base.prepare(`
        SELECT id
        FROM resultats
        WHERE utilisateur_id = ? AND examen_id = ?
        LIMIT 1
    `).get(utilisateurId, examenId);

    if (!resultatExistant) {
        const total = base.prepare(`
            SELECT COUNT(*) AS total
            FROM questions
            WHERE examen_id = ?
        `).get(examenId).total;

        base.prepare(`
            INSERT INTO resultats
            (utilisateur_id, examen_id, score, total_questions)
            VALUES (?, ?, 0, ?)
        `).run(utilisateurId, examenId, total);
    }

    base.prepare(`
        UPDATE tentatives_examens
        SET statut = 'termine'
        WHERE utilisateur_id = ? AND examen_id = ?
    `).run(utilisateurId, examenId);

    return true;
});

// Cloturer toutes les tentatives dont le temps (plus la marge) est depasse
function cloturerTentativesExpirees() {
    const tentatives = base.prepare(`
        SELECT
            t.utilisateur_id,
            t.examen_id,
            t.date_debut,
            e.duree_minutes
        FROM tentatives_examens t
        JOIN examens e ON e.id = t.examen_id
        WHERE t.statut = 'en_cours'
    `).all();

    const maintenant = Date.now();
    let total = 0;

    for (const tentative of tentatives) {
        const debut = Date.parse(tentative.date_debut);

        if (Number.isNaN(debut)) {
            continue;
        }

        const limite =
            debut +
            tentative.duree_minutes * 60 * 1000 +
            TOLERANCE_MS;

        if (maintenant > limite) {
            try {
                if (cloturerTentative(
                    tentative.utilisateur_id,
                    tentative.examen_id
                )) {
                    total++;
                }
            } catch (erreur) {
                console.error("Erreur de cloture :", erreur.message);
            }
        }
    }

    return total;
}

// Lancer la cloture au demarrage puis a intervalle regulier
function demarrerCloture(intervalleMs = 60 * 1000) {
    const executer = () => {
        try {
            const total = cloturerTentativesExpirees();

            if (total > 0) {
                console.log(`${total} tentative(s) expiree(s) cloturee(s).`);
            }
        } catch (erreur) {
            console.error("Erreur de cloture :", erreur.message);
        }
    };

    executer();
    return setInterval(executer, intervalleMs);
}

module.exports = {
    TOLERANCE_MS,
    cloturerTentative,
    cloturerTentativesExpirees,
    demarrerCloture
};