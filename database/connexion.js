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

/* ==================================================
   EVOLUTION DU SCHEMA (groupe A) - sans perte de donnees
   Ces ajouts sont rejoues a chaque demarrage sans risque.
   ================================================== */

// Ajouter une colonne seulement si elle n'existe pas encore
function ajouterColonne(table, colonne, definition) {
    const existe = base
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some(c => c.name === colonne);

    if (!existe) {
        base.exec(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${definition}`);
    }
}

// Examens : planification et regles de passage
// (les examens existants restent "publie" et visibles)
ajouterColonne("examens", "statut",
    "TEXT NOT NULL DEFAULT 'publie' CHECK(statut IN ('brouillon', 'publie'))");
ajouterColonne("examens", "date_ouverture", "TEXT");
ajouterColonne("examens", "date_fermeture", "TEXT");
ajouterColonne("examens", "note_reussite", "INTEGER NOT NULL DEFAULT 50");   // en pourcentage
ajouterColonne("examens", "nb_tentatives_max", "INTEGER NOT NULL DEFAULT 1");

// Questions : types, bareme et explication
ajouterColonne("questions", "type",
    "TEXT NOT NULL DEFAULT 'choix_unique' CHECK(type IN ('choix_unique', 'choix_multiple', 'vrai_faux'))");
ajouterColonne("questions", "points", "REAL NOT NULL DEFAULT 1");
ajouterColonne("questions", "explication", "TEXT");

// Resultats : lien vers la tentative et total de points
ajouterColonne("resultats", "tentative_id", "INTEGER");
ajouterColonne("resultats", "total_points", "REAL");

base.exec(`
    -- Une ligne par passage d'un etudiant (remplacera tentatives_examens)
    CREATE TABLE IF NOT EXISTS tentatives (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        utilisateur_id INTEGER NOT NULL,
        examen_id INTEGER NOT NULL,
        numero INTEGER NOT NULL DEFAULT 1,
        date_debut TEXT NOT NULL,
        date_fin TEXT,
        statut TEXT NOT NULL DEFAULT 'en_cours'
            CHECK(statut IN ('en_cours', 'termine')),
        UNIQUE(utilisateur_id, examen_id, numero),
        FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id),
        FOREIGN KEY (examen_id) REFERENCES examens(id)
    );

    -- Le detail de la copie : un choix coche = une ligne
    -- (plusieurs lignes par question si choix multiple)
    CREATE TABLE IF NOT EXISTS reponses_etudiants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tentative_id INTEGER NOT NULL,
        question_id INTEGER NOT NULL,
        choix_id INTEGER NOT NULL,
        UNIQUE(tentative_id, question_id, choix_id),
        FOREIGN KEY (tentative_id) REFERENCES tentatives(id) ON DELETE CASCADE,
        FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
        FOREIGN KEY (choix_id) REFERENCES choix_reponses(id) ON DELETE CASCADE
    );

    -- Tentatives supplementaires accordees par l'admin a un etudiant
    CREATE TABLE IF NOT EXISTS autorisations_tentatives (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        utilisateur_id INTEGER NOT NULL,
        examen_id INTEGER NOT NULL,
        supplementaires INTEGER NOT NULL DEFAULT 0,
        UNIQUE(utilisateur_id, examen_id),
        FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id),
        FOREIGN KEY (examen_id) REFERENCES examens(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tentatives_utilisateur_examen
        ON tentatives(utilisateur_id, examen_id);
    CREATE INDEX IF NOT EXISTS idx_reponses_tentative
        ON reponses_etudiants(tentative_id);
    CREATE INDEX IF NOT EXISTS idx_resultats_examen
        ON resultats(examen_id);
`);

module.exports = base;