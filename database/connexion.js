
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

// Ouvrir ou creer la base de donnees.
// DB_PATH permet de placer le fichier ailleurs (ex. disque persistant Render : /var/data/exampro.db)
const chemin = process.env.DB_PATH || path.join(__dirname, "exampro.db");
fs.mkdirSync(path.dirname(chemin), { recursive: true });
const base = new Database(chemin);

// Mode WAL : meilleur comportement avec plusieurs lectures/ecritures
base.pragma("journal_mode = WAL");

// Activer les cles etrangeres
base.pragma("foreign_keys = ON");

// Creer les tables si elles n'existent pas
base.exec(`
    CREATE TABLE IF NOT EXISTS utilisateurs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nom TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        mot_de_passe TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'etudiant'
            CHECK(role IN ('admin', 'etudiant'))
    );

    CREATE TABLE IF NOT EXISTS cours (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        titre TEXT NOT NULL,
        description TEXT
    );

    CREATE TABLE IF NOT EXISTS examens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cours_id INTEGER NOT NULL,
        titre TEXT NOT NULL,
        duree_minutes INTEGER NOT NULL,
        FOREIGN KEY (cours_id) REFERENCES cours(id)
    );

    CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        examen_id INTEGER NOT NULL,
        texte TEXT NOT NULL,
        FOREIGN KEY (examen_id)
            REFERENCES examens(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS choix_reponses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question_id INTEGER NOT NULL,
        texte TEXT NOT NULL,
        est_correcte INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (question_id)
            REFERENCES questions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS resultats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        utilisateur_id INTEGER NOT NULL,
        examen_id INTEGER NOT NULL,
        score INTEGER NOT NULL,
        total_questions INTEGER NOT NULL,
        date_passage TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id),
        FOREIGN KEY (examen_id) REFERENCES examens(id)
    );

    -- Nouvelle table pour suivre la passation de chaque examen
    CREATE TABLE IF NOT EXISTS tentatives_examens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        utilisateur_id INTEGER NOT NULL,
        examen_id INTEGER NOT NULL,
        date_debut TEXT NOT NULL,
        statut TEXT NOT NULL DEFAULT 'en_cours'
            CHECK(statut IN ('en_cours', 'termine')),
        UNIQUE(utilisateur_id, examen_id),
        FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id),
        FOREIGN KEY (examen_id) REFERENCES examens(id)
    );
`);

module.exports = base;
