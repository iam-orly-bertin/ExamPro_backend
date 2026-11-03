const base = require("../database/connexion");

// Marge accordee apres la fin du temps (reseau, horloge, soumission automatique)
const TOLERANCE_MS = 30 * 1000;

// Terminer une tentative restee ouverte.
// Si aucune reponse n'a ete soumise, la note est 0.
const cloturerTentative = base.transaction((tentativeId) => {
    const tentative = base.prepare(`
        SELECT id, utilisateur_id, examen_id, statut
        FROM tentatives
        WHERE id = ?
    `).get(tentativeId);

    if (!tentative || tentative.statut !== "en_cours") {
        return false;
    }

    const resultatExistant = base.prepare(`
        SELECT id FROM resultats WHERE tentative_id = ?
    `).get(tentativeId);

    if (!resultatExistant) {
        const { total, points } = base.prepare(`
            SELECT COUNT(*) AS total, COALESCE(SUM(points), 0) AS points
            FROM questions WHERE examen_id = ?
        `).get(tentative.examen_id);

        base.prepare(`
            INSERT INTO resultats
            (utilisateur_id, examen_id, score, total_questions,
             tentative_id, total_points)
            VALUES (?, ?, 0, ?, ?, ?)
        `).run(
            tentative.utilisateur_id,
            tentative.examen_id,
            total,
            tentativeId,
            points
        );
    }

    base.prepare(`
        UPDATE tentatives
        SET statut = 'termine', date_fin = ?
        WHERE id = ?
    `).run(new Date().toISOString(), tentativeId);

    return true;
});

// Cloturer toutes les tentatives dont le temps (plus la marge) est depasse
function cloturerTentativesExpirees() {
    const tentatives = base.prepare(`
        SELECT t.id, t.date_debut, e.duree_minutes
        FROM tentatives t
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
                if (cloturerTentative(tentative.id)) {
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