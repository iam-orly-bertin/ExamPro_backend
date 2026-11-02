const express = require("express");
const router = express.Router();

const base = require("../database/connexion");

const {
    verifierUtilisateur,
    verifierAdmin
} = require("../middleware/verifier_utilisateur");

// Toutes les routes de ce fichier sont reservees aux administrateurs.
router.use(verifierUtilisateur, verifierAdmin);


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
                c.titre AS cours_titre,
                COUNT(DISTINCT q.id) AS nombre_questions,
                (
                    SELECT COUNT(*) FROM resultats r
                    WHERE r.examen_id = e.id
                ) AS nombre_resultats,
                (
                    SELECT COUNT(*) FROM tentatives_examens t
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
                INSERT INTO examens (cours_id, titre, duree_minutes)
                VALUES (?, ?, ?)
            `).run(idCours, titre.trim(), duree);

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
                e.titre AS examen_titre
            FROM resultats r
            LEFT JOIN utilisateurs u ON u.id = r.utilisateur_id
            LEFT JOIN examens e ON e.id = r.examen_id
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
            SELECT id, cours_id, titre, duree_minutes
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
            "SELECT id FROM tentatives_examens WHERE examen_id = ? LIMIT 1"
        ).get(id);

        if (tentativeExistante) {
            return res.status(409).json({
                message: "Des étudiants ont déjà commencé cet examen : sa modification est bloquée."
            });
        }

        const modifierExamen = base.transaction(() => {
            base.prepare(`
                UPDATE examens
                SET cours_id = ?, titre = ?, duree_minutes = ?
                WHERE id = ?
            `).run(idCours, titre.trim(), duree, id);

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
            "SELECT id FROM tentatives_examens WHERE examen_id = ? LIMIT 1"
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


module.exports = router;
