const base = require("../database/connexion");

// Types de questions acceptes
const TYPES = ["choix_unique", "choix_multiple", "vrai_faux"];

const POINTS_MAX = 100;
const CHOIX_MAX = 10;
const EXPLICATION_MAX = 1000;

// Arrondi a 2 decimales (evite 0.1 + 0.2 = 0.30000000000000004)
function arrondir(nombre) {
    return Math.round(nombre * 100) / 100;
}

/* ==================================================
   VALIDATION DES QUESTIONS (cote admin)
   ================================================== */

// Verifie et nettoie les questions envoyees par le formulaire admin.
// Renvoie { erreur } ou { questions } (valeurs pretes a etre enregistrees).
function validerQuestions(questions) {
    if (!Array.isArray(questions) || questions.length === 0) {
        return { erreur: "Ajoutez au moins une question." };
    }

    const propres = [];

    for (let i = 0; i < questions.length; i++) {
        const numero = i + 1;
        const question = questions[i];

        if (
            !question ||
            typeof question.texte !== "string" ||
            !question.texte.trim()
        ) {
            return { erreur: `Le texte de la question ${numero} est obligatoire.` };
        }

        const type = question.type === undefined
            ? "choix_unique" : question.type;

        if (!TYPES.includes(type)) {
            return { erreur: `Le type de la question ${numero} est invalide.` };
        }

        const pointsBruts = question.points === undefined
            ? 1 : Number(question.points);

        if (
            !Number.isFinite(pointsBruts) ||
            pointsBruts <= 0 ||
            pointsBruts > POINTS_MAX
        ) {
            return {
                erreur: `Les points de la question ${numero} doivent être un nombre entre 0,01 et ${POINTS_MAX}.`
            };
        }

        let explication = null;

        if (question.explication !== undefined && question.explication !== null) {
            if (typeof question.explication !== "string") {
                return { erreur: `L'explication de la question ${numero} est invalide.` };
            }

            explication = question.explication.trim() || null;

            if (explication && explication.length > EXPLICATION_MAX) {
                return {
                    erreur: `L'explication de la question ${numero} est trop longue (${EXPLICATION_MAX} caractères maximum).`
                };
            }
        }

        if (!Array.isArray(question.choix)) {
            return { erreur: `La question ${numero} doit avoir des choix.` };
        }

        if (question.choix.length > CHOIX_MAX) {
            return {
                erreur: `La question ${numero} a trop de choix (${CHOIX_MAX} maximum).`
            };
        }

        for (const choix of question.choix) {
            if (
                !choix ||
                typeof choix.texte !== "string" ||
                !choix.texte.trim() ||
                typeof choix.est_correcte !== "boolean"
            ) {
                return { erreur: `Les choix de la question ${numero} sont invalides.` };
            }
        }

        const nombre = question.choix.length;
        const correctes = question.choix.filter(c => c.est_correcte).length;

        if (type === "vrai_faux") {
            if (nombre !== 2 || correctes !== 1) {
                return {
                    erreur: `La question ${numero} (vrai/faux) doit avoir 2 choix et une seule bonne réponse.`
                };
            }
        } else if (nombre < 2) {
            return { erreur: `La question ${numero} doit avoir au moins deux choix.` };
        } else if (type === "choix_unique" && correctes !== 1) {
            return {
                erreur: `La question ${numero} doit avoir exactement une bonne réponse.`
            };
        } else if (type === "choix_multiple" && correctes < 1) {
            return {
                erreur: `La question ${numero} doit avoir au moins une bonne réponse.`
            };
        }

        propres.push({
            texte: question.texte.trim(),
            type,
            points: arrondir(pointsBruts),
            explication,
            choix: question.choix.map(choix => ({
                texte: choix.texte.trim(),
                est_correcte: choix.est_correcte
            }))
        });
    }

    return { questions: propres };
}

/* ==================================================
   LECTURE ET CORRECTION D'UNE COPIE
   ================================================== */

// Toutes les questions d'un examen avec leurs choix (bonnes reponses incluses)
function lireQuestionsCompletes(examenId) {
    const questions = base.prepare(`
        SELECT id, texte, type, points, explication
        FROM questions
        WHERE examen_id = ?
        ORDER BY id
    `).all(examenId);

    const lireChoix = base.prepare(`
        SELECT id, texte, est_correcte
        FROM choix_reponses
        WHERE question_id = ?
        ORDER BY id
    `);

    return questions.map(question => ({
        id: question.id,
        texte: question.texte,
        type: question.type,
        points: question.points,
        explication: question.explication,
        choix: lireChoix.all(question.id).map(choix => ({
            id: choix.id,
            texte: choix.texte,
            est_correcte: Boolean(choix.est_correcte)
        }))
    }));
}

// Corrige une copie.
// "choisis" = ensemble des identifiants de choix coches par l'etudiant.
// Regle : une question rapporte tous ses points seulement si l'etudiant a
// coche exactement les bonnes reponses (ni une de moins, ni une de plus).
function corriger(questions, choisis) {
    return questions.map(question => {
        const choix = question.choix.map(element => ({
            ...element,
            choisi: choisis.has(element.id)
        }));

        const repondu = choix.some(element => element.choisi);
        const correcte = repondu && choix.every(
            element => element.est_correcte === element.choisi
        );

        return {
            id: question.id,
            texte: question.texte,
            type: question.type,
            points: question.points,
            explication: question.explication,
            choix,
            repondu,
            correcte,
            points_obtenus: correcte ? question.points : 0
        };
    });
}

// Totaux d'une copie corrigee
function totaux(detail) {
    return {
        score: arrondir(
            detail.reduce((somme, question) => somme + question.points_obtenus, 0)
        ),
        total_points: arrondir(
            detail.reduce((somme, question) => somme + question.points, 0)
        )
    };
}

// Dans toutes les reponses de l'API, "total_questions" garde son nom mais
// contient le total des POINTS possibles (egal au nombre de questions quand
// chaque question vaut 1 point). Ainsi "score / total_questions" reste
// toujours correct pour calculer un pourcentage.
function avecTotalPoints(ligne) {
    return {
        ...ligne,
        total_questions: ligne.total_points ?? ligne.total_questions
    };
}

module.exports = {
    TYPES,
    arrondir,
    validerQuestions,
    lireQuestionsCompletes,
    corriger,
    totaux,
    avecTotalPoints
};
