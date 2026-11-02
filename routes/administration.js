const express = require("express");
const router = express.Router();

const base = require("../database/connexion");

const {
    verifierUtilisateur,
    verifierAdmin
} = require("../middleware/verifier_utilisateur");

// Toutes les routes de ce fichier sont reservees aux administrateurs.
router.use(verifierUtilisateur, verifierAdmin);

// ----- Lecture et controle du planning d'un examen -----

// Valeur vide = pas de date. Sinon la date est convertie au format ISO (UTC).
function lireDate(valeur) {
    if (valeur === undefined || valeur === null || valeur === "") {
        return { valeur: null };
    }

    if (typeof valeur !== "string" || Number.isNaN(Date.parse(valeur))) {
        return { erreur: true };
    }

    return { valeur: new Date(valeur).toISOString() };
}

// Renvoie { erreur } ou les valeurs pretes a etre enregistrees
function lirePlanning(corps) {
    const statut = corps.statut === undefined ? "publie" : corps.statut;

    if (statut !== "publie" && statut !== "brouillon") {
        return { erreur: "Le statut doit être « publie » ou « brouillon »." };
    }

    const ouverture = lireDate(corps.date_ouverture);
    const fermeture = lireDate(corps.date_fermeture);

    if (ouverture.erreur || fermeture.erreur) {
        return { erreur: "Une date d'ouverture ou de fermeture est invalide." };
    }

    if (
        ouverture.valeur && fermeture.valeur &&
        Date.parse(fermeture.valeur) <= Date.parse(ouverture.valeur)
    ) {
        return { erreur: "La date de fermeture doit être après la date d'ouverture." };
    }

    const note = corps.note_reussite === undefined
        ? 50 : Number(corps.note_reussite);

    if (!Number.isInteger(note) || note < 0 || note > 100) {
        return { erreur: "La note de réussite doit être un entier entre 0 et 100." };
    }

    const tentatives = corps.nb_tentatives_max === undefined
        ? 1 : Number(corps.nb_tentatives_max);

    if (!Number.isInteger(tentatives) || tentatives < 1 || tentatives > 20) {
        return { erreur: "Le nombre de tentatives doit être un entier entre 1 et 20." };
    }

    return {
        statut,
        date_ouverture: ouverture.valeur,
        date_fermeture: fermeture.valeur,
        note_reussite: note,
        nb_tentatives_max: tentatives
    };
}


/* ==================================================
   1. GESTION DES COURS
   ================================================== */

// GET : afficher tous les cours
router.get("/cours", (req, res) => {
    try {
        const cours = base.prepare(`
            SELECT id, titre, description
            FROM cours
            ORDER BY id DESC
        `).all();

        res.json(cours);
    } catch (erreur) {
        console.error(erreur);
        res.status(500).json({
            message: "Erreur lors du chargement des cours."
        });
    }
});


// POST : ajouter un cours
router.post("/cours", (req, res) => {
    const { titre, description } = req.body;

    if (typeof titre !== "string" || !titre.trim()) {
        return res.status(400).json({
            message: "Le titre du cours est obligatoire."
        });
    }

    try {
        const resultat = base.prepare(`
            INSERT INTO cours (titre, description)
            VALUES (?, ?)
        `).run(
            titre.trim(),
            typeof description === "string" ? description.trim() : ""
        );

        res.status(201).json({
            message: "Cours ajoute avec succes.",
            id: Number(resultat.lastInsertRowid)
        });
    } catch (erreur) {
        console.error(erreur);
        res.status(500).json({
            message: "Erreur lors de l'ajout du cours."
        });
    }
});


// PUT : modifier un cours
router.put("/cours/:id", (req, res) => {
    const id = Number(req.params.id);
    const { titre, description } = req.body;

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
            message: "Identifiant du cours invalide."
        });
    }

    if (typeof titre !== "string" || !titre.trim()) {
        return res.status(400).json({
            message: "Le titre du cours est obligatoire."
        });
    }

    try {
        const cours = base.prepare(
            "SELECT id FROM cours WHERE id = ?"
        ).get(id);

        if (!cours) {
            return res.status(404).json({
                message: "Cours introuvable."
            });
        }

        base.prepare(`
            UPDATE cours
            SET titre = ?, description = ?
            WHERE id = ?
        `).run(
            titre.trim(),
            typeof description === "string" ? description.trim() : "",
            id
        );

        res.json({
            message: "Cours modifie avec succes."
        });
    } catch (erreur) {
        console.error(erreur);
        res.status(500).json({
            message: "Erreur lors de la modification du cours."
        });
    }
});


// DELETE : supprimer un cours sans examen associe
router.delete("/cours/:id", (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
            message: "Identifiant du cours invalide."
        });
    }

    try {
        const cours = base.prepare(
            "SELECT id FROM cours WHERE id = ?"
        ).get(id);

        if (!cours) {
            return res.status(404).json({
                message: "Cours introuvable."
            });
        }

        const examensAssocies = base.prepare(`
            SELECT COUNT(*) AS total
            FROM examens
            WHERE cours_id = ?
        `).get(id);

        if (examensAssocies.total > 0) {
            return res.status(409).json({
                message: "Ce cours est associe a des examens. Supprimez ou reaffectez d'abord ces examens."
            });
        }

        base.prepare(
            "DELETE FROM cours WHERE id = ?"
        ).run(id);

        res.json({
            message: "Cours supprime avec succes."
        });
    } catch (erreur) {
        console.error(erreur);
        res.status(500).json({
            message: "Erreur lors de la suppression du cours."
        });
    }
});


/* ==================================================
   2. GESTION DES EXAMENS
   ================================================== */

// GET : afficher les examens pour l'administration
router.get("/examens", (req, res) => {
    try {
        const examens = base.prepare(`
            SELECT
                e.id,
                e.titre,
                e.cours_id,
                e.duree_minutes,
                e.statut,
                e.date_ouverture,
                e.date_fermeture,
                e.note_reussite,
                e.nb_tentatives_max,
                c.titre AS cours_titre,
                COUNT(DISTINCT q.id) AS nombre_questions,
                (
                    SELECT COUNT(*) FROM resultats r
                    WHERE r.examen_id = e.id
                ) AS nombre_resultats,
                (
                    SELECT COUNT(*) FROM tentatives t
                    WHERE t.examen_id = e.id
                ) AS nombre_tentatives
            FROM examens e
            LEFT JOIN cours c ON c.id = e.cours_id
            LEFT JOIN questions q ON q.examen_id = e.id
            GROUP BY
                e.id,
                e.titre,
                e.cours_id,
                e.duree_minutes,
                e.statut,
                e.date_ouverture,
                e.date_fermeture,
                e.note_reussite,
                e.nb_tentatives_max,
                c.titre
            ORDER BY e.id DESC
        `).all();

        res.json(examens);
    } catch (erreur) {
        console.error(erreur);
        res.status(500).json({
            message: "Erreur lors du chargement des examens."
        });
    }
});


// POST : creer un examen avec ses questions et choix
router.post("/examens", (req, res) => {
    const {
        cours_id,
        titre,
        duree_minutes,
        questions
    } = req.body;

    const idCours = Number(cours_id);
    const duree = Number(duree_minutes);

    const planning = lirePlanning(req.body);

    if (planning.erreur) {
        return res.status(400).json({
            message: planning.erreur
        });
    }

    if (!Number.isInteger(idCours) || idCours <= 0) {
        return res.status(400).json({
            message: "Veuillez selectionner un cours valide."
        });
    }

    if (typeof titre !== "string" || !titre.trim()) {
        return res.status(400).json({
            message: "Le titre de l'examen est obligatoire."
        });
    }

    if (!Number.isInteger(duree) || duree <= 0) {
        return res.status(400).json({
            message: "La duree doit etre un nombre entier positif."
        });
    }

    if (!Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({
            message: "Ajoutez au moins une question."
        });
    }

    // Verifier les questions et leurs choix avant l'insertion.
    for (let i = 0; i < questions.length; i++) {
        const question = questions[i];

        if (
            !question ||
            typeof question.texte !== "string" ||
            !question.texte.trim()
        ) {
            return res.status(400).json({
                message: `Le texte de la question ${i + 1} est obligatoire.`
            });
        }

        if (!Array.isArray(question.choix) || question.choix.length < 2) {
            return res.status(400).json({
                message: `La question ${i + 1} doit avoir au moins deux choix.`
            });
        }

        for (const choix of question.choix) {
            if (
                !choix ||
                typeof choix.texte !== "string" ||
                !choix.texte.trim() ||
                typeof choix.est_correcte !== "boolean"
            ) {
                return res.status(400).json({
                    message: `Les choix de la question ${i + 1} sont invalides.`
                });
            }
        }

        const nombreCorrectes = question.choix.filter(
            choix => choix.est_correcte === true
        ).length;

        if (nombreCorrectes !== 1) {
            return res.status(400).json({
                message: `La question ${i + 1} doit avoir exactement une bonne reponse.`
            });
        }
    }

    try {
        const cours = base.prepare(
            "SELECT id FROM cours WHERE id = ?"
        ).get(idCours);

        if (!cours) {
            return res.status(404).json({
                message: "Le cours selectionne n'existe pas."
            });
        }

        // Une transaction garantit que l'examen et toutes ses
        // questions sont enregistres ensemble ou pas du tout.
        const creerExamen = base.transaction(() => {
            const resultatExamen = base.prepare(`
                INSERT INTO examens
                (cours_id, titre, duree_minutes, statut,
                 date_ouverture, date_fermeture,
                 note_reussite, nb_tentatives_max)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                idCours,
                titre.trim(),
                duree,
                planning.statut,
                planning.date_ouverture,
                planning.date_fermeture,
                planning.note_reussite,
                planning.nb_tentatives_max
            );

            const examenId = Number(resultatExamen.lastInsertRowid);

            const insererQuestion = base.prepare(`
                INSERT INTO questions (examen_id, texte)
                VALUES (?, ?)
            `);

            const insererChoix = base.prepare(`
                INSERT INTO choix_reponses
                    (question_id, texte, est_correcte)
                VALUES (?, ?, ?)
            `);

            for (const question of questions) {
                const resultatQuestion = insererQuestion.run(
                    examenId,
                    question.texte.trim()
                );

                const questionId = Number(
                    resultatQuestion.lastInsertRowid
                );

                for (const choix of question.choix) {
                    insererChoix.run(
                        questionId,
                        choix.texte.trim(),
                        choix.est_correcte ? 1 : 0
                    );
                }
            }

            return examenId;
        });

        const examenId = creerExamen();

        res.status(201).json({
            message: "Examen cree avec succes.",
            examen_id: examenId
        });
    } catch (erreur) {
        console.error(erreur);
        res.status(500).json({
            message: "Erreur lors de la creation de l'examen."
        });
    }
});


/* ==================================================
   3. CONSULTATION DES RESULTATS
   ================================================== */

// GET : afficher les resultats de tous les etudiants
router.get("/resultats", (req, res) => {
    try {
        const resultats = base.prepare(`
            SELECT
                r.*,
                u.nom AS etudiant_nom,
                u.email AS etudiant_email,
                e.titre AS examen_titre,
                e.note_reussite,
                t.numero AS tentative_numero
            FROM resultats r
            LEFT JOIN utilisateurs u ON u.id = r.utilisateur_id
            LEFT JOIN examens e ON e.id = r.examen_id
            LEFT JOIN tentatives t ON t.id = r.tentative_id
            ORDER BY r.id DESC
        `).all();

        res.json(resultats);
    } catch (erreur) {
        console.error(erreur);
        res.status(500).json({
            message: "Erreur lors du chargement des resultats."
        });
    }
});



/* ==================================================
   MODIFICATION ET SUPPRESSION DES EXAMENS
   ================================================== */

// GET : récupérer un examen avec ses questions et ses choix
router.get("/examens/:id", (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
            message: "Identifiant de l'examen invalide."
        });
    }

    try {
        const examen = base.prepare(`
            SELECT id, cours_id, titre, duree_minutes, statut,
                   date_ouverture, date_fermeture,
                   note_reussite, nb_tentatives_max
            FROM examens
            WHERE id = ?
        `).get(id);

        if (!examen) {
            return res.status(404).json({
                message: "Examen introuvable."
            });
        }

        const questions = base.prepare(`
            SELECT id, texte
            FROM questions
            WHERE examen_id = ?
            ORDER BY id
        `).all(id);

        const obtenirChoix = base.prepare(`
            SELECT id, texte, est_correcte
            FROM choix_reponses
            WHERE question_id = ?
            ORDER BY id
        `);

        examen.questions = questions.map(question => ({
            id: question.id,
            texte: question.texte,
            choix: obtenirChoix.all(question.id).map(choix => ({
                id: choix.id,
                texte: choix.texte,
                est_correcte: Boolean(choix.est_correcte)
            }))
        }));

        res.json(examen);
    } catch (erreur) {
        console.error(erreur);
        res.status(500).json({
            message: "Erreur lors du chargement de l'examen."
        });
    }
});


// PUT : modifier un examen et remplacer ses questions
router.put("/examens/:id", (req, res) => {
    const id = Number(req.params.id);
    const { cours_id, titre, duree_minutes, questions } = req.body;

    const idCours = Number(cours_id);
    const duree = Number(duree_minutes);

    const planning = lirePlanning(req.body);

    if (planning.erreur) {
        return res.status(400).json({
            message: planning.erreur
        });
    }

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
            message: "Identifiant de l'examen invalide."
        });
    }

    if (!Number.isInteger(idCours) || idCours <= 0) {
        return res.status(400).json({
            message: "Veuillez sélectionner un cours valide."
        });
    }

    if (typeof titre !== "string" || !titre.trim()) {
        return res.status(400).json({
            message: "Le titre de l'examen est obligatoire."
        });
    }

    if (!Number.isInteger(duree) || duree <= 0) {
        return res.status(400).json({
            message: "La durée doit être un entier positif."
        });
    }

    if (!Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({
            message: "Ajoutez au moins une question."
        });
    }

    for (let i = 0; i < questions.length; i++) {
        const question = questions[i];

        if (
            !question ||
            typeof question.texte !== "string" ||
            !question.texte.trim()
        ) {
            return res.status(400).json({
                message: `Le texte de la question ${i + 1} est obligatoire.`
            });
        }

        if (!Array.isArray(question.choix) || question.choix.length < 2) {
            return res.status(400).json({
                message: `La question ${i + 1} doit avoir au moins deux choix.`
            });
        }

        for (const choix of question.choix) {
            if (
                !choix ||
                typeof choix.texte !== "string" ||
                !choix.texte.trim() ||
                typeof choix.est_correcte !== "boolean"
            ) {
                return res.status(400).json({
                    message: `Les choix de la question ${i + 1} sont invalides.`
                });
            }
        }

        const nombreCorrectes = question.choix.filter(
            choix => choix.est_correcte
        ).length;

        if (nombreCorrectes !== 1) {
            return res.status(400).json({
                message: `La question ${i + 1} doit avoir exactement une bonne réponse.`
            });
        }
    }

    try {
        const examen = base.prepare(
            "SELECT id FROM examens WHERE id = ?"
        ).get(id);

        if (!examen) {
            return res.status(404).json({
                message: "Examen introuvable."
            });
        }

        const cours = base.prepare(
            "SELECT id FROM cours WHERE id = ?"
        ).get(idCours);

        if (!cours) {
            return res.status(404).json({
                message: "Le cours sélectionné n'existe pas."
            });
        }

        // Protéger l'historique des examens déjà passés.
        const resultatExistant = base.prepare(
            "SELECT id FROM resultats WHERE examen_id = ? LIMIT 1"
        ).get(id);

        if (resultatExistant) {
            return res.status(409).json({
                message: "Cet examen possède déjà des résultats. Pour conserver l'historique, sa modification est bloquée."
            });
        }

        // Un étudiant a commencé l'examen (même sans résultat enregistré)
        const tentativeExistante = base.prepare(
            "SELECT id FROM tentatives WHERE examen_id = ? LIMIT 1"
        ).get(id);

        if (tentativeExistante) {
            return res.status(409).json({
                message: "Des étudiants ont déjà commencé cet examen : sa modification est bloquée."
            });
        }

        const modifierExamen = base.transaction(() => {
            base.prepare(`
                UPDATE examens
                SET cours_id = ?, titre = ?, duree_minutes = ?,
                    statut = ?, date_ouverture = ?, date_fermeture = ?,
                    note_reussite = ?, nb_tentatives_max = ?
                WHERE id = ?
            `).run(
                idCours,
                titre.trim(),
                duree,
                planning.statut,
                planning.date_ouverture,
                planning.date_fermeture,
                planning.note_reussite,
                planning.nb_tentatives_max,
                id
            );

            // Supprimer les anciens choix et les anciennes questions.
            base.prepare(`
                DELETE FROM choix_reponses
                WHERE question_id IN (
                    SELECT id FROM questions WHERE examen_id = ?
                )
            `).run(id);

            base.prepare(
                "DELETE FROM questions WHERE examen_id = ?"
            ).run(id);

            const insererQuestion = base.prepare(`
                INSERT INTO questions (examen_id, texte)
                VALUES (?, ?)
            `);

            const insererChoix = base.prepare(`
                INSERT INTO choix_reponses
                    (question_id, texte, est_correcte)
                VALUES (?, ?, ?)
            `);

            for (const question of questions) {
                const resultatQuestion = insererQuestion.run(
                    id,
                    question.texte.trim()
                );

                const questionId = Number(resultatQuestion.lastInsertRowid);

                for (const choix of question.choix) {
                    insererChoix.run(
                        questionId,
                        choix.texte.trim(),
                        choix.est_correcte ? 1 : 0
                    );
                }
            }
        });

        modifierExamen();

        res.json({
            message: "Examen modifié avec succès."
        });
    } catch (erreur) {
        console.error(erreur);
        res.status(500).json({
            message: "Erreur lors de la modification de l'examen."
        });
    }
});


// DELETE : supprimer un examen
router.delete("/examens/:id", (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
            message: "Identifiant de l'examen invalide."
        });
    }

    try {
        const examen = base.prepare(
            "SELECT id FROM examens WHERE id = ?"
        ).get(id);

        if (!examen) {
            return res.status(404).json({
                message: "Examen introuvable."
            });
        }

        // Conserver les examens ayant déjà des résultats.
        const resultatExistant = base.prepare(
            "SELECT id FROM resultats WHERE examen_id = ? LIMIT 1"
        ).get(id);

        if (resultatExistant) {
            return res.status(409).json({
                message: "Cet examen possède déjà des résultats et ne peut pas être supprimé."
            });
        }

        const tentativeExistante = base.prepare(
            "SELECT id FROM tentatives WHERE examen_id = ? LIMIT 1"
        ).get(id);

        if (tentativeExistante) {
            return res.status(409).json({
                message: "Des étudiants ont déjà commencé cet examen : il ne peut pas être supprimé."
            });
        }

        const supprimerExamen = base.transaction(() => {
            base.prepare(`
                DELETE FROM choix_reponses
                WHERE question_id IN (
                    SELECT id FROM questions WHERE examen_id = ?
                )
            `).run(id);

            base.prepare(
                "DELETE FROM questions WHERE examen_id = ?"
            ).run(id);

            base.prepare(
                "DELETE FROM examens WHERE id = ?"
            ).run(id);
        });

        supprimerExamen();

        res.json({
            message: "Examen supprimé avec succès."
        });
    } catch (erreur) {
        console.error(erreur);
        res.status(500).json({
            message: "Erreur lors de la suppression de l'examen."
        });
    }
});



/* ==================================================
   4. STATISTIQUES DU TABLEAU DE BORD
   ================================================== */

router.get("/statistiques", (req, res) => {
    try {
        const statistiques = {
            etudiants: base.prepare(`
                SELECT COUNT(*) AS total
                FROM utilisateurs
                WHERE role = 'etudiant'
            `).get().total,

            cours: base.prepare(`
                SELECT COUNT(*) AS total FROM cours
            `).get().total,

            examens: base.prepare(`
                SELECT COUNT(*) AS total FROM examens
            `).get().total,

            resultats: base.prepare(`
                SELECT COUNT(*) AS total FROM resultats
            `).get().total
        };

        res.json(statistiques);
    } catch (erreur) {
        console.error(erreur);
        res.status(500).json({
            message: "Impossible de charger les statistiques."
        });
    }
});


/* ==================================================
   5. APERÇU DES DERNIERS UTILISATEURS
   ================================================== */

router.get("/utilisateurs/recents", (req, res) => {
    try {
        const utilisateurs = base.prepare(`
            SELECT id, nom, email, role
            FROM utilisateurs
            ORDER BY id DESC
            LIMIT 5
        `).all();

        res.json(utilisateurs);
    } catch (erreur) {
        console.error(erreur);
        res.status(500).json({
            message: "Impossible de charger les utilisateurs."
        });
    }
});



// Lister tous les utilisateurs
router.get("/utilisateurs", (req, res) => {
    try {
        const utilisateurs = base.prepare(`
            SELECT id, nom, email, role
            FROM utilisateurs
            ORDER BY id DESC
        `).all();

        res.json(utilisateurs);
    } catch (erreur) {
        console.error(erreur);
        res.status(500).json({
            message: "Impossible de récupérer les utilisateurs."
        });
    }
});


/* ==================================================
   6. PLANNING D'UN EXAMEN (modifiable meme si l'examen est verrouille)
   ================================================== */

router.patch("/examens/:id/planning", (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
            message: "Identifiant de l'examen invalide."
        });
    }

    const planning = lirePlanning(req.body);

    if (planning.erreur) {
        return res.status(400).json({
            message: planning.erreur
        });
    }

    try {
        const resultat = base.prepare(`
            UPDATE examens
            SET statut = ?, date_ouverture = ?, date_fermeture = ?,
                note_reussite = ?, nb_tentatives_max = ?
            WHERE id = ?
        `).run(
            planning.statut,
            planning.date_ouverture,
            planning.date_fermeture,
            planning.note_reussite,
            planning.nb_tentatives_max,
            id
        );

        if (resultat.changes === 0) {
            return res.status(404).json({
                message: "Examen introuvable."
            });
        }

        res.json({
            message: "Planning enregistré."
        });
    } catch (erreur) {
        console.error(erreur);
        res.status(500).json({
            message: "Erreur lors de l'enregistrement du planning."
        });
    }
});


/* ==================================================
   7. COPIE D'UN ETUDIANT (reponses question par question)
   ================================================== */

router.get("/resultats/:id/copie", (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
            message: "Identifiant du résultat invalide."
        });
    }

    try {
        const resultat = base.prepare(`
            SELECT
                r.id,
                r.score,
                r.total_questions,
                r.date_passage,
                r.tentative_id,
                r.examen_id,
                u.nom AS etudiant_nom,
                u.email AS etudiant_email,
                e.titre AS examen_titre,
                e.note_reussite,
                t.numero AS tentative_numero
            FROM resultats r
            LEFT JOIN utilisateurs u ON u.id = r.utilisateur_id
            LEFT JOIN examens e ON e.id = r.examen_id
            LEFT JOIN tentatives t ON t.id = r.tentative_id
            WHERE r.id = ?
        `).get(id);

        if (!resultat) {
            return res.status(404).json({
                message: "Résultat introuvable."
            });
        }

        const reponses = resultat.tentative_id
            ? base.prepare(`
                SELECT question_id, choix_id
                FROM reponses_etudiants
                WHERE tentative_id = ?
            `).all(resultat.tentative_id)
            : [];

        const choisis = new Set(reponses.map(reponse => reponse.choix_id));

        const questions = base.prepare(`
            SELECT id, texte
            FROM questions
            WHERE examen_id = ?
            ORDER BY id
        `).all(resultat.examen_id);

        const lireChoix = base.prepare(`
            SELECT id, texte, est_correcte
            FROM choix_reponses
            WHERE question_id = ?
            ORDER BY id
        `);

        const detail = questions.map(question => {
            const choix = lireChoix.all(question.id).map(element => ({
                id: element.id,
                texte: element.texte,
                est_correcte: Boolean(element.est_correcte),
                choisi: choisis.has(element.id)
            }));

            const repondu = choix.some(element => element.choisi);

            return {
                id: question.id,
                texte: question.texte,
                choix,
                repondu,
                correcte: repondu && choix.every(
                    element => element.est_correcte === element.choisi
                )
            };
        });

        const { tentative_id, examen_id, ...infos } = resultat;

        res.json({
            ...infos,
            copie_enregistree: reponses.length > 0,
            questions: detail
        });
    } catch (erreur) {
        console.error(erreur);
        res.status(500).json({
            message: "Erreur lors du chargement de la copie."
        });
    }
});


/* ==================================================
   8. AUTORISER UNE NOUVELLE TENTATIVE A UN ETUDIANT
   ================================================== */

router.post("/examens/:id/autoriser-tentative", (req, res) => {
    const examenId = Number(req.params.id);
    const utilisateurId = Number(req.body.utilisateur_id);

    if (
        !Number.isInteger(examenId) || examenId <= 0 ||
        !Number.isInteger(utilisateurId) || utilisateurId <= 0
    ) {
        return res.status(400).json({
            message: "Examen ou étudiant invalide."
        });
    }

    try {
        const examen = base.prepare(`
            SELECT id, nb_tentatives_max, date_ouverture, date_fermeture
            FROM examens WHERE id = ?
        `).get(examenId);

        if (!examen) {
            return res.status(404).json({
                message: "Examen introuvable."
            });
        }

        const etudiant = base.prepare(`
            SELECT id FROM utilisateurs
            WHERE id = ? AND role = 'etudiant'
        `).get(utilisateurId);

        if (!etudiant) {
            return res.status(404).json({
                message: "Étudiant introuvable."
            });
        }

        const enCours = base.prepare(`
            SELECT id FROM tentatives
            WHERE utilisateur_id = ? AND examen_id = ?
              AND statut = 'en_cours'
            LIMIT 1
        `).get(utilisateurId, examenId);

        if (enCours) {
            return res.status(409).json({
                message: "Cet étudiant a une tentative en cours."
            });
        }

        const utilisees = base.prepare(`
            SELECT COUNT(*) AS total FROM tentatives
            WHERE utilisateur_id = ? AND examen_id = ?
        `).get(utilisateurId, examenId).total;

        const supplementaires = base.prepare(`
            SELECT COALESCE(SUM(supplementaires), 0) AS total
            FROM autorisations_tentatives
            WHERE utilisateur_id = ? AND examen_id = ?
        `).get(utilisateurId, examenId).total;

        const restantes =
            examen.nb_tentatives_max + supplementaires - utilisees;

        if (restantes > 0) {
            return res.status(409).json({
                message: `Cet étudiant peut encore passer l'examen (${restantes} tentative(s) restante(s)).`
            });
        }

        base.prepare(`
            INSERT INTO autorisations_tentatives
            (utilisateur_id, examen_id, supplementaires)
            VALUES (?, ?, 1)
            ON CONFLICT(utilisateur_id, examen_id)
            DO UPDATE SET supplementaires = supplementaires + 1
        `).run(utilisateurId, examenId);

        const fermeture = examen.date_fermeture
            ? Date.parse(examen.date_fermeture) : NaN;

        res.status(201).json({
            message: "Nouvelle tentative autorisée.",
            avertissement: !Number.isNaN(fermeture) && Date.now() > fermeture
                ? "L'examen est fermé : repoussez sa date de fermeture pour que l'étudiant puisse le passer."
                : null
        });
    } catch (erreur) {
        console.error(erreur);
        res.status(500).json({
            message: "Erreur lors de l'autorisation."
        });
    }
});


module.exports = router;