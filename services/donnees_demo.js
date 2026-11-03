const bcrypt = require("bcryptjs");
const base = require("../database/connexion");

// Donnees de demonstration, creees UNIQUEMENT si la base ne contient aucun examen.
// Utile sur un hebergement gratuit sans disque persistant : apres chaque
// redeploiement la base est vide, et le site retrouve ce contenu tout seul.
//
// Variables facultatives :
//   DEMO_DONNEES=false         -> desactive completement ce service
//   DEMO_ETUDIANT_EMAIL        -> email du compte etudiant de demonstration
//   DEMO_ETUDIANT_MOT_DE_PASSE -> son mot de passe (8 caracteres minimum)

const EXAMENS = [
    {
        cours: {
            titre: "Introduction à la programmation",
            description: "Les bases : variables, conditions, boucles et fonctions."
        },
        titre: "Quiz de démonstration : bases de la programmation",
        duree_minutes: 15,
        nb_tentatives_max: 3,
        note_reussite: 50,
        questions: [
            {
                texte: "Quel mot-clé permet de déclarer une constante en JavaScript ?",
                type: "choix_unique",
                points: 1,
                explication: "« const » déclare une variable dont la valeur ne peut pas être réaffectée.",
                choix: [
                    ["const", true], ["var", false], ["let", false], ["static", false]
                ]
            },
            {
                texte: "Parmi ces langages, lesquels sont des langages de programmation ?",
                type: "choix_multiple",
                points: 2,
                explication: "Python et JavaScript sont des langages de programmation. HTML décrit la structure d'une page et CSS son apparence.",
                choix: [
                    ["Python", true], ["JavaScript", true], ["HTML", false], ["CSS", false]
                ]
            },
            {
                texte: "Une boucle « for » permet de répéter des instructions.",
                type: "vrai_faux",
                points: 1,
                explication: "Une boucle répète un bloc d'instructions tant qu'une condition est vraie ou pour un nombre de fois donné.",
                choix: [["Vrai", true], ["Faux", false]]
            },
            {
                texte: "Que renvoie l'expression 2 + 3 * 4 en JavaScript ?",
                type: "choix_unique",
                points: 1.5,
                explication: "La multiplication est prioritaire sur l'addition : 3 * 4 = 12, puis 2 + 12 = 14.",
                choix: [["14", true], ["20", false], ["24", false], ["9", false]]
            }
        ]
    },
    {
        cours: {
            titre: "Bases de données",
            description: "SQL, tables, clés et relations."
        },
        titre: "Quiz de démonstration : SQL",
        duree_minutes: 10,
        nb_tentatives_max: 2,
        note_reussite: 60,
        questions: [
            {
                texte: "Quelle commande SQL permet de lire des données ?",
                type: "choix_unique",
                points: 1,
                explication: "SELECT interroge une table et renvoie des lignes.",
                choix: [["SELECT", true], ["INSERT", false], ["DELETE", false]]
            },
            {
                texte: "Quelles commandes SQL modifient les données d'une table ?",
                type: "choix_multiple",
                points: 2,
                explication: "INSERT ajoute, UPDATE modifie et DELETE supprime des lignes. SELECT ne fait que lire.",
                choix: [
                    ["INSERT", true], ["UPDATE", true], ["DELETE", true], ["SELECT", false]
                ]
            },
            {
                texte: "Une clé primaire peut avoir la même valeur dans deux lignes.",
                type: "vrai_faux",
                points: 1,
                explication: "Faux : une clé primaire identifie une ligne de façon unique.",
                choix: [["Vrai", false], ["Faux", true]]
            }
        ]
    }
];

function creerDonneesDemo() {
    if ((process.env.DEMO_DONNEES || "").trim().toLowerCase() === "false") {
        return;
    }

    const existe = base.prepare("SELECT COUNT(*) AS total FROM examens").get().total;

    if (existe > 0) {
        return; // la base contient deja des examens : on ne touche a rien
    }

    const email = (
        process.env.DEMO_ETUDIANT_EMAIL || "etudiant.demo@exampro.com"
    ).trim().toLowerCase();
    const motDePasse = (
        process.env.DEMO_ETUDIANT_MOT_DE_PASSE || "demo12345"
    ).trim();

    if (!email.includes("@") || motDePasse.length < 8) {
        console.log("Compte etudiant de demonstration ignore (email ou mot de passe invalide).");
    }

    const inserer = base.transaction(() => {
        // Compte etudiant de demonstration (s'il n'existe pas deja)
        if (email.includes("@") && motDePasse.length >= 8) {
            const deja = base.prepare(
                "SELECT id FROM utilisateurs WHERE email = ?"
            ).get(email);

            if (!deja) {
                base.prepare(`
                    INSERT INTO utilisateurs (nom, email, mot_de_passe, role)
                    VALUES (?, ?, ?, 'etudiant')
                `).run("Étudiant Démo", email, bcrypt.hashSync(motDePasse, 10));
            }
        }

        const insererCours = base.prepare(
            "INSERT INTO cours (titre, description) VALUES (?, ?)"
        );
        const insererExamen = base.prepare(`
            INSERT INTO examens
            (cours_id, titre, duree_minutes, statut,
             note_reussite, nb_tentatives_max)
            VALUES (?, ?, ?, 'publie', ?, ?)
        `);
        const insererQuestion = base.prepare(`
            INSERT INTO questions
            (examen_id, texte, type, points, explication)
            VALUES (?, ?, ?, ?, ?)
        `);
        const insererChoix = base.prepare(`
            INSERT INTO choix_reponses (question_id, texte, est_correcte)
            VALUES (?, ?, ?)
        `);

        for (const examen of EXAMENS) {
            const coursExistant = base.prepare(
                "SELECT id FROM cours WHERE titre = ?"
            ).get(examen.cours.titre);

            const coursId = coursExistant
                ? coursExistant.id
                : Number(insererCours.run(
                    examen.cours.titre,
                    examen.cours.description
                ).lastInsertRowid);

            const examenId = Number(insererExamen.run(
                coursId,
                examen.titre,
                examen.duree_minutes,
                examen.note_reussite,
                examen.nb_tentatives_max
            ).lastInsertRowid);

            for (const question of examen.questions) {
                const questionId = Number(insererQuestion.run(
                    examenId,
                    question.texte,
                    question.type,
                    question.points,
                    question.explication
                ).lastInsertRowid);

                for (const [texte, correcte] of question.choix) {
                    insererChoix.run(questionId, texte, correcte ? 1 : 0);
                }
            }
        }
    });

    inserer();

    console.log(
        `Donnees de demonstration creees : ${EXAMENS.length} examens. ` +
        `Compte etudiant : ${email}`
    );
}

module.exports = { creerDonneesDemo };
