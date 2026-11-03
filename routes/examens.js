const express = require("express");
const base = require("../database/connexion");
const {
    verifierUtilisateur
} = require("../middleware/verifier_utilisateur");

const {
    TOLERANCE_MS,
    cloturerTentative
} = require("../services/cloture_tentatives");

const {
    lireQuestionsCompletes,
    corriger,
    totaux,
    avecTotalPoints
} = require("../services/correction");

const route = express.Router();

route.use(verifierUtilisateur);

/* ==================================================
   FONCTIONS UTILITAIRES
   ================================================== */

// Etat de l'examen selon son planning : a_venir, ouvert ou ferme
function etatPlanning(examen, maintenant = Date.now()) {
    const ouverture = examen.date_ouverture
        ? Date.parse(examen.date_ouverture) : NaN;
    const fermeture = examen.date_fermeture
        ? Date.parse(examen.date_fermeture) : NaN;

    if (!Number.isNaN(ouverture) && maintenant < ouverture) {
        return "a_venir";
    }

    if (!Number.isNaN(fermeture) && maintenant > fermeture) {
        return "ferme";
    }

    return "ouvert";
}

// Un examen n'est visible des etudiants que s'il est publie
function lireExamenPublie(examenId) {
    return base.prepare(`
        SELECT
            e.id, e.titre, e.duree_minutes,
            e.date_ouverture, e.date_fermeture,
            e.nb_tentatives_max, e.note_reussite,
            c.titre AS cours
        FROM examens e
        JOIN cours c ON c.id = e.cours_id
        WHERE e.id = ? AND e.statut = 'publie'
    `).get(examenId);
}

function lireTentativeEnCours(utilisateurId, examenId) {
    return base.prepare(`
        SELECT id, numero, date_debut
        FROM tentatives
        WHERE utilisateur_id = ? AND examen_id = ?
          AND statut = 'en_cours'
        ORDER BY numero DESC
        LIMIT 1
    `).get(utilisateurId, examenId);
}

// Situation d'un etudiant face a un examen : peut-il le passer ?
function lireSituation(utilisateurId, examen) {
    const stats = base.prepare(`
        SELECT COUNT(*) AS utilisees
        FROM tentatives
        WHERE utilisateur_id = ? AND examen_id = ?
    `).get(utilisateurId, examen.id);

    const supplementaires = base.prepare(`
        SELECT COALESCE(SUM(supplementaires), 0) AS total
        FROM autorisations_tentatives
        WHERE utilisateur_id = ? AND examen_id = ?
    `).get(utilisateurId, examen.id).total;

    const enCours = Boolean(
        lireTentativeEnCours(utilisateurId, examen.id)
    );
    const planning = etatPlanning(examen);
    const maximum = examen.nb_tentatives_max + supplementaires;

    let message = null;

    // Une tentative deja commencee peut toujours etre reprise
    if (!enCours) {
        if (planning === "a_venir") {
            message = "Cet examen n'est pas encore ouvert.";
        } else if (planning === "ferme") {
            message = "Cet examen est fermé.";
        } else if (stats.utilisees >= maximum) {
            message = maximum > 1
                ? "Vous avez utilisé toutes vos tentatives pour cet examen."
                : "Vous avez déjà passé cet examen.";
        }
    }

    return {
        planning,
        tentatives_utilisees: stats.utilisees,
        tentatives_max: maximum,
        en_cours: enCours,
        peut_passer: enCours || message === null,
        message_blocage: message
    };
}

// Le temps de la tentative est-il depasse ? (marge facultative)
function tempsEcoule(tentative, examen, marge = 0) {
    const debut = Date.parse(tentative.date_debut);

    return (
        !Number.isNaN(debut) &&
        Date.now() >= debut + examen.duree_minutes * 60 * 1000 + marge
    );
}

// La correction (bonnes reponses + explications) n'est visible que lorsque
// l'etudiant a utilise toutes ses tentatives et n'en a aucune en cours.
function correctionAutorisee(utilisateurId, examenId) {
    const examen = base.prepare(`
        SELECT id, nb_tentatives_max FROM examens WHERE id = ?
    `).get(examenId);

    if (!examen) {
        return false;
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

    // CORRECTION_TOUJOURS=true dans le .env : la correction est visible
    // des la fin de chaque tentative (utile pour une demonstration).
    const toujours =
        (process.env.CORRECTION_TOUJOURS || "").trim().toLowerCase() === "true";

    return (
        !lireTentativeEnCours(utilisateurId, examenId) &&
        (toujours || utilisees >= examen.nb_tentatives_max + supplementaires)
    );
}

function lireIdentifiant(req) {
    const id = Number(req.params.id);
    return Number.isInteger(id) && id >= 1 ? id : null;
}

/* ==================================================
   LISTE DES EXAMENS AVEC LEUR ETAT
   ================================================== */

route.get("/", (req, res) => {
    try {
        const utilisateurId = req.utilisateur.id;

        const lignes = base.prepare(`
            SELECT
                e.id, e.titre, e.duree_minutes,
                e.date_ouverture, e.date_fermeture,
                e.nb_tentatives_max,
                c.titre AS cours,
                (
                    SELECT COUNT(*) FROM tentatives t
                    WHERE t.examen_id = e.id AND t.utilisateur_id = ?
                ) AS tentatives_utilisees,
                (
                    SELECT COALESCE(SUM(a.supplementaires), 0)
                    FROM autorisations_tentatives a
                    WHERE a.examen_id = e.id AND a.utilisateur_id = ?
                ) AS supplementaires,
                EXISTS (
                    SELECT 1 FROM tentatives t
                    WHERE t.examen_id = e.id AND t.utilisateur_id = ?
                      AND t.statut = 'en_cours'
                ) AS en_cours,
                EXISTS (
                    SELECT 1 FROM resultats r
                    WHERE r.examen_id = e.id AND r.utilisateur_id = ?
                ) AS deja_passe,
                (
                    SELECT r.score FROM resultats r
                    WHERE r.examen_id = e.id AND r.utilisateur_id = ?
                    ORDER BY r.id DESC LIMIT 1
                ) AS score_precedent,
                (
                    SELECT COALESCE(r.total_points, r.total_questions)
                    FROM resultats r
                    WHERE r.examen_id = e.id AND r.utilisateur_id = ?
                    ORDER BY r.id DESC LIMIT 1
                ) AS total_precedent
            FROM examens e
            JOIN cours c ON e.cours_id = c.id
            WHERE e.statut = 'publie'
            ORDER BY e.id DESC
        `).all(
            utilisateurId, utilisateurId, utilisateurId,
            utilisateurId, utilisateurId, utilisateurId
        );

        const maintenant = Date.now();

        res.json(lignes.map(ligne => {
            const planning = etatPlanning(ligne, maintenant);
            const maximum =
                ligne.nb_tentatives_max + ligne.supplementaires;
            const enCours = Boolean(ligne.en_cours);

            return {
                id: ligne.id,
                titre: ligne.titre,
                cours: ligne.cours,
                duree_minutes: ligne.duree_minutes,
                date_ouverture: ligne.date_ouverture,
                date_fermeture: ligne.date_fermeture,
                planning,
                tentatives_utilisees: ligne.tentatives_utilisees,
                tentatives_max: maximum,
                en_cours: enCours,
                deja_passe: Boolean(ligne.deja_passe),
                score_precedent: ligne.score_precedent,
                total_precedent: ligne.total_precedent,
                peut_passer: enCours || (
                    planning === "ouvert" &&
                    ligne.tentatives_utilisees < maximum
                )
            };
        }));
    } catch (erreur) {
        console.error(erreur);
        res.status(500).json({
            message: "Erreur lors du chargement des examens."
        });
    }
});

/* ==================================================
   INFORMATIONS SUR UN EXAMEN (le chronometre ne demarre pas ici)
   ================================================== */

route.get("/:id", (req, res) => {
    try {
        const examenId = lireIdentifiant(req);

        if (examenId === null) {
            return res.status(400).json({
                message: "Identifiant invalide."
            });
        }

        const examen = lireExamenPublie(examenId);

        if (!examen) {
            return res.status(404).json({
                message: "Examen introuvable."
            });
        }

        const nombreQuestions = base.prepare(`
            SELECT COUNT(*) AS total FROM questions WHERE examen_id = ?
        `).get(examenId).total;

        res.json({
            id: examen.id,
            titre: examen.titre,
            cours: examen.cours,
            duree_minutes: examen.duree_minutes,
            date_ouverture: examen.date_ouverture,
            date_fermeture: examen.date_fermeture,
            note_reussite: examen.note_reussite,
            nombre_questions: nombreQuestions,
            ...lireSituation(req.utilisateur.id, examen)
        });
    } catch (erreur) {
        console.error(erreur);
        res.status(500).json({
            message: "Erreur lors du chargement de l'examen."
        });
    }
});

/* ==================================================
   DEMARRER (OU REPRENDRE) UNE TENTATIVE
   ================================================== */

route.post("/:id/demarrer", (req, res) => {
    try {
        const examenId = lireIdentifiant(req);
        const utilisateurId = req.utilisateur.id;

        if (examenId === null) {
            return res.status(400).json({
                message: "Identifiant invalide."
            });
        }

        const examen = lireExamenPublie(examenId);

        if (!examen) {
            return res.status(404).json({
                message: "Examen introuvable."
            });
        }

        let tentative = lireTentativeEnCours(utilisateurId, examenId);

        if (tentative) {
            // Temps ecoule : on ne rouvre jamais l'examen, on le cloture.
            if (tempsEcoule(tentative, examen)) {
                cloturerTentative(tentative.id);

                return res.status(409).json({
                    message: "Le temps imparti est écoulé : l'examen a été clôturé avec la note 0."
                });
            }
        } else {
            const situation = lireSituation(utilisateurId, examen);

            if (!situation.peut_passer) {
                return res
                    .status(situation.planning === "ouvert" ? 409 : 403)
                    .json({ message: situation.message_blocage });
            }

            const questionsExistantes = base.prepare(`
                SELECT COUNT(*) AS total FROM questions WHERE examen_id = ?
            `).get(examenId).total;

            if (questionsExistantes === 0) {
                return res.status(400).json({
                    message: "Cet examen ne contient aucune question."
                });
            }

            try {
                base.prepare(`
                    INSERT INTO tentatives
                    (utilisateur_id, examen_id, numero, date_debut)
                    VALUES (
                        ?, ?,
                        (
                            SELECT COALESCE(MAX(numero), 0) + 1
                            FROM tentatives
                            WHERE utilisateur_id = ? AND examen_id = ?
                        ),
                        ?
                    )
                `).run(
                    utilisateurId,
                    examenId,
                    utilisateurId,
                    examenId,
                    new Date().toISOString()
                );
            } catch (erreur) {
                // Double clic : l'autre requete a deja cree la tentative
            }

            tentative = lireTentativeEnCours(utilisateurId, examenId);

            if (!tentative) {
                return res.status(409).json({
                    message: "Impossible de démarrer la tentative."
                });
            }
        }

        const questions = base.prepare(`
            SELECT id, texte, type, points FROM questions
            WHERE examen_id = ? ORDER BY id
        `).all(examenId);

        const lireChoix = base.prepare(`
            SELECT id, texte FROM choix_reponses
            WHERE question_id = ? ORDER BY id
        `);

        res.json({
            id: examen.id,
            titre: examen.titre,
            cours: examen.cours,
            duree_minutes: examen.duree_minutes,
            numero: tentative.numero,
            date_debut: tentative.date_debut,
            // L'heure du serveur sert a synchroniser le chronometre
            maintenant: new Date().toISOString(),
            questions: questions.map(question => ({
                id: question.id,
                texte: question.texte,
                type: question.type,
                points: question.points,
                choix: lireChoix.all(question.id)
            }))
        });
    } catch (erreur) {
        console.error(erreur);
        res.status(500).json({
            message: "Erreur lors du démarrage de l'examen."
        });
    }
});

/* ==================================================
   SOUMETTRE LES REPONSES ET CALCULER LA NOTE
   ================================================== */

route.post("/:id/soumettre", (req, res) => {
    try {
        const examenId = lireIdentifiant(req);
        const utilisateurId = req.utilisateur.id;
        const { reponses } = req.body;

        if (examenId === null || !Array.isArray(reponses)) {
            return res.status(400).json({
                message: "Données invalides."
            });
        }

        const examen = base.prepare(`
            SELECT id, duree_minutes, note_reussite
            FROM examens WHERE id = ?
        `).get(examenId);

        if (!examen) {
            return res.status(404).json({
                message: "Examen introuvable."
            });
        }

        const tentative = lireTentativeEnCours(utilisateurId, examenId);

        if (!tentative) {
            return res.status(409).json({
                message: "Aucune tentative active pour cet examen."
            });
        }

        // Le serveur decide seul : au-dela de la limite + marge, les
        // reponses sont refusees et l'examen est cloture.
        if (tempsEcoule(tentative, examen, TOLERANCE_MS)) {
            try {
                cloturerTentative(tentative.id);
            } catch (erreur) {
                console.error("Erreur de cloture :", erreur);
            }

            return res.status(403).json({
                message: "Le temps est écoulé : les réponses tardives sont refusées et l'examen a été clôturé avec la note 0."
            });
        }

        const questions = lireQuestionsCompletes(examenId);

        if (questions.length === 0) {
            return res.status(400).json({
                message: "Cet examen ne contient aucune question."
            });
        }

        const questionsParId = new Map(
            questions.map(question => [question.id, question])
        );

        // Chaque reponse : { question_id, choix_ids: [...] }
        // (l'ancien format { question_id, choix_id } reste accepte).
        // Les questions sans reponse comptent comme incorrectes.
        const choixParQuestion = new Map();

        for (const reponse of reponses) {
            if (!reponse || !Number.isInteger(reponse.question_id)) {
                return res.status(400).json({
                    message: "Les réponses sont invalides ou répétées."
                });
            }

            const question = questionsParId.get(reponse.question_id);

            if (!question) {
                return res.status(400).json({
                    message: "Une question ne correspond pas à cet examen."
                });
            }

            if (choixParQuestion.has(question.id)) {
                return res.status(400).json({
                    message: "Les réponses sont invalides ou répétées."
                });
            }

            let identifiants;

            if (Array.isArray(reponse.choix_ids)) {
                identifiants = reponse.choix_ids;
            } else if (Number.isInteger(reponse.choix_id)) {
                identifiants = [reponse.choix_id];
            } else {
                return res.status(400).json({
                    message: "Les réponses sont invalides ou répétées."
                });
            }

            if (
                identifiants.some(id => !Number.isInteger(id)) ||
                new Set(identifiants).size !== identifiants.length
            ) {
                return res.status(400).json({
                    message: "Les réponses sont invalides ou répétées."
                });
            }

            const autorises = new Set(question.choix.map(choix => choix.id));

            if (identifiants.some(id => !autorises.has(id))) {
                return res.status(400).json({
                    message: "Un choix de réponse est invalide."
                });
            }

            if (question.type !== "choix_multiple" && identifiants.length > 1) {
                return res.status(400).json({
                    message: "Une question n'accepte qu'une seule réponse."
                });
            }

            if (identifiants.length > 0) {
                choixParQuestion.set(question.id, identifiants);
            }
        }

        const choisis = new Set(
            [...choixParQuestion.values()].flat()
        );
        const detail = corriger(questions, choisis);
        const { score, total_points: totalPoints } = totaux(detail);

        // Resultat, copie detaillee et fin de tentative : tout ensemble.
        const enregistrer = base.transaction(() => {
            const resultat = base.prepare(`
                INSERT INTO resultats
                (utilisateur_id, examen_id, score, total_questions,
                 tentative_id, total_points)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(
                utilisateurId,
                examenId,
                score,
                questions.length,
                tentative.id,
                totalPoints
            );

            const insererReponse = base.prepare(`
                INSERT INTO reponses_etudiants
                (tentative_id, question_id, choix_id)
                VALUES (?, ?, ?)
            `);

            for (const [questionId, identifiants] of choixParQuestion) {
                for (const choixId of identifiants) {
                    insererReponse.run(tentative.id, questionId, choixId);
                }
            }

            base.prepare(`
                UPDATE tentatives
                SET statut = 'termine', date_fin = ?
                WHERE id = ?
            `).run(new Date().toISOString(), tentative.id);

            return resultat.lastInsertRowid;
        });

        const resultatId = Number(enregistrer());
        const pourcentage = totalPoints > 0
            ? Math.round((score / totalPoints) * 100)
            : 0;

        // La correction n'est donnee que si l'etudiant ne peut plus
        // repasser l'examen (sinon il connaitrait les reponses).
        const correctionVisible = correctionAutorisee(
            utilisateurId,
            examenId
        );

        res.status(201).json({
            message: "Examen soumis avec succès.",
            resultat_id: resultatId,
            score,
            total_questions: totalPoints,
            nombre_questions: questions.length,
            pourcentage,
            note_reussite: examen.note_reussite,
            reussi: pourcentage >= examen.note_reussite,
            correction_visible: correctionVisible,
            correction: correctionVisible ? detail : null
        });
    } catch (erreur) {
        console.error("Erreur lors de la soumission :", erreur);

        res.status(500).json({
            message: "Impossible d'enregistrer le résultat."
        });
    }
});

/* ==================================================
   RESULTATS DE L'ETUDIANT CONNECTE
   ================================================== */

route.get("/resultats/mes-resultats", (req, res) => {
    try {
        const resultats = base.prepare(`
            SELECT
                resultats.id,
                examens.titre AS examen,
                resultats.score,
                resultats.total_questions,
                resultats.total_points,
                resultats.examen_id,
                resultats.date_passage,
                tentatives.numero AS tentative
            FROM resultats
            JOIN examens ON resultats.examen_id = examens.id
            LEFT JOIN tentatives ON tentatives.id = resultats.tentative_id
            WHERE resultats.utilisateur_id = ?
            ORDER BY resultats.date_passage DESC, resultats.id DESC
        `).all(req.utilisateur.id);

        res.json(resultats.map(avecTotalPoints));
    } catch (erreur) {
        console.error(erreur);
        res.status(500).json({
            message: "Erreur lors du chargement des résultats."
        });
    }
});

/* ==================================================
   CORRECTION D'UN DE SES RESULTATS (bonnes reponses et explications)
   ================================================== */

route.get("/resultats/:id/correction", (req, res) => {
    try {
        const id = lireIdentifiant(req);

        if (id === null) {
            return res.status(400).json({
                message: "Identifiant invalide."
            });
        }

        const resultat = base.prepare(`
            SELECT
                r.id, r.score, r.total_questions, r.total_points,
                r.date_passage, r.tentative_id, r.examen_id,
                e.titre AS examen, e.note_reussite
            FROM resultats r
            JOIN examens e ON e.id = r.examen_id
            WHERE r.id = ? AND r.utilisateur_id = ?
        `).get(id, req.utilisateur.id);

        if (!resultat) {
            return res.status(404).json({
                message: "Résultat introuvable."
            });
        }

        if (!correctionAutorisee(req.utilisateur.id, resultat.examen_id)) {
            return res.status(403).json({
                message: "La correction sera disponible quand vous aurez utilisé toutes vos tentatives."
            });
        }

        const reponses = resultat.tentative_id
            ? base.prepare(`
                SELECT choix_id FROM reponses_etudiants
                WHERE tentative_id = ?
            `).all(resultat.tentative_id)
            : [];

        const detail = corriger(
            lireQuestionsCompletes(resultat.examen_id),
            new Set(reponses.map(reponse => reponse.choix_id))
        );

        const { tentative_id, examen_id, ...infos } = resultat;

        res.json({
            ...avecTotalPoints(infos),
            copie_enregistree: reponses.length > 0,
            questions: detail
        });
    } catch (erreur) {
        console.error(erreur);
        res.status(500).json({
            message: "Erreur lors du chargement de la correction."
        });
    }
});

module.exports = route;