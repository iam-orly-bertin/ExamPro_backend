const base = require("../database/connexion");

// Copie les anciennes tentatives (table tentatives_examens) vers la nouvelle
// table "tentatives" et relie les resultats existants a leur tentative.
// Peut etre relancee a chaque demarrage sans risque (rien n'est duplique).
function migrerTentatives() {
    const ancienne = base.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'tentatives_examens'
    `).get();

    if (!ancienne) {
        return;
    }

    const migrer = base.transaction(() => {
        base.exec(`
            INSERT INTO tentatives
                (utilisateur_id, examen_id, numero, date_debut, statut)
            SELECT o.utilisateur_id, o.examen_id, 1, o.date_debut, o.statut
            FROM tentatives_examens o
            WHERE NOT EXISTS (
                SELECT 1 FROM tentatives t
                WHERE t.utilisateur_id = o.utilisateur_id
                  AND t.examen_id = o.examen_id
                  AND t.numero = 1
            );

            UPDATE resultats
            SET tentative_id = (
                SELECT t.id FROM tentatives t
                WHERE t.utilisateur_id = resultats.utilisateur_id
                  AND t.examen_id = resultats.examen_id
                  AND t.numero = 1
            )
            WHERE tentative_id IS NULL;

            UPDATE resultats
            SET total_points = total_questions
            WHERE total_points IS NULL;
        `);
    });

    migrer();
}

module.exports = { migrerTentatives };