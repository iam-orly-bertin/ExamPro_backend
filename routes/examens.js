const express = require("express");
const base = require("../database/connexion");
const {
    verifierUtilisateur
} = require("../middleware/verifier_utilisateur");

const {
    TOLERANCE_MS,
    cloturerTentative
} = require("../services/cloture_tentatives");

const route = express.Router();

route.use(verifierUtilisateur);

// AFFICHER LES EXAMENS AVEC LEUR ETAT
route.get("/", (req, res) => {
    const examens = base.prepare(`
        SELECT
            examens.id,
            examens.titre,
            examens.duree_minutes,
            cours.titre AS cours,
            EXISTS (
                SELECT 1
                FROM resultats
                WHERE resultats.examen_id = examens.id
                  AND resultats.utilisateur_id = ?
            ) AS deja_passe,
            (
                SELECT resultats.score
                FROM resultats
                WHERE resultats.examen_id = examens.id
                  AND resultats.utilisateur_id = ?
                ORDER BY resultats.id DESC
                LIMIT 1
            ) AS score_precedent,
            (
                SELECT resultats.total_questions
                FROM resultats
                WHERE resultats.examen_id = examens.id
                  AND resultats.utilisateur_id = ?
                ORDER BY resultats.id DESC
                LIMIT 1
            ) AS total_precedent
        FROM examens
        JOIN cours ON examens.cours_id = cours.id
        ORDER BY examens.id DESC
    `).all(
        req.utilisateur.id,
        req.utilisateur.id,
        req.utilisateur.id
    );

    res.json(examens);
});

// AFFICHER UN EXAMEN ET DEMARRER SA TENTATIVE
route.get("/:id", (req, res) => {
    const examenId = Number(req.params.id);
    const utilisateurId = req.utilisateur.id;

    if (!Number.isInteger(examenId) || examenId < 1) {
        return res.status(400).json({
            message: "Identifiant invalide."
        });
    }

    const examen = base.prepare(`
        SELECT id, titre, duree_minutes, cours_id
        FROM examens
        WHERE id = ?
    `).get(examenId);

    if (!examen) {
        return res.status(404).json({
            message: "Examen introuvable."
        });
    }

    // Interdire de refaire un examen deja termine
    const resultatExistant = base.prepare(`
        SELECT id
        FROM resultats
        WHERE utilisateur_id = ? AND examen_id = ?
        LIMIT 1
    `).get(utilisateurId, examenId);

    if (resultatExistant) {
        return res.status(409).json({
            message: "Vous avez deja passe cet examen."
        });
    }

    // Demarrer une tentative seulement si elle n'existe pas.
    // On lit d'abord : une simple actualisation de la page ne doit
    // rien ecrire dans la base (sinon un outil qui surveille les
    // fichiers, comme Live Server, recharge la page en boucle).
    let tentative = base.prepare(`
        SELECT date_debut, statut
        FROM tentatives_examens
        WHERE utilisateur_id = ? AND examen_id = ?
    `).get(utilisateurId, examenId);

    if (!tentative) {
        base.prepare(`
            INSERT OR IGNORE INTO tentatives_examens
            (utilisateur_id, examen_id, date_debut, statut)
            VALUES (?, ?, ?, 'en_cours')
        `).run(
            utilisateurId,
            examenId,
            new Date().toISOString()
        );

        tentative = base.prepare(`
            SELECT date_debut, statut
            FROM tentatives_examens
            WHERE utilisateur_id = ? AND examen_id = ?
        `).get(utilisateurId, examenId);
    }

    if (!tentative || tentative.statut !== "en_cours") {
        return res.status(409).json({
            message: "Cette tentative d'examen est deja terminee."
        });
    }

    // Temps ecoule : on ne rouvre jamais l'examen, on le cloture.
    const debutTentative = Date.parse(tentative.date_debut);

    if (
        !Number.isNaN(debutTentative) &&
        Date.now() >= debutTentative + examen.duree_minutes * 60 * 1000
    ) {
        cloturerTentative(utilisateurId, examenId);

        return res.status(409).json({
            message: "Le temps imparti est ecoule : l'examen a ete cloture avec la note 0."
        });
    }

    const questions = base.prepare(`
        SELECT id, texte
        FROM questions
        WHERE examen_id = ?
        ORDER BY id
    `).all(examenId);

    const lireChoix = base.prepare(`
        SELECT id, texte
        FROM choix_reponses
        WHERE question_id = ?
        ORDER BY id
    `);

    const questionsAvecChoix = questions.map(question => ({
        id: question.id,
        texte: question.texte,
        choix: lireChoix.all(question.id)
    }));

    res.json({
        ...examen,
        date_debut: tentative.date_debut,
        questions: questionsAvecChoix
    });
});

// SOUMETTRE LES REPONSES ET CALCULER LA NOTE
route.post("/:id/soumettre", (req, res) => {
    const examenId = Number(req.params.id);
    const utilisateurId = req.utilisateur.id;
    const { reponses } = req.body;

    if (
        !Number.isInteger(examenId) ||
        examenId < 1 ||
        !Array.isArray(reponses)
    ) {
        return res.status(400).json({
            message: "Donnees invalides."
        });
    }

    const examen = base.prepare(`
        SELECT id, duree_minutes
        FROM examens
        WHERE id = ?
    `).get(examenId);

    if (!examen) {
        return res.status(404).json({
            message: "Examen introuvable."
        });
    }

    const resultatExistant = base.prepare(`
        SELECT id
        FROM resultats
        WHERE utilisateur_id = ? AND examen_id = ?
        LIMIT 1
    `).get(utilisateurId, examenId);

    if (resultatExistant) {
        return res.status(409).json({
            message: "Cet examen a deja ete soumis."
        });
    }

    const tentative = base.prepare(`
        SELECT date_debut, statut
        FROM tentatives_examens
        WHERE utilisateur_id = ? AND examen_id = ?
    `).get(utilisateurId, examenId);

    if (!tentative || tentative.statut !== "en_cours") {
        return res.status(409).json({
            message: "Aucune tentative active pour cet examen."
        });
    }

    const dateDebut = Date.parse(tentative.date_debut);

    if (Number.isNaN(dateDebut)) {
        return res.status(500).json({
            message: "Impossible de verifier le chronometre."
        });
    }

    const dateLimite =
        dateDebut + examen.duree_minutes * 60 * 1000;

    // Le serveur decide seul : au-dela de la limite + marge, les
    // reponses sont refusees et l'examen est cloture.
    if (Date.now() > dateLimite + TOLERANCE_MS) {
        try {
            cloturerTentative(utilisateurId, examenId);
        } catch (erreur) {
            console.error("Erreur de cloture :", erreur);
        }

        return res.status(403).json({
            message: "Le temps est ecoule : les reponses tardives sont refusees et l'examen a ete cloture avec la note 0."
        });
    }

    const questions = base.prepare(`
        SELECT id
        FROM questions
        WHERE examen_id = ?
    `).all(examenId);

    if (questions.length === 0) {
        return res.status(400).json({
            message: "Cet examen ne contient aucune question."
        });
    }

    // Les reponses non donnees comptent comme incorrectes.
    const identifiants = reponses.map(
        reponse => reponse.question_id
    );

    if (
        reponses.some(reponse =>
            !Number.isInteger(reponse.question_id) ||
            !Number.isInteger(reponse.choix_id)
        ) ||
        new Set(identifiants).size !== reponses.length
    ) {
        return res.status(400).json({
            message: "Les reponses sont invalides ou repetees."
        });
    }

    const questionsAutorisees = new Set(
        questions.map(question => question.id)
    );

    if (reponses.some(reponse =>
        !questionsAutorisees.has(reponse.question_id)
    )) {
        return res.status(400).json({
            message: "Une question ne correspond pas a cet examen."
        });
    }

    const verifierChoix = base.prepare(`
        SELECT est_correcte
        FROM choix_reponses
        WHERE id = ? AND question_id = ?
    `);

    let score = 0;

    for (const reponse of reponses) {
        const choix = verifierChoix.get(
            reponse.choix_id,
            reponse.question_id
        );

        if (!choix) {
            return res.status(400).json({
                message: "Un choix de reponse est invalide."
            });
        }

        if (choix.est_correcte === 1) {
            score++;
        }
    }

    // Enregistrer le resultat et terminer la tentative ensemble.
    try {
        const enregistrer = base.transaction(() => {
            const resultat = base.prepare(`
                INSERT INTO resultats
                (utilisateur_id, examen_id, score, total_questions)
                VALUES (?, ?, ?, ?)
            `).run(
                utilisateurId,
                examenId,
                score,
                questions.length
            );

            base.prepare(`
                UPDATE tentatives_examens
                SET statut = 'termine'
                WHERE utilisateur_id = ? AND examen_id = ?
            `).run(utilisateurId, examenId);

            return resultat.lastInsertRowid;
        });

        const resultatId = enregistrer();

        res.status(201).json({
            message: "Examen soumis avec succes.",
            resultat_id: resultatId,
            score,
            total_questions: questions.length,
            pourcentage: Math.round(
                (score / questions.length) * 100
            )
        });
    } catch (erreur) {
        console.error("Erreur lors de la soumission :", erreur);

        res.status(500).json({
            message: "Impossible d'enregistrer le resultat."
        });
    }
});

// AFFICHER LES RESULTATS DE L'ETUDIANT CONNECTE
route.get("/resultats/mes-resultats", (req, res) => {
    const resultats = base.prepare(`
        SELECT
            resultats.id,
            examens.titre AS examen,
            resultats.score,
            resultats.total_questions,
            resultats.date_passage
        FROM resultats
        JOIN examens ON resultats.examen_id = examens.id
        WHERE resultats.utilisateur_id = ?
        ORDER BY resultats.date_passage DESC
    `).all(req.utilisateur.id);

    res.json(resultats);
});

module.exports = route;